package repomap

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/gob"
	"encoding/hex"
	"fmt"
	"log"
	"path/filepath"
	"sync"
	"time"
)

const (
	// IndexDirName is the hidden directory name for storing index files
	IndexDirName = ".choraleia"
	// IndexFileName is the index file name
	IndexFileName = "repomap.idx"
)

// FileSystem is an interface for file operations (read/write)
// This abstraction allows the service to work with local, Docker, or remote filesystems
type FileSystem interface {
	// ReadFile reads file content
	ReadFile(ctx context.Context, path string) (string, error)
	// WriteFile writes content to a file
	WriteFile(ctx context.Context, path string, content []byte) error
	// ListFiles lists files in a directory
	ListFiles(ctx context.Context, path string, recursive bool) ([]FileInfo, error)
	// MkdirAll creates a directory and all parent directories
	MkdirAll(ctx context.Context, path string) error
	// FileExists checks if a file exists
	FileExists(ctx context.Context, path string) bool
	// GetRootPath returns the root path of the workspace
	GetRootPath() string
}

// FileInfo represents basic file info
type FileInfo struct {
	Path  string
	IsDir bool
	Size  int64
}

// ServiceConfig holds configuration for the background service
type ServiceConfig struct {
	// IndexInterval is how often to run full index scan
	IndexInterval time.Duration
	// MaxFileSize is the maximum file size to index (bytes)
	MaxFileSize int64
	// MaxDepth is the maximum directory depth to scan
	MaxDepth int
	// Enabled controls whether the service is active
	Enabled bool
	// PersistIndex controls whether to persist index to disk
	PersistIndex bool
}

// DefaultServiceConfig returns default configuration
func DefaultServiceConfig() ServiceConfig {
	return ServiceConfig{
		IndexInterval: 5 * time.Minute,
		MaxFileSize:   100 * 1024, // 100KB
		MaxDepth:      10,
		Enabled:       true,
		PersistIndex:  true,
	}
}

// WorkspaceInfo holds workspace metadata for indexing
type WorkspaceInfo struct {
	ID       string
	RootPath string
	FS       FileSystem // FileSystem interface for all file operations
}

// RepoMapService is a background service that indexes workspace code
type RepoMapService struct {
	mu         sync.RWMutex
	indexes    map[string]*RepoMapIndex // workspaceID -> index
	parsers    map[string]*LanguageParser
	config     ServiceConfig
	workspaces map[string]*WorkspaceInfo // workspaceID -> info
	stopCh     chan struct{}
	wg         sync.WaitGroup
	running    bool
}

// NewRepoMapService creates a new background repo map service
func NewRepoMapService(config ServiceConfig) *RepoMapService {
	svc := &RepoMapService{
		indexes:    make(map[string]*RepoMapIndex),
		parsers:    make(map[string]*LanguageParser),
		config:     config,
		workspaces: make(map[string]*WorkspaceInfo),
		stopCh:     make(chan struct{}),
	}
	svc.registerLanguages()
	return svc
}

// RegisterWorkspace registers a workspace for indexing
func (s *RepoMapService) RegisterWorkspace(workspaceID, rootPath string, fs FileSystem) {
	s.mu.Lock()
	defer s.mu.Unlock()

	log.Printf("[RepoMap] RegisterWorkspace called: id=%s, rootPath=%s", workspaceID, rootPath)

	// Store workspace info
	s.workspaces[workspaceID] = &WorkspaceInfo{
		ID:       workspaceID,
		RootPath: rootPath,
		FS:       fs,
	}

	// Try to load existing index from disk
	if s.config.PersistIndex {
		if idx := s.loadIndex(workspaceID, rootPath, fs); idx != nil {
			s.indexes[workspaceID] = idx
			log.Printf("[RepoMap] Loaded existing index for workspace %s (%d files)", workspaceID, len(idx.files))
			return
		}
	}

	// Create new index
	s.indexes[workspaceID] = NewRepoMapIndex(workspaceID, rootPath)
	log.Printf("[RepoMap] Created new index for workspace %s", workspaceID)
}

// UnregisterWorkspace removes a workspace from indexing
func (s *RepoMapService) UnregisterWorkspace(workspaceID string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Save index before removing
	if s.config.PersistIndex {
		if idx, ok := s.indexes[workspaceID]; ok {
			if info, ok := s.workspaces[workspaceID]; ok {
				s.saveIndex(workspaceID, info.RootPath, idx, info.FS)
			}
		}
	}

	delete(s.indexes, workspaceID)
	delete(s.workspaces, workspaceID)
	log.Printf("[RepoMap] Unregistered workspace %s", workspaceID)
}

// getIndexPath returns the path for storing index file
func (s *RepoMapService) getIndexPath(rootPath string) string {
	return filepath.Join(rootPath, IndexDirName, IndexFileName)
}

// loadIndex loads index from filesystem using FileSystem interface
func (s *RepoMapService) loadIndex(workspaceID, rootPath string, fs FileSystem) *RepoMapIndex {
	ctx := context.Background()
	indexPath := s.getIndexPath(rootPath)

	// Check if file exists
	if !fs.FileExists(ctx, indexPath) {
		return nil
	}

	// Read file content
	content, err := fs.ReadFile(ctx, indexPath)
	if err != nil {
		log.Printf("[RepoMap] Failed to read index for %s: %v", workspaceID, err)
		return nil
	}

	// Decode
	var data persistedIndex
	decoder := gob.NewDecoder(bytes.NewReader([]byte(content)))
	if err := decoder.Decode(&data); err != nil {
		log.Printf("[RepoMap] Failed to decode index for %s: %v", workspaceID, err)
		return nil
	}

	// Restore index from persisted data
	idx := NewRepoMapIndex(workspaceID, rootPath)
	idx.mu.Lock()
	for path, symbols := range data.Files {
		idx.files[path] = symbols
		// Rebuild symbol index
		for i := range symbols.Symbols {
			sym := &symbols.Symbols[i]
			idx.symbolIndex[sym.Name] = append(idx.symbolIndex[sym.Name], &symbolRef{
				file:   path,
				symbol: sym,
			})
		}
	}
	idx.stats = data.Stats
	idx.mu.Unlock()

	return idx
}

// saveIndex saves index to filesystem using FileSystem interface
func (s *RepoMapService) saveIndex(workspaceID, rootPath string, idx *RepoMapIndex, fs FileSystem) {
	ctx := context.Background()
	indexDir := filepath.Join(rootPath, IndexDirName)

	// Create directory
	if err := fs.MkdirAll(ctx, indexDir); err != nil {
		log.Printf("[RepoMap] Failed to create index dir for %s: %v", workspaceID, err)
		return
	}

	indexPath := s.getIndexPath(rootPath)

	// Encode to bytes
	idx.mu.RLock()
	data := persistedIndex{
		Files: idx.files,
		Stats: idx.stats,
	}
	idx.mu.RUnlock()

	var buf bytes.Buffer
	encoder := gob.NewEncoder(&buf)
	if err := encoder.Encode(data); err != nil {
		log.Printf("[RepoMap] Failed to encode index for %s: %v", workspaceID, err)
		return
	}

	// Write file
	if err := fs.WriteFile(ctx, indexPath, buf.Bytes()); err != nil {
		log.Printf("[RepoMap] Failed to write index file for %s: %v", workspaceID, err)
		return
	}

	log.Printf("[RepoMap] Saved index for workspace %s", workspaceID)
}

// persistedIndex is the structure saved to disk
type persistedIndex struct {
	Files map[string]*FileSymbols
	Stats IndexStats
}

// Start starts the background indexing service
func (s *RepoMapService) Start() {
	s.mu.Lock()
	if s.running || !s.config.Enabled {
		s.mu.Unlock()
		return
	}
	s.running = true
	s.stopCh = make(chan struct{})
	s.mu.Unlock()

	s.wg.Add(1)
	go s.indexLoop()

	log.Printf("[RepoMap] Background service started (interval: %v)", s.config.IndexInterval)
}

// Stop stops the background service
func (s *RepoMapService) Stop() {
	s.mu.Lock()
	if !s.running {
		s.mu.Unlock()
		return
	}
	s.running = false
	close(s.stopCh)
	s.mu.Unlock()

	s.wg.Wait()

	// Save all indexes before stopping
	if s.config.PersistIndex {
		s.saveAllIndexes()
	}

	log.Printf("[RepoMap] Background service stopped")
}

// saveAllIndexes saves all indexes to disk
func (s *RepoMapService) saveAllIndexes() {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for wsID, idx := range s.indexes {
		if info, ok := s.workspaces[wsID]; ok {
			s.saveIndex(wsID, info.RootPath, idx, info.FS)
		}
	}
}

// indexLoop is the main indexing loop
func (s *RepoMapService) indexLoop() {
	defer s.wg.Done()

	// Initial index
	s.indexAllWorkspaces()

	// Save immediately after initial indexing
	if s.config.PersistIndex {
		s.saveAllIndexes()
	}

	ticker := time.NewTicker(s.config.IndexInterval)
	defer ticker.Stop()

	// Save indexes periodically (every 3 index cycles)
	saveCounter := 0

	for {
		select {
		case <-s.stopCh:
			return
		case <-ticker.C:
			s.indexAllWorkspaces()
			saveCounter++
			if s.config.PersistIndex && saveCounter >= 3 {
				s.saveAllIndexes()
				saveCounter = 0
			}
		}
	}
}

// indexAllWorkspaces indexes all registered workspaces
func (s *RepoMapService) indexAllWorkspaces() {
	s.mu.RLock()
	workspaces := make([]string, 0, len(s.indexes))
	for id := range s.indexes {
		workspaces = append(workspaces, id)
	}
	s.mu.RUnlock()

	log.Printf("[RepoMap] indexAllWorkspaces: found %d workspaces to index", len(workspaces))

	for _, wsID := range workspaces {
		if err := s.IndexWorkspace(context.Background(), wsID); err != nil {
			log.Printf("[RepoMap] Failed to index workspace %s: %v", wsID, err)
		}
	}
}

// IndexWorkspace indexes a single workspace
func (s *RepoMapService) IndexWorkspace(ctx context.Context, workspaceID string) error {
	s.mu.RLock()
	idx, ok := s.indexes[workspaceID]
	info, hasInfo := s.workspaces[workspaceID]
	s.mu.RUnlock()

	if !ok || !hasInfo {
		return fmt.Errorf("workspace not registered: %s", workspaceID)
	}

	fs := info.FS

	startTime := time.Now()

	// List all files
	files, err := fs.ListFiles(ctx, ".", true)
	if err != nil {
		return fmt.Errorf("failed to list files: %w", err)
	}

	indexed := 0
	for _, file := range files {
		if file.IsDir {
			continue
		}
		if !IsCodeFile(file.Path) || ShouldIgnorePath(file.Path) {
			continue
		}
		if file.Size > s.config.MaxFileSize {
			continue
		}

		// Read and parse file
		content, err := fs.ReadFile(ctx, file.Path)
		if err != nil {
			continue
		}

		symbols, err := s.parseFile(ctx, file.Path, []byte(content))
		if err != nil {
			continue
		}

		if symbols != nil {
			idx.Update(symbols)
			indexed++
		}
	}

	// Update stats
	idx.mu.Lock()
	idx.stats.LastIndexTime = time.Now()
	idx.stats.IndexDuration = time.Since(startTime)
	idx.mu.Unlock()

	log.Printf("[RepoMap] Indexed workspace %s: %d files in %v", workspaceID, indexed, time.Since(startTime))
	return nil
}

// IndexFile indexes a single file (call after file change)
func (s *RepoMapService) IndexFile(ctx context.Context, workspaceID, path string) error {
	s.mu.RLock()
	idx, ok := s.indexes[workspaceID]
	info, hasInfo := s.workspaces[workspaceID]
	s.mu.RUnlock()

	if !ok || !hasInfo {
		return nil // Workspace not registered, ignore
	}

	if !IsCodeFile(path) {
		return nil
	}

	content, err := info.FS.ReadFile(ctx, path)
	if err != nil {
		// File might be deleted
		idx.Remove(path)
		return nil
	}

	symbols, err := s.parseFile(ctx, path, []byte(content))
	if err != nil {
		return err
	}

	if symbols != nil {
		idx.Update(symbols)
	}
	return nil
}

// RemoveFile removes a file from index (call after file deletion)
func (s *RepoMapService) RemoveFile(workspaceID, path string) {
	s.mu.RLock()
	idx, ok := s.indexes[workspaceID]
	s.mu.RUnlock()

	if ok {
		idx.Remove(path)
	}
}

// parseFile parses a single file
func (s *RepoMapService) parseFile(ctx context.Context, path string, content []byte) (*FileSymbols, error) {
	lang := detectLanguage(path)
	if lang == "" {
		return nil, nil
	}

	parser, ok := s.parsers[lang]
	if !ok {
		return nil, nil
	}

	tree, err := parser.parser.ParseCtx(ctx, nil, content)
	if err != nil {
		return nil, fmt.Errorf("failed to parse %s: %w", path, err)
	}

	symbols := parser.extractor.Extract(tree.RootNode(), content)

	return &FileSymbols{
		Path:      path,
		Language:  lang,
		Symbols:   symbols,
		Hash:      computeHash(content),
		IndexedAt: time.Now(),
	}, nil
}

func computeHash(content []byte) string {
	hash := sha256.Sum256(content)
	return hex.EncodeToString(hash[:8])
}

// GetIndex returns the index for a workspace
func (s *RepoMapService) GetIndex(workspaceID string) *RepoMapIndex {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.indexes[workspaceID]
}

// Search searches for symbols in a workspace
func (s *RepoMapService) Search(workspaceID, query string, limit int) []SearchResult {
	idx := s.GetIndex(workspaceID)
	if idx == nil {
		return nil
	}
	return idx.Search(query, limit)
}

// GetRepoMap returns formatted repo map for a workspace
func (s *RepoMapService) GetRepoMap(workspaceID string, paths []string, maxTokens int) string {
	idx := s.GetIndex(workspaceID)
	if idx == nil {
		return ""
	}
	return idx.FormatRepoMap(paths, maxTokens)
}

// GetStats returns stats for a workspace
func (s *RepoMapService) GetStats(workspaceID string) *IndexStats {
	idx := s.GetIndex(workspaceID)
	if idx == nil {
		return nil
	}
	stats := idx.GetStats()
	return &stats
}

// IsWorkspaceRegistered checks if a workspace is registered
func (s *RepoMapService) IsWorkspaceRegistered(workspaceID string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	_, ok := s.workspaces[workspaceID]
	return ok
}

// GetRegisteredWorkspaces returns list of registered workspace IDs
func (s *RepoMapService) GetRegisteredWorkspaces() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	ids := make([]string, 0, len(s.workspaces))
	for id := range s.workspaces {
		ids = append(ids, id)
	}
	return ids
}

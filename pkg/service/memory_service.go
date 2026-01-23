// Memory service with chromem-go vector store integration
package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/choraleia/choraleia/pkg/db"
	"github.com/choraleia/choraleia/pkg/models"
	"github.com/choraleia/choraleia/pkg/utils"
	"github.com/cloudwego/eino/components/embedding"
	"github.com/google/uuid"
	chromem "github.com/philippgille/chromem-go"
	"gorm.io/gorm"
)

var (
	ErrMemoryNotFound      = errors.New("memory not found")
	ErrMemoryKeyExists     = errors.New("memory with this key already exists")
	ErrInvalidMemoryScope  = errors.New("invalid memory scope")
	ErrVectorStoreDisabled = errors.New("vector store is disabled")
)

// MemoryConfig holds configuration for memory service
type MemoryConfig struct {
	// Vector store settings
	EnableVectorStore bool   `yaml:"enable_vector_store"`
	VectorStorePath   string `yaml:"vector_store_path"`  // Path for persistent storage
	EmbeddingProvider string `yaml:"embedding_provider"` // openai, ollama, or empty for default

	// OpenAI settings
	OpenAIAPIKey string `yaml:"openai_api_key"`
	OpenAIModel  string `yaml:"openai_model"` // e.g., text-embedding-3-small

	// Ollama settings
	OllamaURL   string `yaml:"ollama_url"`
	OllamaModel string `yaml:"ollama_model"`

	// Query settings
	DefaultMaxResults   int `yaml:"default_max_results"`
	DefaultMaxTokens    int `yaml:"default_max_tokens"`
	SemanticSearchLimit int `yaml:"semantic_search_limit"`
}

// getDefaultVectorStorePath returns the default path for vector storage
func getDefaultVectorStorePath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "./data/memory_vectors" // fallback
	}
	return filepath.Join(home, ".choraleia", "memory_vectors")
}

// DefaultMemoryConfig returns default configuration
func DefaultMemoryConfig() *MemoryConfig {
	return &MemoryConfig{
		EnableVectorStore:   true,
		VectorStorePath:     getDefaultVectorStorePath(),
		EmbeddingProvider:   "openai",
		OpenAIModel:         "text-embedding-3-small",
		OllamaURL:           "http://localhost:11434",
		OllamaModel:         "nomic-embed-text",
		DefaultMaxResults:   50,
		DefaultMaxTokens:    5000,
		SemanticSearchLimit: 20,
	}
}

// WorkspaceEmbeddingConfig holds embedding configuration for a workspace
type WorkspaceEmbeddingConfig struct {
	Provider string // openai, ollama, etc.
	Model    string // model name
	APIKey   string // API key (if needed)
	BaseURL  string // Base URL (if needed)
}

// MemoryService handles memory operations
type MemoryService struct {
	db           *gorm.DB
	config       *MemoryConfig
	logger       *slog.Logger
	modelService *ModelService

	// chromem-go vector store
	vectorDB    *chromem.DB
	collections sync.Map // workspaceID -> *chromem.Collection

	// Per-workspace embedding functions (created via ModelService)
	embeddingFuncs sync.Map // workspaceID -> chromem.EmbeddingFunc

	// Default embedding function (fallback)
	defaultEmbeddingFunc chromem.EmbeddingFunc

	// Workspace getter for fetching workspace embedding config
	workspaceGetter func(id string) (*models.Workspace, error)

	// Access tracking callback (set by lifecycle service)
	onAccessCallback func(ctx context.Context, memoryIDs []string)
}

// NewMemoryService creates a new memory service
func NewMemoryService(database *gorm.DB, config *MemoryConfig) (*MemoryService, error) {
	if config == nil {
		config = DefaultMemoryConfig()
	}

	s := &MemoryService{
		db:     database,
		config: config,
		logger: utils.GetLogger(),
	}

	// Initialize vector store
	if config.EnableVectorStore {
		if err := s.initVectorStore(); err != nil {
			s.logger.Warn("Failed to initialize vector store, semantic search disabled", "error", err)
			s.config.EnableVectorStore = false
		}
	}

	return s, nil
}

// SetWorkspaceGetter sets the function to get workspace by ID
func (s *MemoryService) SetWorkspaceGetter(getter func(id string) (*models.Workspace, error)) {
	s.workspaceGetter = getter
}

// SetModelService sets the model service for creating embedders
func (s *MemoryService) SetModelService(modelService *ModelService) {
	s.modelService = modelService
}

// SetOnAccessCallback sets the callback for tracking memory access
func (s *MemoryService) SetOnAccessCallback(callback func(ctx context.Context, memoryIDs []string)) {
	s.onAccessCallback = callback
}

// recordAccess records access to memories (calls lifecycle service if set)
func (s *MemoryService) recordAccess(ctx context.Context, memoryIDs []string) {
	if s.onAccessCallback != nil && len(memoryIDs) > 0 {
		go s.onAccessCallback(ctx, memoryIDs)
	}
}

// initVectorStore initializes chromem-go vector store
func (s *MemoryService) initVectorStore() error {
	// Ensure directory exists
	if s.config.VectorStorePath != "" {
		if err := os.MkdirAll(s.config.VectorStorePath, 0755); err != nil {
			return fmt.Errorf("failed to create vector store directory: %w", err)
		}
	}

	// Create default embedding function from config (optional fallback)
	s.defaultEmbeddingFunc = s.createEmbeddingFunc(s.config.EmbeddingProvider, s.config.OpenAIModel, s.config.OpenAIAPIKey, "")

	// Create persistent DB
	var err error
	if s.config.VectorStorePath != "" {
		s.vectorDB, err = chromem.NewPersistentDB(s.config.VectorStorePath, false)
	} else {
		s.vectorDB = chromem.NewDB()
	}
	if err != nil {
		return fmt.Errorf("failed to create vector DB: %w", err)
	}

	s.logger.Info("Vector store initialized", "path", s.config.VectorStorePath)

	return nil
}

// createEmbeddingFunc creates an embedding function for given provider/model
func (s *MemoryService) createEmbeddingFunc(provider, model, apiKey, baseURL string) chromem.EmbeddingFunc {
	switch provider {
	case "openai", "custom":
		if apiKey == "" {
			apiKey = os.Getenv("OPENAI_API_KEY")
		}
		if apiKey == "" {
			return nil
		}
		if model == "" {
			model = "text-embedding-3-small"
		}
		return chromem.NewEmbeddingFuncOpenAI(apiKey, chromem.EmbeddingModelOpenAI(model))

	case "ollama":
		url := baseURL
		if url == "" {
			url = s.config.OllamaURL
		}
		if url == "" {
			url = "http://localhost:11434"
		}
		if model == "" {
			model = "nomic-embed-text"
		}
		return chromem.NewEmbeddingFuncOllama(model, url)

	default:
		return nil
	}
}

// createEmbeddingFuncFromEmbedder wraps eino Embedder as chromem.EmbeddingFunc
func (s *MemoryService) createEmbeddingFuncFromEmbedder(embedder embedding.Embedder) chromem.EmbeddingFunc {
	return func(ctx context.Context, text string) ([]float32, error) {
		embeddings, err := embedder.EmbedStrings(ctx, []string{text})
		if err != nil {
			return nil, err
		}
		if len(embeddings) == 0 {
			return nil, fmt.Errorf("no embeddings returned")
		}
		// Convert []float64 to []float32
		result := make([]float32, len(embeddings[0]))
		for i, v := range embeddings[0] {
			result[i] = float32(v)
		}
		return result, nil
	}
}

// findEmbeddingModelConfig finds a model config by provider and model name
func (s *MemoryService) findEmbeddingModelConfig(provider, model string) (*models.ModelConfig, error) {
	modelsList, err := models.LoadModels()
	if err != nil {
		return nil, err
	}
	for _, m := range modelsList {
		if m.Provider == provider && m.Model == model {
			// Check if it supports text_embedding
			for _, t := range m.TaskTypes {
				if t == models.TaskTypeTextEmbedding {
					return m, nil
				}
			}
		}
	}
	return nil, fmt.Errorf("no matching embedding model found for provider=%s, model=%s", provider, model)
}

// getEmbeddingFuncForWorkspace gets or creates embedding function for a workspace
func (s *MemoryService) getEmbeddingFuncForWorkspace(workspaceID string) chromem.EmbeddingFunc {
	// Check cache
	if cached, ok := s.embeddingFuncs.Load(workspaceID); ok {
		return cached.(chromem.EmbeddingFunc)
	}

	// Try to get workspace config and use ModelService.CreateEmbedder
	if s.workspaceGetter != nil && s.modelService != nil {
		workspace, err := s.workspaceGetter(workspaceID)
		if err == nil && workspace != nil && workspace.MemoryEnabled {
			if workspace.EmbeddingProvider != nil && workspace.EmbeddingModel != nil {
				// Find model config by provider + model name
				modelConfig, err := s.findEmbeddingModelConfig(*workspace.EmbeddingProvider, *workspace.EmbeddingModel)
				if err == nil && modelConfig != nil {
					// Create embedder using ModelService
					ctx := context.Background()
					embedder, err := s.modelService.CreateEmbedder(ctx, modelConfig)
					if err == nil && embedder != nil {
						embFunc := s.createEmbeddingFuncFromEmbedder(embedder)
						s.embeddingFuncs.Store(workspaceID, embFunc)
						s.logger.Info("Created workspace-specific embedding function via ModelService",
							"workspaceID", workspaceID,
							"provider", *workspace.EmbeddingProvider,
							"model", *workspace.EmbeddingModel)
						return embFunc
					} else {
						s.logger.Warn("Failed to create embedder via ModelService, trying fallback",
							"provider", *workspace.EmbeddingProvider,
							"model", *workspace.EmbeddingModel,
							"error", err)
					}
				}

				// Fallback: try to create using chromem-go built-in functions
				var apiKey, baseURL string
				if modelConfig != nil {
					apiKey = modelConfig.ApiKey
					baseURL = modelConfig.BaseUrl
				}
				embFunc := s.createEmbeddingFunc(*workspace.EmbeddingProvider, *workspace.EmbeddingModel, apiKey, baseURL)
				if embFunc != nil {
					s.embeddingFuncs.Store(workspaceID, embFunc)
					s.logger.Info("Created workspace-specific embedding function via chromem-go",
						"workspaceID", workspaceID,
						"provider", *workspace.EmbeddingProvider,
						"model", *workspace.EmbeddingModel)
					return embFunc
				}
			}
		}
	}

	// Fallback to default
	return s.defaultEmbeddingFunc
}

// InvalidateWorkspaceEmbeddingFunc removes cached embedding function for workspace
// Call this when workspace embedding config changes
func (s *MemoryService) InvalidateWorkspaceEmbeddingFunc(workspaceID string) {
	s.embeddingFuncs.Delete(workspaceID)
	s.collections.Delete("ws_" + workspaceID)
}

// AutoMigrate creates database tables
func (s *MemoryService) AutoMigrate() error {
	return s.db.AutoMigrate(&db.Memory{})
}

// Close closes the memory service
func (s *MemoryService) Close() error {
	// chromem-go handles cleanup automatically
	return nil
}

// ========== CRUD Operations ==========

// Store creates or updates a memory
func (s *MemoryService) Store(ctx context.Context, workspaceID string, req *db.CreateMemoryRequest) (*db.Memory, error) {
	// Set defaults
	if req.Scope == "" {
		req.Scope = db.MemoryScopeWorkspace
	}
	if req.Visibility == "" {
		req.Visibility = db.MemoryVisibilityInherit
	}
	if req.Importance == 0 {
		req.Importance = 50
	}

	// Validate scope
	if req.Scope == db.MemoryScopeAgent && req.AgentID == nil {
		return nil, ErrInvalidMemoryScope
	}

	// Check if memory with same key exists
	var existing db.Memory
	err := s.db.Where("workspace_id = ? AND key = ?", workspaceID, req.Key).First(&existing).Error
	if err == nil {
		// Update existing memory
		updates := map[string]interface{}{
			"content":     req.Content,
			"type":        req.Type,
			"category":    req.Category,
			"tags":        db.StringArray(req.Tags),
			"metadata":    db.JSONMap(req.Metadata),
			"importance":  req.Importance,
			"visibility":  req.Visibility,
			"source_type": req.SourceType,
			"source_id":   req.SourceID,
			"updated_at":  time.Now(),
		}
		if err := s.db.Model(&existing).Updates(updates).Error; err != nil {
			return nil, fmt.Errorf("failed to update memory: %w", err)
		}

		// Update vector store
		if s.config.EnableVectorStore {
			s.updateVectorStore(ctx, workspaceID, &existing)
		}

		return s.Get(ctx, existing.ID)
	}

	// Create new memory
	memory := &db.Memory{
		ID:          uuid.New().String(),
		WorkspaceID: workspaceID,
		Scope:       req.Scope,
		AgentID:     req.AgentID,
		Visibility:  req.Visibility,
		Type:        req.Type,
		Category:    req.Category,
		Key:         req.Key,
		Content:     req.Content,
		Metadata:    db.JSONMap(req.Metadata),
		SourceType:  req.SourceType,
		SourceID:    req.SourceID,
		Tags:        db.StringArray(req.Tags),
		Importance:  req.Importance,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	if err := s.db.Create(memory).Error; err != nil {
		return nil, fmt.Errorf("failed to create memory: %w", err)
	}

	// Add to vector store
	if s.config.EnableVectorStore {
		s.addToVectorStore(ctx, workspaceID, memory)
	}

	s.logger.Debug("Memory stored",
		"id", memory.ID,
		"workspace", workspaceID,
		"key", memory.Key,
		"type", memory.Type)

	return memory, nil
}

// Get retrieves a memory by ID
func (s *MemoryService) Get(ctx context.Context, id string) (*db.Memory, error) {
	var memory db.Memory
	if err := s.db.First(&memory, "id = ?", id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrMemoryNotFound
		}
		return nil, err
	}

	// Update access stats
	s.db.Model(&memory).Updates(map[string]interface{}{
		"access_count": gorm.Expr("access_count + 1"),
		"last_access":  time.Now(),
	})

	return &memory, nil
}

// GetByKey retrieves a memory by workspace and key
func (s *MemoryService) GetByKey(ctx context.Context, workspaceID, key string) (*db.Memory, error) {
	var memory db.Memory
	if err := s.db.First(&memory, "workspace_id = ? AND key = ?", workspaceID, key).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrMemoryNotFound
		}
		return nil, err
	}
	return &memory, nil
}

// Update updates a memory
func (s *MemoryService) Update(ctx context.Context, id string, req *db.UpdateMemoryRequest) (*db.Memory, error) {
	memory, err := s.Get(ctx, id)
	if err != nil {
		return nil, err
	}

	updates := map[string]interface{}{
		"updated_at": time.Now(),
	}

	if req.Content != nil {
		updates["content"] = *req.Content
	}
	if req.Category != nil {
		updates["category"] = *req.Category
	}
	if req.Tags != nil {
		updates["tags"] = db.StringArray(req.Tags)
	}
	if req.Metadata != nil {
		updates["metadata"] = db.JSONMap(req.Metadata)
	}
	if req.Importance != nil {
		updates["importance"] = *req.Importance
	}
	if req.Visibility != nil {
		updates["visibility"] = *req.Visibility
	}

	if err := s.db.Model(memory).Updates(updates).Error; err != nil {
		return nil, fmt.Errorf("failed to update memory: %w", err)
	}

	// Update vector store
	if s.config.EnableVectorStore && req.Content != nil {
		s.updateVectorStore(ctx, memory.WorkspaceID, memory)
	}

	return s.Get(ctx, id)
}

// Delete removes a memory
func (s *MemoryService) Delete(ctx context.Context, id string) error {
	memory, err := s.Get(ctx, id)
	if err != nil {
		return err
	}

	if err := s.db.Delete(&db.Memory{}, "id = ?", id).Error; err != nil {
		return fmt.Errorf("failed to delete memory: %w", err)
	}

	// Remove from vector store
	if s.config.EnableVectorStore {
		s.removeFromVectorStore(ctx, memory.WorkspaceID, id)
	}

	return nil
}

// ========== Query Operations ==========

// Query retrieves memories based on options
func (s *MemoryService) Query(ctx context.Context, opts *db.MemoryQueryOptions) ([]db.Memory, error) {
	query := s.db.Model(&db.Memory{})

	if opts.WorkspaceID != "" {
		query = query.Where("workspace_id = ?", opts.WorkspaceID)
	}
	if len(opts.Types) > 0 {
		query = query.Where("type IN ?", opts.Types)
	}
	if len(opts.Categories) > 0 {
		query = query.Where("category IN ?", opts.Categories)
	}
	if len(opts.Scopes) > 0 {
		query = query.Where("scope IN ?", opts.Scopes)
	}
	if opts.MinImportance > 0 {
		query = query.Where("importance >= ?", opts.MinImportance)
	}
	if opts.Keyword != "" {
		keyword := "%" + opts.Keyword + "%"
		query = query.Where("content LIKE ? OR key LIKE ?", keyword, keyword)
	}

	// Ordering
	orderBy := "created_at"
	if opts.OrderBy != "" {
		orderBy = opts.OrderBy
	}
	if opts.OrderDesc {
		orderBy += " DESC"
	}
	query = query.Order(orderBy)

	// Pagination
	if opts.Limit > 0 {
		query = query.Limit(opts.Limit)
	}
	if opts.Offset > 0 {
		query = query.Offset(opts.Offset)
	}

	var memories []db.Memory
	if err := query.Find(&memories).Error; err != nil {
		return nil, err
	}

	return memories, nil
}

// GetAccessibleMemories retrieves all memories accessible by an agent
func (s *MemoryService) GetAccessibleMemories(ctx context.Context, workspaceID string, agentID *string, opts *db.MemoryQueryOptions) ([]db.Memory, error) {
	if opts == nil {
		opts = &db.MemoryQueryOptions{}
	}
	opts.WorkspaceID = workspaceID

	query := s.db.Model(&db.Memory{}).Where("workspace_id = ?", workspaceID)

	// Build access conditions:
	// 1. Workspace-level memories (accessible by all)
	// 2. Agent's own memories (if agentID provided)
	// 3. Other agents' public memories
	if agentID != nil {
		query = query.Where(`
			(scope = ?) OR 
			(scope = ? AND agent_id = ?) OR 
			(scope = ? AND visibility = ?)
		`,
			db.MemoryScopeWorkspace,
			db.MemoryScopeAgent, *agentID,
			db.MemoryScopeAgent, db.MemoryVisibilityPublic,
		)
	} else {
		// No agent context - only workspace-level and public memories
		query = query.Where(`
			(scope = ?) OR (visibility = ?)
		`, db.MemoryScopeWorkspace, db.MemoryVisibilityPublic)
	}

	// Apply additional filters
	if len(opts.Types) > 0 {
		query = query.Where("type IN ?", opts.Types)
	}
	if len(opts.Categories) > 0 {
		query = query.Where("category IN ?", opts.Categories)
	}
	if opts.MinImportance > 0 {
		query = query.Where("importance >= ?", opts.MinImportance)
	}

	// Order by importance
	query = query.Order("importance DESC, updated_at DESC")

	// Limit
	limit := opts.Limit
	if limit <= 0 {
		limit = s.config.DefaultMaxResults
	}
	query = query.Limit(limit)

	var memories []db.Memory
	if err := query.Find(&memories).Error; err != nil {
		return nil, err
	}

	return memories, nil
}

// SearchSemantic performs semantic search using vector similarity
func (s *MemoryService) SearchSemantic(ctx context.Context, workspaceID string, query string, limit int) ([]db.MemorySearchResult, error) {
	if !s.config.EnableVectorStore || s.vectorDB == nil {
		return nil, ErrVectorStoreDisabled
	}

	if limit <= 0 {
		limit = s.config.SemanticSearchLimit
	}

	// Get collection for workspace
	col, err := s.getOrCreateCollection(ctx, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("failed to get collection: %w", err)
	}

	// Query vector store
	results, err := col.Query(ctx, query, limit, nil, nil)
	if err != nil {
		return nil, fmt.Errorf("vector search failed: %w", err)
	}

	if len(results) == 0 {
		return []db.MemorySearchResult{}, nil
	}

	// Get memory IDs from results
	ids := make([]string, len(results))
	similarityMap := make(map[string]float32)
	for i, r := range results {
		ids[i] = r.ID
		similarityMap[r.ID] = r.Similarity
	}

	// Fetch full memory records from database
	var memories []db.Memory
	if err := s.db.Where("id IN ?", ids).Find(&memories).Error; err != nil {
		return nil, err
	}

	// Build results with similarity scores
	searchResults := make([]db.MemorySearchResult, len(memories))
	for i, m := range memories {
		searchResults[i] = db.MemorySearchResult{
			Memory:     m,
			Similarity: similarityMap[m.ID],
		}
	}

	// Sort by similarity
	sort.Slice(searchResults, func(i, j int) bool {
		return searchResults[i].Similarity > searchResults[j].Similarity
	})

	return searchResults, nil
}

// SearchCombined performs both keyword and semantic search, merging results
func (s *MemoryService) SearchCombined(ctx context.Context, workspaceID string, query string, agentID *string, limit int) ([]db.MemorySearchResult, error) {
	if limit <= 0 {
		limit = s.config.SemanticSearchLimit
	}

	resultMap := make(map[string]db.MemorySearchResult)

	// Semantic search (if enabled)
	if s.config.EnableVectorStore {
		semanticResults, err := s.SearchSemantic(ctx, workspaceID, query, limit)
		if err == nil {
			for _, r := range semanticResults {
				resultMap[r.ID] = r
			}
		}
	}

	// Keyword search
	keywordResults, err := s.GetAccessibleMemories(ctx, workspaceID, agentID, &db.MemoryQueryOptions{
		Keyword: query,
		Limit:   limit,
	})
	if err == nil {
		for _, m := range keywordResults {
			if _, exists := resultMap[m.ID]; !exists {
				resultMap[m.ID] = db.MemorySearchResult{
					Memory:     m,
					Similarity: 0.5, // Default score for keyword matches
				}
			}
		}
	}

	// Convert map to slice and sort
	results := make([]db.MemorySearchResult, 0, len(resultMap))
	for _, r := range resultMap {
		results = append(results, r)
	}
	sort.Slice(results, func(i, j int) bool {
		return results[i].Similarity > results[j].Similarity
	})

	// Apply limit
	if len(results) > limit {
		results = results[:limit]
	}

	// Record access to returned memories
	if len(results) > 0 {
		memoryIDs := make([]string, len(results))
		for i, r := range results {
			memoryIDs[i] = r.ID
		}
		s.recordAccess(ctx, memoryIDs)
	}

	return results, nil
}

// ========== Vector Store Operations ==========

// getOrCreateCollection gets or creates a collection for a workspace
func (s *MemoryService) getOrCreateCollection(ctx context.Context, workspaceID string) (*chromem.Collection, error) {
	collectionName := "ws_" + workspaceID

	// Check cache
	if col, ok := s.collections.Load(collectionName); ok {
		return col.(*chromem.Collection), nil
	}

	// Get embedding function for this workspace
	embeddingFunc := s.getEmbeddingFuncForWorkspace(workspaceID)
	if embeddingFunc == nil {
		return nil, errors.New("no embedding function available for workspace")
	}

	// Try to get existing collection
	col := s.vectorDB.GetCollection(collectionName, embeddingFunc)
	if col != nil {
		s.collections.Store(collectionName, col)
		return col, nil
	}

	// Create new collection
	col, err := s.vectorDB.CreateCollection(collectionName, nil, embeddingFunc)
	if err != nil {
		return nil, err
	}

	s.collections.Store(collectionName, col)
	return col, nil
}

// addToVectorStore adds a memory to the vector store
func (s *MemoryService) addToVectorStore(ctx context.Context, workspaceID string, memory *db.Memory) {
	col, err := s.getOrCreateCollection(ctx, workspaceID)
	if err != nil {
		s.logger.Warn("Failed to get collection for vector store", "error", err)
		return
	}

	// Build content for embedding
	content := s.buildEmbeddingContent(memory)

	// Build metadata
	metadata := map[string]string{
		"type":     string(memory.Type),
		"scope":    string(memory.Scope),
		"key":      memory.Key,
		"category": memory.Category,
	}
	if memory.AgentID != nil {
		metadata["agent_id"] = *memory.AgentID
	}

	// Add document
	err = col.AddDocument(ctx, chromem.Document{
		ID:       memory.ID,
		Content:  content,
		Metadata: metadata,
	})
	if err != nil {
		s.logger.Warn("Failed to add memory to vector store", "error", err, "memoryID", memory.ID)
	}
}

// updateVectorStore updates a memory in the vector store
func (s *MemoryService) updateVectorStore(ctx context.Context, workspaceID string, memory *db.Memory) {
	// chromem-go handles updates by re-adding with same ID
	s.addToVectorStore(ctx, workspaceID, memory)
}

// removeFromVectorStore removes a memory from the vector store
func (s *MemoryService) removeFromVectorStore(ctx context.Context, workspaceID string, memoryID string) {
	col, err := s.getOrCreateCollection(ctx, workspaceID)
	if err != nil {
		return
	}

	// chromem-go Delete method
	if err := col.Delete(ctx, nil, nil, memoryID); err != nil {
		s.logger.Warn("Failed to remove memory from vector store", "error", err, "memoryID", memoryID)
	}
}

// buildEmbeddingContent builds the text content for embedding
func (s *MemoryService) buildEmbeddingContent(memory *db.Memory) string {
	parts := []string{}

	// Add key as context
	if memory.Key != "" {
		parts = append(parts, memory.Key+":")
	}

	// Add main content
	parts = append(parts, memory.Content)

	// Add tags as context
	if len(memory.Tags) > 0 {
		parts = append(parts, "["+strings.Join(memory.Tags, ", ")+"]")
	}

	return strings.Join(parts, " ")
}

// ========== Batch Operations ==========

// BatchStore stores multiple memories
func (s *MemoryService) BatchStore(ctx context.Context, workspaceID string, memories []*db.CreateMemoryRequest) ([]*db.Memory, error) {
	results := make([]*db.Memory, 0, len(memories))

	for _, req := range memories {
		m, err := s.Store(ctx, workspaceID, req)
		if err != nil {
			s.logger.Warn("Failed to store memory in batch", "error", err, "key", req.Key)
			continue
		}
		results = append(results, m)
	}

	return results, nil
}

// DeleteByWorkspace deletes all memories for a workspace
func (s *MemoryService) DeleteByWorkspace(ctx context.Context, workspaceID string) error {
	if err := s.db.Where("workspace_id = ?", workspaceID).Delete(&db.Memory{}).Error; err != nil {
		return err
	}

	// Remove collection from vector store
	if s.config.EnableVectorStore {
		collectionName := "ws_" + workspaceID
		s.collections.Delete(collectionName)
		// Note: chromem-go doesn't have DeleteCollection, collection will be recreated if needed
	}

	return nil
}

// ========== Context Building ==========

// BuildMemoryContext builds memory context string for LLM prompt
func (s *MemoryService) BuildMemoryContext(ctx context.Context, workspaceID string, agentID *string, recentQuery string, maxTokens int) (string, error) {
	if maxTokens <= 0 {
		maxTokens = s.config.DefaultMaxTokens
	}

	var allMemories []db.Memory

	// 1. Get important workspace-level memories
	workspaceMemories, err := s.GetAccessibleMemories(ctx, workspaceID, agentID, &db.MemoryQueryOptions{
		Scopes:        []db.MemoryScope{db.MemoryScopeWorkspace},
		MinImportance: 60,
		Limit:         20,
	})
	if err == nil {
		allMemories = append(allMemories, workspaceMemories...)
	}

	// 2. Semantic search for relevant memories (if query provided)
	if recentQuery != "" && s.config.EnableVectorStore {
		searchResults, err := s.SearchSemantic(ctx, workspaceID, recentQuery, 10)
		if err == nil {
			for _, r := range searchResults {
				// Avoid duplicates
				exists := false
				for _, m := range allMemories {
					if m.ID == r.ID {
						exists = true
						break
					}
				}
				if !exists {
					allMemories = append(allMemories, r.Memory)
				}
			}
		}
	}

	if len(allMemories) == 0 {
		return "", nil
	}

	// Build context string
	var sb strings.Builder
	sb.WriteString("=== RELEVANT MEMORIES ===\n")

	currentTokens := 30 // Approximate header tokens

	for _, m := range allMemories {
		// Estimate tokens (rough: 4 chars per token)
		entryTokens := (len(m.Content) + len(m.Key) + 20) / 4

		if currentTokens+entryTokens > maxTokens {
			break
		}

		sb.WriteString(fmt.Sprintf("- [%s] %s: %s\n", m.Type, m.Key, m.Content))
		currentTokens += entryTokens
	}

	return sb.String(), nil
}

// ========== Workspace-level Convenience Methods ==========

// StoreWorkspaceMemory stores a workspace-level memory (accessible by all agents)
func (s *MemoryService) StoreWorkspaceMemory(ctx context.Context, workspaceID string, memType db.MemoryType, key, content string) (*db.Memory, error) {
	return s.Store(ctx, workspaceID, &db.CreateMemoryRequest{
		Type:       memType,
		Key:        key,
		Content:    content,
		Scope:      db.MemoryScopeWorkspace,
		Visibility: db.MemoryVisibilityPublic,
	})
}

// StoreAgentMemory stores an agent-level memory
func (s *MemoryService) StoreAgentMemory(ctx context.Context, workspaceID, agentID string, memType db.MemoryType, key, content string, public bool) (*db.Memory, error) {
	visibility := db.MemoryVisibilityPrivate
	if public {
		visibility = db.MemoryVisibilityPublic
	}

	return s.Store(ctx, workspaceID, &db.CreateMemoryRequest{
		Type:       memType,
		Key:        key,
		Content:    content,
		Scope:      db.MemoryScopeAgent,
		AgentID:    &agentID,
		Visibility: visibility,
	})
}

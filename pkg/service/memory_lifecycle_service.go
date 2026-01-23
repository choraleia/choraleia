// Memory lifecycle service for memory management, cleanup, and statistics
package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/choraleia/choraleia/pkg/db"
	"github.com/choraleia/choraleia/pkg/utils"
	"gorm.io/gorm"
)

// MemoryLifecycleConfig holds configuration for memory lifecycle management
type MemoryLifecycleConfig struct {
	// Cleanup settings
	EnableAutoCleanup       bool          `yaml:"enable_auto_cleanup"`
	CleanupInterval         time.Duration `yaml:"cleanup_interval"`           // How often to run cleanup (e.g., 24h)
	ExpireUnusedAfter       time.Duration `yaml:"expire_unused_after"`        // Expire memories not accessed for this duration (e.g., 90 days)
	MaxMemoriesPerWorkspace int           `yaml:"max_memories_per_workspace"` // Max memories per workspace (0 = unlimited)

	// Importance decay settings
	EnableImportanceDecay bool    `yaml:"enable_importance_decay"`
	DecayRate             float64 `yaml:"decay_rate"`       // Decay rate per day (e.g., 0.01 = 1% per day)
	MinImportance         int     `yaml:"min_importance"`   // Minimum importance before eligible for cleanup
	DecayAfterDays        int     `yaml:"decay_after_days"` // Start decay after N days without access
}

// DefaultMemoryLifecycleConfig returns default configuration
func DefaultMemoryLifecycleConfig() *MemoryLifecycleConfig {
	return &MemoryLifecycleConfig{
		EnableAutoCleanup:       false,
		CleanupInterval:         24 * time.Hour,
		ExpireUnusedAfter:       90 * 24 * time.Hour, // 90 days
		MaxMemoriesPerWorkspace: 1000,
		EnableImportanceDecay:   true,
		DecayRate:               0.005, // 0.5% per day
		MinImportance:           10,
		DecayAfterDays:          30,
	}
}

// MemoryLifecycleService handles memory lifecycle operations
type MemoryLifecycleService struct {
	db            *gorm.DB
	memoryService *MemoryService
	config        *MemoryLifecycleConfig
	logger        *slog.Logger
	stopCh        chan struct{}
}

// NewMemoryLifecycleService creates a new memory lifecycle service
func NewMemoryLifecycleService(database *gorm.DB, memoryService *MemoryService, config *MemoryLifecycleConfig) *MemoryLifecycleService {
	if config == nil {
		config = DefaultMemoryLifecycleConfig()
	}
	return &MemoryLifecycleService{
		db:            database,
		memoryService: memoryService,
		config:        config,
		logger:        utils.GetLogger(),
		stopCh:        make(chan struct{}),
	}
}

// Start starts the background cleanup goroutine
func (s *MemoryLifecycleService) Start() {
	if !s.config.EnableAutoCleanup {
		return
	}

	go func() {
		ticker := time.NewTicker(s.config.CleanupInterval)
		defer ticker.Stop()

		for {
			select {
			case <-ticker.C:
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
				if err := s.RunCleanup(ctx); err != nil {
					s.logger.Error("Memory cleanup failed", "error", err)
				}
				cancel()
			case <-s.stopCh:
				return
			}
		}
	}()

	s.logger.Info("Memory lifecycle service started", "interval", s.config.CleanupInterval)
}

// Stop stops the background cleanup goroutine
func (s *MemoryLifecycleService) Stop() {
	close(s.stopCh)
}

// RunCleanup runs the full cleanup process
func (s *MemoryLifecycleService) RunCleanup(ctx context.Context) error {
	s.logger.Info("Starting memory cleanup")

	var totalCleaned int

	// 1. Clean expired memories
	expired, err := s.cleanExpiredMemories(ctx)
	if err != nil {
		s.logger.Warn("Error cleaning expired memories", "error", err)
	}
	totalCleaned += expired

	// 2. Apply importance decay
	if s.config.EnableImportanceDecay {
		if err := s.applyImportanceDecay(ctx); err != nil {
			s.logger.Warn("Error applying importance decay", "error", err)
		}
	}

	// 3. Clean low importance memories if over limit
	overLimit, err := s.cleanOverLimitMemories(ctx)
	if err != nil {
		s.logger.Warn("Error cleaning over-limit memories", "error", err)
	}
	totalCleaned += overLimit

	s.logger.Info("Memory cleanup completed", "totalCleaned", totalCleaned)
	return nil
}

// cleanExpiredMemories removes memories that have expired
func (s *MemoryLifecycleService) cleanExpiredMemories(ctx context.Context) (int, error) {
	now := time.Now()

	// Delete memories with explicit expiration
	result := s.db.WithContext(ctx).Where("expires_at IS NOT NULL AND expires_at < ?", now).Delete(&db.Memory{})
	if result.Error != nil {
		return 0, result.Error
	}
	explicitExpired := int(result.RowsAffected)

	// Delete memories not accessed for too long
	threshold := now.Add(-s.config.ExpireUnusedAfter)
	result = s.db.WithContext(ctx).Where(
		"(last_access IS NULL AND created_at < ?) OR (last_access IS NOT NULL AND last_access < ?)",
		threshold, threshold,
	).Where("importance < ?", 80). // Don't delete high importance memories
					Delete(&db.Memory{})
	if result.Error != nil {
		return explicitExpired, result.Error
	}

	return explicitExpired + int(result.RowsAffected), nil
}

// applyImportanceDecay reduces importance of unused memories
func (s *MemoryLifecycleService) applyImportanceDecay(ctx context.Context) error {
	threshold := time.Now().AddDate(0, 0, -s.config.DecayAfterDays)

	// Find memories that haven't been accessed recently
	var memories []db.Memory
	if err := s.db.WithContext(ctx).Where(
		"(last_access IS NULL AND created_at < ?) OR (last_access IS NOT NULL AND last_access < ?)",
		threshold, threshold,
	).Where("importance > ?", s.config.MinImportance).
		Find(&memories).Error; err != nil {
		return err
	}

	for _, mem := range memories {
		// Calculate days since last access
		var lastAccess time.Time
		if mem.LastAccess != nil {
			lastAccess = *mem.LastAccess
		} else {
			lastAccess = mem.CreatedAt
		}
		daysSinceAccess := int(time.Since(lastAccess).Hours() / 24)

		// Apply decay: importance = importance * (1 - decay_rate)^days
		decayFactor := 1.0 - s.config.DecayRate
		for i := 0; i < daysSinceAccess-s.config.DecayAfterDays; i++ {
			decayFactor *= (1.0 - s.config.DecayRate)
		}

		newImportance := int(float64(mem.Importance) * decayFactor)
		if newImportance < s.config.MinImportance {
			newImportance = s.config.MinImportance
		}

		if newImportance != mem.Importance {
			s.db.Model(&mem).Update("importance", newImportance)
		}
	}

	return nil
}

// cleanOverLimitMemories removes lowest importance memories when over workspace limit
func (s *MemoryLifecycleService) cleanOverLimitMemories(ctx context.Context) (int, error) {
	if s.config.MaxMemoriesPerWorkspace <= 0 {
		return 0, nil
	}

	// Get all workspaces with memory counts
	var workspaceCounts []struct {
		WorkspaceID string
		Count       int64
	}
	if err := s.db.WithContext(ctx).Model(&db.Memory{}).
		Select("workspace_id, count(*) as count").
		Group("workspace_id").
		Having("count(*) > ?", s.config.MaxMemoriesPerWorkspace).
		Scan(&workspaceCounts).Error; err != nil {
		return 0, err
	}

	totalCleaned := 0
	for _, wc := range workspaceCounts {
		toDelete := int(wc.Count) - s.config.MaxMemoriesPerWorkspace

		// Get IDs of lowest importance memories to delete
		var memoryIDs []string
		if err := s.db.WithContext(ctx).Model(&db.Memory{}).
			Select("id").
			Where("workspace_id = ?", wc.WorkspaceID).
			Order("importance ASC, last_access ASC NULLS FIRST, created_at ASC").
			Limit(toDelete).
			Pluck("id", &memoryIDs).Error; err != nil {
			continue
		}

		if len(memoryIDs) > 0 {
			result := s.db.WithContext(ctx).Where("id IN ?", memoryIDs).Delete(&db.Memory{})
			totalCleaned += int(result.RowsAffected)
		}
	}

	return totalCleaned, nil
}

// ========== Statistics ==========

// MemoryStats represents memory statistics for a workspace
type MemoryStats struct {
	WorkspaceID      string           `json:"workspace_id"`
	TotalCount       int64            `json:"total_count"`
	ByType           map[string]int64 `json:"by_type"`
	ByScope          map[string]int64 `json:"by_scope"`
	ByCategory       map[string]int64 `json:"by_category"`
	BySourceType     map[string]int64 `json:"by_source_type"`
	AvgImportance    float64          `json:"avg_importance"`
	TotalAccessCount int64            `json:"total_access_count"`
	RecentlyCreated  int64            `json:"recently_created"`  // Last 7 days
	RecentlyAccessed int64            `json:"recently_accessed"` // Last 7 days
}

// GetWorkspaceStats returns memory statistics for a workspace
func (s *MemoryLifecycleService) GetWorkspaceStats(ctx context.Context, workspaceID string) (*MemoryStats, error) {
	stats := &MemoryStats{
		WorkspaceID:  workspaceID,
		ByType:       make(map[string]int64),
		ByScope:      make(map[string]int64),
		ByCategory:   make(map[string]int64),
		BySourceType: make(map[string]int64),
	}

	// Total count
	s.db.WithContext(ctx).Model(&db.Memory{}).Where("workspace_id = ?", workspaceID).Count(&stats.TotalCount)

	// By type
	var typeResults []struct {
		Type  string
		Count int64
	}
	s.db.WithContext(ctx).Model(&db.Memory{}).
		Select("type, count(*) as count").
		Where("workspace_id = ?", workspaceID).
		Group("type").
		Scan(&typeResults)
	for _, r := range typeResults {
		stats.ByType[r.Type] = r.Count
	}

	// By scope
	var scopeResults []struct {
		Scope string
		Count int64
	}
	s.db.WithContext(ctx).Model(&db.Memory{}).
		Select("scope, count(*) as count").
		Where("workspace_id = ?", workspaceID).
		Group("scope").
		Scan(&scopeResults)
	for _, r := range scopeResults {
		stats.ByScope[r.Scope] = r.Count
	}

	// By category
	var categoryResults []struct {
		Category string
		Count    int64
	}
	s.db.WithContext(ctx).Model(&db.Memory{}).
		Select("category, count(*) as count").
		Where("workspace_id = ? AND category != ''", workspaceID).
		Group("category").
		Scan(&categoryResults)
	for _, r := range categoryResults {
		stats.ByCategory[r.Category] = r.Count
	}

	// By source type
	var sourceResults []struct {
		SourceType string
		Count      int64
	}
	s.db.WithContext(ctx).Model(&db.Memory{}).
		Select("source_type, count(*) as count").
		Where("workspace_id = ? AND source_type != ''", workspaceID).
		Group("source_type").
		Scan(&sourceResults)
	for _, r := range sourceResults {
		stats.BySourceType[r.SourceType] = r.Count
	}

	// Average importance
	var avgImportance float64
	s.db.WithContext(ctx).Model(&db.Memory{}).
		Where("workspace_id = ?", workspaceID).
		Select("COALESCE(AVG(importance), 0)").
		Scan(&avgImportance)
	stats.AvgImportance = avgImportance

	// Total access count
	s.db.WithContext(ctx).Model(&db.Memory{}).
		Where("workspace_id = ?", workspaceID).
		Select("COALESCE(SUM(access_count), 0)").
		Scan(&stats.TotalAccessCount)

	// Recently created (last 7 days)
	weekAgo := time.Now().AddDate(0, 0, -7)
	s.db.WithContext(ctx).Model(&db.Memory{}).
		Where("workspace_id = ? AND created_at > ?", workspaceID, weekAgo).
		Count(&stats.RecentlyCreated)

	// Recently accessed (last 7 days)
	s.db.WithContext(ctx).Model(&db.Memory{}).
		Where("workspace_id = ? AND last_access > ?", workspaceID, weekAgo).
		Count(&stats.RecentlyAccessed)

	return stats, nil
}

// ========== Import/Export ==========

// MemoryExportData represents exported memory data
type MemoryExportData struct {
	Version     string       `json:"version"`
	ExportedAt  time.Time    `json:"exported_at"`
	WorkspaceID string       `json:"workspace_id"`
	Memories    []db.Memory  `json:"memories"`
	Stats       *MemoryStats `json:"stats,omitempty"`
}

// ExportWorkspaceMemories exports all memories for a workspace
func (s *MemoryLifecycleService) ExportWorkspaceMemories(ctx context.Context, workspaceID string, includeStats bool) (*MemoryExportData, error) {
	var memories []db.Memory
	if err := s.db.WithContext(ctx).Where("workspace_id = ?", workspaceID).
		Order("created_at ASC").
		Find(&memories).Error; err != nil {
		return nil, err
	}

	export := &MemoryExportData{
		Version:     "1.0",
		ExportedAt:  time.Now(),
		WorkspaceID: workspaceID,
		Memories:    memories,
	}

	if includeStats {
		stats, _ := s.GetWorkspaceStats(ctx, workspaceID)
		export.Stats = stats
	}

	return export, nil
}

// ExportWorkspaceMemoriesJSON exports memories as JSON bytes
func (s *MemoryLifecycleService) ExportWorkspaceMemoriesJSON(ctx context.Context, workspaceID string, includeStats bool) ([]byte, error) {
	export, err := s.ExportWorkspaceMemories(ctx, workspaceID, includeStats)
	if err != nil {
		return nil, err
	}
	return json.MarshalIndent(export, "", "  ")
}

// ImportMemoriesOptions specifies import behavior
type ImportMemoriesOptions struct {
	OverwriteExisting bool `json:"overwrite_existing"` // Overwrite memories with same key
	SkipDuplicates    bool `json:"skip_duplicates"`    // Skip memories with same key
	ResetAccessStats  bool `json:"reset_access_stats"` // Reset access count and last access
}

// ImportMemoriesResult represents the result of an import operation
type ImportMemoriesResult struct {
	TotalProcessed int      `json:"total_processed"`
	Imported       int      `json:"imported"`
	Updated        int      `json:"updated"`
	Skipped        int      `json:"skipped"`
	Errors         []string `json:"errors,omitempty"`
}

// ImportWorkspaceMemories imports memories from export data
func (s *MemoryLifecycleService) ImportWorkspaceMemories(ctx context.Context, workspaceID string, data *MemoryExportData, opts *ImportMemoriesOptions) (*ImportMemoriesResult, error) {
	if opts == nil {
		opts = &ImportMemoriesOptions{
			SkipDuplicates:   true,
			ResetAccessStats: true,
		}
	}

	result := &ImportMemoriesResult{
		TotalProcessed: len(data.Memories),
	}

	for _, mem := range data.Memories {
		// Check for existing memory with same key
		var existing db.Memory
		err := s.db.WithContext(ctx).Where("workspace_id = ? AND key = ?", workspaceID, mem.Key).First(&existing).Error

		if err == nil {
			// Memory exists
			if opts.SkipDuplicates {
				result.Skipped++
				continue
			}
			if opts.OverwriteExisting {
				// Update existing memory
				updates := map[string]interface{}{
					"content":    mem.Content,
					"type":       mem.Type,
					"category":   mem.Category,
					"tags":       mem.Tags,
					"importance": mem.Importance,
					"metadata":   mem.Metadata,
					"updated_at": time.Now(),
				}
				if err := s.db.WithContext(ctx).Model(&existing).Updates(updates).Error; err != nil {
					result.Errors = append(result.Errors, fmt.Sprintf("Failed to update %s: %v", mem.Key, err))
				} else {
					result.Updated++
				}
				continue
			}
		}

		// Create new memory
		newMem := db.Memory{
			ID:          "", // Will be generated
			WorkspaceID: workspaceID,
			Scope:       mem.Scope,
			AgentID:     mem.AgentID,
			Visibility:  mem.Visibility,
			Type:        mem.Type,
			Category:    mem.Category,
			Key:         mem.Key,
			Content:     mem.Content,
			Metadata:    mem.Metadata,
			SourceType:  db.MemorySourceUser, // Mark as imported
			Tags:        mem.Tags,
			Importance:  mem.Importance,
		}

		if !opts.ResetAccessStats {
			newMem.AccessCount = mem.AccessCount
			newMem.LastAccess = mem.LastAccess
		}

		if _, err := s.memoryService.Store(ctx, workspaceID, &db.CreateMemoryRequest{
			Type:       newMem.Type,
			Key:        newMem.Key,
			Content:    newMem.Content,
			Scope:      newMem.Scope,
			AgentID:    newMem.AgentID,
			Category:   newMem.Category,
			Tags:       newMem.Tags,
			Importance: newMem.Importance,
			SourceType: newMem.SourceType,
		}); err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("Failed to import %s: %v", mem.Key, err))
		} else {
			result.Imported++
		}
	}

	return result, nil
}

// ImportWorkspaceMemoriesJSON imports memories from JSON bytes
func (s *MemoryLifecycleService) ImportWorkspaceMemoriesJSON(ctx context.Context, workspaceID string, jsonData []byte, opts *ImportMemoriesOptions) (*ImportMemoriesResult, error) {
	var data MemoryExportData
	if err := json.Unmarshal(jsonData, &data); err != nil {
		return nil, fmt.Errorf("invalid JSON: %w", err)
	}
	return s.ImportWorkspaceMemories(ctx, workspaceID, &data, opts)
}

// ========== Access Tracking ==========

// RecordAccess updates access statistics for a memory
func (s *MemoryLifecycleService) RecordAccess(ctx context.Context, memoryID string) error {
	now := time.Now()
	return s.db.WithContext(ctx).Model(&db.Memory{}).
		Where("id = ?", memoryID).
		Updates(map[string]interface{}{
			"access_count": gorm.Expr("access_count + 1"),
			"last_access":  now,
		}).Error
}

// RecordBatchAccess updates access statistics for multiple memories
func (s *MemoryLifecycleService) RecordBatchAccess(ctx context.Context, memoryIDs []string) error {
	if len(memoryIDs) == 0 {
		return nil
	}
	now := time.Now()
	return s.db.WithContext(ctx).Model(&db.Memory{}).
		Where("id IN ?", memoryIDs).
		Updates(map[string]interface{}{
			"access_count": gorm.Expr("access_count + 1"),
			"last_access":  now,
		}).Error
}

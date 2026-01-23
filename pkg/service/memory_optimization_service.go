// Memory optimization service for deduplication, merging, and priority adjustment
package service

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"time"

	"github.com/choraleia/choraleia/pkg/db"
	"github.com/choraleia/choraleia/pkg/models"
	"github.com/choraleia/choraleia/pkg/utils"
	"github.com/cloudwego/eino/schema"
	"gorm.io/gorm"
)

// MemoryOptimizationConfig holds configuration for memory optimization
type MemoryOptimizationConfig struct {
	// Deduplication settings
	SimilarityThreshold float64 `yaml:"similarity_threshold"` // Threshold for considering memories similar (0.0-1.0)
	MaxMergeSize        int     `yaml:"max_merge_size"`       // Max memories to merge into one

	// Priority adjustment settings
	AccessBoostFactor  float64 `yaml:"access_boost_factor"`  // How much to boost importance per access
	MaxImportanceBoost int     `yaml:"max_importance_boost"` // Max boost from access (cap)
	RecentAccessDays   int     `yaml:"recent_access_days"`   // Days to consider for recent access boost
}

// DefaultMemoryOptimizationConfig returns default configuration
func DefaultMemoryOptimizationConfig() *MemoryOptimizationConfig {
	return &MemoryOptimizationConfig{
		SimilarityThreshold: 0.85,
		MaxMergeSize:        5,
		AccessBoostFactor:   2.0,
		MaxImportanceBoost:  30,
		RecentAccessDays:    7,
	}
}

// MemoryOptimizationService handles memory optimization operations
type MemoryOptimizationService struct {
	db            *gorm.DB
	memoryService *MemoryService
	modelService  *ModelService
	config        *MemoryOptimizationConfig
	logger        *slog.Logger
}

// NewMemoryOptimizationService creates a new memory optimization service
func NewMemoryOptimizationService(database *gorm.DB, memoryService *MemoryService, modelService *ModelService, config *MemoryOptimizationConfig) *MemoryOptimizationService {
	if config == nil {
		config = DefaultMemoryOptimizationConfig()
	}
	return &MemoryOptimizationService{
		db:            database,
		memoryService: memoryService,
		modelService:  modelService,
		config:        config,
		logger:        utils.GetLogger(),
	}
}

// ========== Deduplication & Merging ==========

// DuplicateGroup represents a group of similar memories
type DuplicateGroup struct {
	BaseMemory   db.Memory   `json:"base_memory"`
	Duplicates   []db.Memory `json:"duplicates"`
	Similarity   float64     `json:"similarity"`
	SuggestedKey string      `json:"suggested_key"`
}

// FindDuplicates finds groups of similar memories in a workspace
func (s *MemoryOptimizationService) FindDuplicates(ctx context.Context, workspaceID string) ([]DuplicateGroup, error) {
	var memories []db.Memory
	if err := s.db.WithContext(ctx).Where("workspace_id = ?", workspaceID).
		Order("importance DESC, created_at ASC").
		Find(&memories).Error; err != nil {
		return nil, err
	}

	if len(memories) < 2 {
		return nil, nil
	}

	// Group memories by type and category for more accurate comparison
	groups := make(map[string][]db.Memory)
	for _, mem := range memories {
		key := string(mem.Type) + ":" + mem.Category
		groups[key] = append(groups[key], mem)
	}

	var duplicateGroups []DuplicateGroup
	processed := make(map[string]bool)

	for _, groupMemories := range groups {
		for i, mem1 := range groupMemories {
			if processed[mem1.ID] {
				continue
			}

			var duplicates []db.Memory
			for j := i + 1; j < len(groupMemories); j++ {
				mem2 := groupMemories[j]
				if processed[mem2.ID] {
					continue
				}

				similarity := s.calculateTextSimilarity(mem1.Content, mem2.Content)
				if similarity >= s.config.SimilarityThreshold {
					duplicates = append(duplicates, mem2)
					processed[mem2.ID] = true
				}
			}

			if len(duplicates) > 0 {
				processed[mem1.ID] = true
				duplicateGroups = append(duplicateGroups, DuplicateGroup{
					BaseMemory:   mem1,
					Duplicates:   duplicates,
					Similarity:   s.config.SimilarityThreshold,
					SuggestedKey: mem1.Key,
				})
			}
		}
	}

	return duplicateGroups, nil
}

// calculateTextSimilarity calculates similarity between two texts using Jaccard similarity
func (s *MemoryOptimizationService) calculateTextSimilarity(text1, text2 string) float64 {
	words1 := s.tokenize(text1)
	words2 := s.tokenize(text2)

	if len(words1) == 0 && len(words2) == 0 {
		return 1.0
	}
	if len(words1) == 0 || len(words2) == 0 {
		return 0.0
	}

	set1 := make(map[string]bool)
	for _, w := range words1 {
		set1[w] = true
	}

	set2 := make(map[string]bool)
	for _, w := range words2 {
		set2[w] = true
	}

	intersection := 0
	for w := range set1 {
		if set2[w] {
			intersection++
		}
	}

	union := len(set1) + len(set2) - intersection
	if union == 0 {
		return 0.0
	}

	return float64(intersection) / float64(union)
}

// tokenize splits text into words for similarity comparison
func (s *MemoryOptimizationService) tokenize(text string) []string {
	text = strings.ToLower(text)
	// Simple word tokenization
	words := strings.FieldsFunc(text, func(r rune) bool {
		return !((r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_')
	})
	// Filter short words
	var result []string
	for _, w := range words {
		if len(w) > 2 {
			result = append(result, w)
		}
	}
	return result
}

// MergeMemoriesRequest represents a request to merge memories
type MergeMemoriesRequest struct {
	MemoryIDs     []string `json:"memory_ids"`
	NewKey        string   `json:"new_key"`
	NewContent    string   `json:"new_content,omitempty"`    // If empty, will be auto-generated
	KeepOriginals bool     `json:"keep_originals,omitempty"` // Keep original memories after merge
}

// MergeResult represents the result of a merge operation
type MergeResult struct {
	MergedMemory  *db.Memory `json:"merged_memory"`
	DeletedCount  int        `json:"deleted_count"`
	ArchivedCount int        `json:"archived_count"`
}

// MergeMemories merges multiple memories into one
func (s *MemoryOptimizationService) MergeMemories(ctx context.Context, workspaceID string, req *MergeMemoriesRequest) (*MergeResult, error) {
	if len(req.MemoryIDs) < 2 {
		return nil, fmt.Errorf("at least 2 memories required for merge")
	}
	if len(req.MemoryIDs) > s.config.MaxMergeSize {
		return nil, fmt.Errorf("cannot merge more than %d memories at once", s.config.MaxMergeSize)
	}

	// Fetch all memories to merge
	var memories []db.Memory
	if err := s.db.WithContext(ctx).Where("id IN ? AND workspace_id = ?", req.MemoryIDs, workspaceID).
		Find(&memories).Error; err != nil {
		return nil, err
	}

	if len(memories) != len(req.MemoryIDs) {
		return nil, fmt.Errorf("some memories not found")
	}

	// Determine merged content
	mergedContent := req.NewContent
	if mergedContent == "" {
		// Auto-generate merged content using LLM
		var err error
		mergedContent, err = s.generateMergedContent(ctx, memories)
		if err != nil {
			// Fallback to simple concatenation
			var contents []string
			for _, mem := range memories {
				contents = append(contents, mem.Content)
			}
			mergedContent = strings.Join(contents, "\n\n")
		}
	}

	// Find the most important memory as base
	sort.Slice(memories, func(i, j int) bool {
		return memories[i].Importance > memories[j].Importance
	})
	baseMem := memories[0]

	// Calculate merged importance (average + boost for having duplicates)
	totalImportance := 0
	for _, mem := range memories {
		totalImportance += mem.Importance
	}
	avgImportance := totalImportance / len(memories)
	mergedImportance := avgImportance + len(memories)*2 // Small boost for consolidation
	if mergedImportance > 100 {
		mergedImportance = 100
	}

	// Merge tags
	tagSet := make(map[string]bool)
	for _, mem := range memories {
		for _, tag := range mem.Tags {
			tagSet[tag] = true
		}
	}
	var mergedTags []string
	for tag := range tagSet {
		mergedTags = append(mergedTags, tag)
	}

	// Create merged memory
	mergedMem, err := s.memoryService.Store(ctx, workspaceID, &db.CreateMemoryRequest{
		Type:       baseMem.Type,
		Key:        req.NewKey,
		Content:    mergedContent,
		Scope:      baseMem.Scope,
		AgentID:    baseMem.AgentID,
		Category:   baseMem.Category,
		Tags:       mergedTags,
		Importance: mergedImportance,
		SourceType: db.MemorySourceSystem,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create merged memory: %w", err)
	}

	result := &MergeResult{
		MergedMemory: mergedMem,
	}

	// Handle original memories
	if req.KeepOriginals {
		// Archive originals by adding metadata
		for _, mem := range memories {
			metadata := mem.Metadata
			if metadata == nil {
				metadata = make(db.JSONMap)
			}
			metadata["merged_into"] = mergedMem.ID
			metadata["merged_at"] = time.Now().Format(time.RFC3339)
			s.db.Model(&mem).Update("metadata", metadata)
		}
		result.ArchivedCount = len(memories)
	} else {
		// Delete originals
		if err := s.db.WithContext(ctx).Where("id IN ?", req.MemoryIDs).Delete(&db.Memory{}).Error; err != nil {
			s.logger.Warn("Failed to delete merged memories", "error", err)
		} else {
			result.DeletedCount = len(memories)
		}
	}

	return result, nil
}

// generateMergedContent uses LLM to generate merged content
func (s *MemoryOptimizationService) generateMergedContent(ctx context.Context, memories []db.Memory) (string, error) {
	if s.modelService == nil {
		return "", fmt.Errorf("model service not available")
	}

	var contents []string
	for i, mem := range memories {
		contents = append(contents, fmt.Sprintf("%d. %s", i+1, mem.Content))
	}

	prompt := fmt.Sprintf(`Merge the following related memory entries into a single, comprehensive memory.
Preserve all important information while removing redundancy.
Output only the merged content, nothing else.

Memory entries:
%s

Merged content:`, strings.Join(contents, "\n"))

	// Get chat model
	modelsList, err := models.LoadModels()
	if err != nil || len(modelsList) == 0 {
		return "", fmt.Errorf("no models available")
	}

	chatModel, err := s.modelService.CreateChatModel(ctx, modelsList[0])
	if err != nil {
		return "", err
	}

	resp, err := chatModel.Generate(ctx, []*schema.Message{
		schema.UserMessage(prompt),
	})
	if err != nil {
		return "", err
	}

	return strings.TrimSpace(resp.Content), nil
}

// AutoMerge automatically finds and merges duplicate memories
func (s *MemoryOptimizationService) AutoMerge(ctx context.Context, workspaceID string) (*AutoMergeResult, error) {
	duplicates, err := s.FindDuplicates(ctx, workspaceID)
	if err != nil {
		return nil, err
	}

	result := &AutoMergeResult{
		GroupsFound:    len(duplicates),
		GroupsMerged:   0,
		MemoriesMerged: 0,
	}

	for _, group := range duplicates {
		memoryIDs := []string{group.BaseMemory.ID}
		for _, dup := range group.Duplicates {
			memoryIDs = append(memoryIDs, dup.ID)
		}

		mergeResult, err := s.MergeMemories(ctx, workspaceID, &MergeMemoriesRequest{
			MemoryIDs:     memoryIDs,
			NewKey:        group.SuggestedKey + "_merged",
			KeepOriginals: false,
		})
		if err != nil {
			s.logger.Warn("Failed to merge duplicate group", "error", err, "baseKey", group.BaseMemory.Key)
			continue
		}

		result.GroupsMerged++
		result.MemoriesMerged += mergeResult.DeletedCount
	}

	return result, nil
}

// AutoMergeResult represents the result of auto-merge operation
type AutoMergeResult struct {
	GroupsFound    int `json:"groups_found"`
	GroupsMerged   int `json:"groups_merged"`
	MemoriesMerged int `json:"memories_merged"`
}

// ========== Priority Adjustment ==========

// AdjustPriorities adjusts memory priorities based on access patterns
func (s *MemoryOptimizationService) AdjustPriorities(ctx context.Context, workspaceID string) (*PriorityAdjustmentResult, error) {
	recentThreshold := time.Now().AddDate(0, 0, -s.config.RecentAccessDays)

	var memories []db.Memory
	if err := s.db.WithContext(ctx).Where("workspace_id = ?", workspaceID).
		Find(&memories).Error; err != nil {
		return nil, err
	}

	result := &PriorityAdjustmentResult{
		TotalProcessed: len(memories),
	}

	for _, mem := range memories {
		newImportance := mem.Importance

		// Boost for access count
		accessBoost := int(float64(mem.AccessCount) * s.config.AccessBoostFactor)
		if accessBoost > s.config.MaxImportanceBoost {
			accessBoost = s.config.MaxImportanceBoost
		}

		// Extra boost for recent access
		if mem.LastAccess != nil && mem.LastAccess.After(recentThreshold) {
			accessBoost += 5
		}

		newImportance += accessBoost

		// Cap at 100
		if newImportance > 100 {
			newImportance = 100
		}

		if newImportance != mem.Importance {
			s.db.Model(&mem).Update("importance", newImportance)
			result.Adjusted++
			if newImportance > mem.Importance {
				result.Boosted++
			}
		}
	}

	return result, nil
}

// PriorityAdjustmentResult represents the result of priority adjustment
type PriorityAdjustmentResult struct {
	TotalProcessed int `json:"total_processed"`
	Adjusted       int `json:"adjusted"`
	Boosted        int `json:"boosted"`
}

// ========== Visualization Support ==========

// MemoryNode represents a node in the memory graph
type MemoryNode struct {
	ID         string `json:"id"`
	Label      string `json:"label"`
	Type       string `json:"type"`
	Category   string `json:"category"`
	Importance int    `json:"importance"`
	Size       int    `json:"size"`  // For visualization (based on importance/access)
	Group      string `json:"group"` // For color coding
}

// MemoryEdge represents an edge in the memory graph
type MemoryEdge struct {
	Source   string  `json:"source"`
	Target   string  `json:"target"`
	Weight   float64 `json:"weight"`
	Relation string  `json:"relation"` // similar, derived, merged, etc.
}

// MemoryGraph represents a graph of memories for visualization
type MemoryGraph struct {
	Nodes []MemoryNode `json:"nodes"`
	Edges []MemoryEdge `json:"edges"`
}

// GetMemoryGraph generates a graph representation of memories for visualization
func (s *MemoryOptimizationService) GetMemoryGraph(ctx context.Context, workspaceID string, opts *MemoryGraphOptions) (*MemoryGraph, error) {
	if opts == nil {
		opts = &MemoryGraphOptions{
			MaxNodes:            100,
			IncludeSimilarities: true,
			SimilarityThreshold: 0.7,
		}
	}

	var memories []db.Memory
	query := s.db.WithContext(ctx).Where("workspace_id = ?", workspaceID).
		Order("importance DESC, access_count DESC")

	if opts.MaxNodes > 0 {
		query = query.Limit(opts.MaxNodes)
	}

	if err := query.Find(&memories).Error; err != nil {
		return nil, err
	}

	graph := &MemoryGraph{
		Nodes: make([]MemoryNode, 0, len(memories)),
		Edges: make([]MemoryEdge, 0),
	}

	// Create nodes
	for _, mem := range memories {
		label := mem.Key
		if len(label) > 30 {
			label = label[:27] + "..."
		}

		size := 10 + mem.Importance/10 + mem.AccessCount
		if size > 50 {
			size = 50
		}

		graph.Nodes = append(graph.Nodes, MemoryNode{
			ID:         mem.ID,
			Label:      label,
			Type:       string(mem.Type),
			Category:   mem.Category,
			Importance: mem.Importance,
			Size:       size,
			Group:      string(mem.Type), // Group by type for coloring
		})
	}

	// Create edges based on relationships
	if opts.IncludeSimilarities && len(memories) > 1 {
		for i := 0; i < len(memories); i++ {
			for j := i + 1; j < len(memories); j++ {
				// Only check within same type/category
				if memories[i].Type != memories[j].Type {
					continue
				}

				similarity := s.calculateTextSimilarity(memories[i].Content, memories[j].Content)
				if similarity >= opts.SimilarityThreshold {
					graph.Edges = append(graph.Edges, MemoryEdge{
						Source:   memories[i].ID,
						Target:   memories[j].ID,
						Weight:   similarity,
						Relation: "similar",
					})
				}
			}
		}
	}

	// Add edges for merged memories (from metadata)
	for _, mem := range memories {
		if mem.Metadata != nil {
			if mergedInto, ok := mem.Metadata["merged_into"].(string); ok {
				graph.Edges = append(graph.Edges, MemoryEdge{
					Source:   mem.ID,
					Target:   mergedInto,
					Weight:   1.0,
					Relation: "merged",
				})
			}
		}
	}

	return graph, nil
}

// MemoryGraphOptions specifies options for graph generation
type MemoryGraphOptions struct {
	MaxNodes            int     `json:"max_nodes"`
	IncludeSimilarities bool    `json:"include_similarities"`
	SimilarityThreshold float64 `json:"similarity_threshold"`
	FilterType          string  `json:"filter_type,omitempty"`
	FilterCategory      string  `json:"filter_category,omitempty"`
}

// ========== Memory Insights ==========

// MemoryInsights provides analysis insights about memories
type MemoryInsights struct {
	TotalMemories        int                 `json:"total_memories"`
	DuplicateGroups      int                 `json:"duplicate_groups"`
	PotentialMerges      int                 `json:"potential_merges"`
	LowQualityCount      int                 `json:"low_quality_count"` // Low importance, never accessed
	HighValueCount       int                 `json:"high_value_count"`  // High importance, frequently accessed
	CategoryDistribution map[string]int      `json:"category_distribution"`
	TypeDistribution     map[string]int      `json:"type_distribution"`
	RecommendedActions   []RecommendedAction `json:"recommended_actions"`
}

// RecommendedAction represents a recommended optimization action
type RecommendedAction struct {
	Action      string `json:"action"`
	Description string `json:"description"`
	Impact      string `json:"impact"` // high, medium, low
	MemoryCount int    `json:"memory_count"`
}

// GetInsights analyzes memories and provides optimization insights
func (s *MemoryOptimizationService) GetInsights(ctx context.Context, workspaceID string) (*MemoryInsights, error) {
	var memories []db.Memory
	if err := s.db.WithContext(ctx).Where("workspace_id = ?", workspaceID).
		Find(&memories).Error; err != nil {
		return nil, err
	}

	insights := &MemoryInsights{
		TotalMemories:        len(memories),
		CategoryDistribution: make(map[string]int),
		TypeDistribution:     make(map[string]int),
		RecommendedActions:   []RecommendedAction{},
	}

	// Find duplicates
	duplicates, _ := s.FindDuplicates(ctx, workspaceID)
	insights.DuplicateGroups = len(duplicates)
	for _, dup := range duplicates {
		insights.PotentialMerges += len(dup.Duplicates)
	}

	// Analyze memories
	for _, mem := range memories {
		insights.CategoryDistribution[mem.Category]++
		insights.TypeDistribution[string(mem.Type)]++

		// Low quality: low importance and never accessed
		if mem.Importance < 30 && mem.AccessCount == 0 {
			insights.LowQualityCount++
		}

		// High value: high importance and frequently accessed
		if mem.Importance >= 70 && mem.AccessCount >= 5 {
			insights.HighValueCount++
		}
	}

	// Generate recommendations
	if insights.DuplicateGroups > 0 {
		insights.RecommendedActions = append(insights.RecommendedActions, RecommendedAction{
			Action:      "merge_duplicates",
			Description: fmt.Sprintf("Merge %d groups of similar memories", insights.DuplicateGroups),
			Impact:      "medium",
			MemoryCount: insights.PotentialMerges + insights.DuplicateGroups,
		})
	}

	if insights.LowQualityCount > 10 {
		insights.RecommendedActions = append(insights.RecommendedActions, RecommendedAction{
			Action:      "cleanup_low_quality",
			Description: fmt.Sprintf("Review and potentially remove %d low-quality memories", insights.LowQualityCount),
			Impact:      "low",
			MemoryCount: insights.LowQualityCount,
		})
	}

	if len(memories) > 500 && insights.HighValueCount < len(memories)/10 {
		insights.RecommendedActions = append(insights.RecommendedActions, RecommendedAction{
			Action:      "adjust_priorities",
			Description: "Run priority adjustment to better rank memories",
			Impact:      "medium",
			MemoryCount: len(memories),
		})
	}

	return insights, nil
}

// Memory tools for AI agents to store and retrieve memories
package memory

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/choraleia/choraleia/pkg/db"
	"github.com/choraleia/choraleia/pkg/tools"
	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/components/tool/utils"
	"github.com/cloudwego/eino/schema"
)

// Tool IDs
const (
	ToolIDMemoryStore  tools.ToolID = "memory_store"
	ToolIDMemoryRecall tools.ToolID = "memory_recall"
	ToolIDMemoryForget tools.ToolID = "memory_forget"
)

func init() {
	// Register memory_store tool
	tools.Register(tools.ToolDefinition{
		ID:          ToolIDMemoryStore,
		Name:        "memory_store",
		Description: "Store important information to long-term memory for future reference.",
		Category:    tools.CategoryMemory,
		Scope:       tools.ScopeWorkspace,
		Dangerous:   false,
	}, newMemoryStoreTool)

	// Register memory_recall tool
	tools.Register(tools.ToolDefinition{
		ID:          ToolIDMemoryRecall,
		Name:        "memory_recall",
		Description: "Recall information from long-term memory.",
		Category:    tools.CategoryMemory,
		Scope:       tools.ScopeWorkspace,
		Dangerous:   false,
	}, newMemoryRecallTool)

	// Register memory_forget tool
	tools.Register(tools.ToolDefinition{
		ID:          ToolIDMemoryForget,
		Name:        "memory_forget",
		Description: "Remove a memory from long-term storage by its key.",
		Category:    tools.CategoryMemory,
		Scope:       tools.ScopeWorkspace,
		Dangerous:   true,
	}, newMemoryForgetTool)
}

// ========== Memory Store Tool ==========

type MemoryStoreInput struct {
	Type       string   `json:"type"`
	Key        string   `json:"key"`
	Content    string   `json:"content"`
	Scope      string   `json:"scope,omitempty"`
	Category   string   `json:"category,omitempty"`
	Tags       []string `json:"tags,omitempty"`
	Importance int      `json:"importance,omitempty"`
}

type MemoryStoreOutput struct {
	Success  bool   `json:"success"`
	MemoryID string `json:"memory_id,omitempty"`
	Message  string `json:"message"`
	IsUpdate bool   `json:"is_update"`
}

func newMemoryStoreTool(tc *tools.ToolContext) tool.InvokableTool {
	memoryService := tc.MemoryService
	workspaceID := tc.WorkspaceID
	agentID := tc.AgentID

	return utils.NewTool(&schema.ToolInfo{
		Name: "memory_store",
		Desc: "Store important information to long-term memory for future reference. Use this to remember facts, user preferences, instructions, or learned patterns.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"type": {
				Type:     schema.String,
				Desc:     "Memory type: fact, preference, instruction, learned",
				Required: true,
				Enum:     []string{"fact", "preference", "instruction", "learned"},
			},
			"key": {
				Type:     schema.String,
				Desc:     "Unique identifier for this memory. If exists, it will be updated.",
				Required: true,
			},
			"content": {
				Type:     schema.String,
				Desc:     "The information to remember.",
				Required: true,
			},
			"scope": {
				Type: schema.String,
				Desc: "Memory scope: workspace (shared) or agent (private). Default: workspace",
				Enum: []string{"workspace", "agent"},
			},
			"category": {
				Type: schema.String,
				Desc: "Category for organization",
			},
			"importance": {
				Type: schema.Integer,
				Desc: "Importance level 0-100. Default: 50",
			},
		}),
	}, func(ctx context.Context, input *MemoryStoreInput) (string, error) {
		if memoryService == nil {
			return formatJSON(&MemoryStoreOutput{Success: false, Message: "Memory service not available"}), nil
		}

		if input.Type == "" || input.Key == "" || input.Content == "" {
			return formatJSON(&MemoryStoreOutput{Success: false, Message: "type, key, and content are required"}), nil
		}

		scope := db.MemoryScopeWorkspace
		if input.Scope == "agent" {
			scope = db.MemoryScopeAgent
		}

		importance := input.Importance
		if importance == 0 {
			importance = 50
		}

		existing, _ := memoryService.GetByKey(ctx, workspaceID, input.Key)
		isUpdate := existing != nil

		req := &db.CreateMemoryRequest{
			Type:       db.MemoryType(input.Type),
			Key:        input.Key,
			Content:    input.Content,
			Scope:      scope,
			AgentID:    agentID,
			Category:   input.Category,
			Tags:       input.Tags,
			Importance: importance,
			SourceType: db.MemorySourceTool,
		}

		memory, err := memoryService.Store(ctx, workspaceID, req)
		if err != nil {
			return formatJSON(&MemoryStoreOutput{Success: false, Message: fmt.Sprintf("Failed: %v", err)}), nil
		}

		action := "stored"
		if isUpdate {
			action = "updated"
		}

		return formatJSON(&MemoryStoreOutput{
			Success:  true,
			MemoryID: memory.ID,
			Message:  fmt.Sprintf("Memory '%s' %s successfully", input.Key, action),
			IsUpdate: isUpdate,
		}), nil
	})
}

// ========== Memory Recall Tool ==========

type MemoryRecallInput struct {
	Query    string `json:"query,omitempty"`
	Type     string `json:"type,omitempty"`
	Category string `json:"category,omitempty"`
	Key      string `json:"key,omitempty"`
	Limit    int    `json:"limit,omitempty"`
}

type MemoryRecallOutput struct {
	Success  bool          `json:"success"`
	Memories []RecalledMem `json:"memories,omitempty"`
	Count    int           `json:"count"`
	Message  string        `json:"message,omitempty"`
}

type RecalledMem struct {
	Key        string  `json:"key"`
	Type       string  `json:"type"`
	Content    string  `json:"content"`
	Category   string  `json:"category,omitempty"`
	Importance int     `json:"importance"`
	Similarity float32 `json:"similarity,omitempty"`
}

func newMemoryRecallTool(tc *tools.ToolContext) tool.InvokableTool {
	memoryService := tc.MemoryService
	workspaceID := tc.WorkspaceID
	agentID := tc.AgentID

	return utils.NewTool(&schema.ToolInfo{
		Name: "memory_recall",
		Desc: "Recall information from long-term memory. Use semantic search or filter by type/category/key.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"query": {
				Type: schema.String,
				Desc: "Semantic search query to find relevant memories.",
			},
			"type": {
				Type: schema.String,
				Desc: "Filter by memory type",
				Enum: []string{"fact", "preference", "instruction", "learned", "summary", "detail"},
			},
			"category": {
				Type: schema.String,
				Desc: "Filter by category",
			},
			"key": {
				Type: schema.String,
				Desc: "Recall a specific memory by its exact key",
			},
			"limit": {
				Type: schema.Integer,
				Desc: "Maximum memories to return. Default: 10",
			},
		}),
	}, func(ctx context.Context, input *MemoryRecallInput) (string, error) {
		if memoryService == nil {
			return formatJSON(&MemoryRecallOutput{Success: false, Message: "Memory service not available"}), nil
		}

		limit := input.Limit
		if limit <= 0 {
			limit = 10
		}

		var memories []db.MemorySearchResult

		if input.Key != "" {
			mem, err := memoryService.GetByKey(ctx, workspaceID, input.Key)
			if err != nil {
				return formatJSON(&MemoryRecallOutput{Success: false, Message: fmt.Sprintf("Memory '%s' not found", input.Key)}), nil
			}
			memories = []db.MemorySearchResult{{Memory: *mem, Similarity: 1.0}}
		} else if input.Query != "" {
			var err error
			memories, err = memoryService.SearchCombined(ctx, workspaceID, input.Query, agentID, limit)
			if err != nil {
				return formatJSON(&MemoryRecallOutput{Success: false, Message: fmt.Sprintf("Search failed: %v", err)}), nil
			}
		} else {
			opts := &db.MemoryQueryOptions{WorkspaceID: workspaceID, Limit: limit}
			if input.Type != "" {
				opts.Types = []db.MemoryType{db.MemoryType(input.Type)}
			}
			if input.Category != "" {
				opts.Categories = []string{input.Category}
			}

			mems, err := memoryService.GetAccessibleMemories(ctx, workspaceID, agentID, opts)
			if err != nil {
				return formatJSON(&MemoryRecallOutput{Success: false, Message: fmt.Sprintf("Query failed: %v", err)}), nil
			}
			for _, m := range mems {
				memories = append(memories, db.MemorySearchResult{Memory: m})
			}
		}

		recalled := make([]RecalledMem, len(memories))
		for i, m := range memories {
			recalled[i] = RecalledMem{
				Key:        m.Key,
				Type:       string(m.Type),
				Content:    m.Content,
				Category:   m.Category,
				Importance: m.Importance,
				Similarity: m.Similarity,
			}
		}

		return formatJSON(&MemoryRecallOutput{Success: true, Memories: recalled, Count: len(recalled)}), nil
	})
}

// ========== Memory Forget Tool ==========

type MemoryForgetInput struct {
	Key string `json:"key"`
}

type MemoryForgetOutput struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
}

func newMemoryForgetTool(tc *tools.ToolContext) tool.InvokableTool {
	memoryService := tc.MemoryService
	workspaceID := tc.WorkspaceID

	return utils.NewTool(&schema.ToolInfo{
		Name: "memory_forget",
		Desc: "Remove a memory from long-term storage by its key.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"key": {
				Type:     schema.String,
				Desc:     "The key of the memory to delete",
				Required: true,
			},
		}),
	}, func(ctx context.Context, input *MemoryForgetInput) (string, error) {
		if memoryService == nil {
			return formatJSON(&MemoryForgetOutput{Success: false, Message: "Memory service not available"}), nil
		}

		if input.Key == "" {
			return formatJSON(&MemoryForgetOutput{Success: false, Message: "key is required"}), nil
		}

		mem, err := memoryService.GetByKey(ctx, workspaceID, input.Key)
		if err != nil {
			return formatJSON(&MemoryForgetOutput{Success: false, Message: fmt.Sprintf("Memory '%s' not found", input.Key)}), nil
		}

		if err := memoryService.Delete(ctx, mem.ID); err != nil {
			return formatJSON(&MemoryForgetOutput{Success: false, Message: fmt.Sprintf("Failed: %v", err)}), nil
		}

		return formatJSON(&MemoryForgetOutput{Success: true, Message: fmt.Sprintf("Memory '%s' deleted", input.Key)}), nil
	})
}

func formatJSON(v any) string {
	data, _ := json.Marshal(v)
	return string(data)
}

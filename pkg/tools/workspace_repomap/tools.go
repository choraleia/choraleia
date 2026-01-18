// Package workspace_repomap provides code search and analysis tools for workspace.
package workspace_repomap

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/components/tool/utils"
	"github.com/cloudwego/eino/schema"

	"github.com/choraleia/choraleia/pkg/service/repomap"
	"github.com/choraleia/choraleia/pkg/tools"
)

func init() {
	tools.Register(tools.ToolDefinition{
		ID:          "workspace_repomap",
		Name:        "Get Code Structure",
		Description: "Get code structure (functions, types, classes) from the indexed workspace",
		Category:    tools.CategoryWorkspace,
		Scope:       tools.ScopeWorkspace,
		Dangerous:   false,
	}, NewRepoMapTool)

	tools.Register(tools.ToolDefinition{
		ID:          "workspace_search_symbol",
		Name:        "Search Symbol",
		Description: "Search for functions, types, or classes by name in the workspace",
		Category:    tools.CategoryWorkspace,
		Scope:       tools.ScopeWorkspace,
		Dangerous:   false,
	}, NewSearchSymbolTool)

	tools.Register(tools.ToolDefinition{
		ID:          "workspace_file_outline",
		Name:        "File Outline",
		Description: "Get the outline (functions, types, classes) of a specific file",
		Category:    tools.CategoryWorkspace,
		Scope:       tools.ScopeWorkspace,
		Dangerous:   false,
	}, NewFileOutlineTool)

	tools.Register(tools.ToolDefinition{
		ID:          "workspace_list_functions",
		Name:        "List Functions",
		Description: "List all functions/methods in the workspace or specific directory",
		Category:    tools.CategoryWorkspace,
		Scope:       tools.ScopeWorkspace,
		Dangerous:   false,
	}, NewListFunctionsTool)

	tools.Register(tools.ToolDefinition{
		ID:          "workspace_index_stats",
		Name:        "Index Stats",
		Description: "Get workspace code index statistics",
		Category:    tools.CategoryWorkspace,
		Scope:       tools.ScopeWorkspace,
		Dangerous:   false,
	}, NewIndexStatsTool)
}

// GetRepoMapService returns the global repo map service
// This should be set during application initialization
var GetRepoMapService func() *repomap.RepoMapService

// ---- Repo Map Tool ----

type RepoMapInput struct {
	Paths     []string `json:"paths,omitempty"`      // Specific paths to include
	MaxTokens int      `json:"max_tokens,omitempty"` // Max output tokens (default: 4000)
}

func NewRepoMapTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "workspace_repomap",
		Desc: `Get code structure from the workspace index.
Returns a map of all functions, types, and classes.
The workspace is periodically indexed in the background.

Tips:
- Use 'paths' to focus on specific directories (e.g., ["pkg/service", "pkg/models"])
- Use workspace_search_symbol to find specific symbols by name
- Use workspace_file_outline to get detailed outline of a single file`,
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"paths":      {Type: schema.Array, Required: false, Desc: "Specific paths to include (e.g., [\"pkg/service\"])"},
			"max_tokens": {Type: schema.Integer, Required: false, Desc: "Max output tokens (default: 4000)"},
		}),
	}, func(ctx context.Context, input *RepoMapInput) (string, error) {
		svc := GetRepoMapService()
		if svc == nil {
			return fmt.Sprintf("Error: repo map service not available"), nil
		}

		maxTokens := input.MaxTokens
		if maxTokens <= 0 {
			maxTokens = 4000
		}

		result := svc.GetRepoMap(tc.WorkspaceID, input.Paths, maxTokens)
		if result == "" {
			return "No indexed code files found. The workspace may still be indexing.", nil
		}

		// Add stats
		stats := svc.GetStats(tc.WorkspaceID)
		if stats != nil {
			result += fmt.Sprintf("\n---\nIndexed: %d files, %d symbols (last update: %s)\n",
				stats.TotalFiles, stats.TotalSymbols, stats.LastIndexTime.Format("15:04:05"))
		}

		return result, nil
	})
}

// ---- Search Symbol Tool ----

type SearchSymbolInput struct {
	Query string `json:"query"`
	Kind  string `json:"kind,omitempty"` // function, method, struct, class, interface, type
	Limit int    `json:"limit,omitempty"`
}

func NewSearchSymbolTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "workspace_search_symbol",
		Desc: `Search for symbols (functions, types, classes) by name.
Results are ranked by match quality (exact > prefix > contains).

Use this to find specific code elements without scanning the entire repo map.`,
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"query": {Type: schema.String, Required: true, Desc: "Symbol name to search for"},
			"kind":  {Type: schema.String, Required: false, Desc: "Filter by kind: function, method, struct, class, interface, type"},
			"limit": {Type: schema.Integer, Required: false, Desc: "Max results (default: 20)"},
		}),
	}, func(ctx context.Context, input *SearchSymbolInput) (string, error) {
		svc := GetRepoMapService()
		if svc == nil {
			return fmt.Sprintf("Error: repo map service not available"), nil
		}

		if input.Query == "" {
			return fmt.Sprintf("Error: query is required"), nil
		}

		limit := input.Limit
		if limit <= 0 {
			limit = 20
		}

		results := svc.Search(tc.WorkspaceID, input.Query, limit)

		// Filter by kind if specified
		if input.Kind != "" {
			kind := repomap.SymbolKind(input.Kind)
			filtered := results[:0]
			for _, r := range results {
				if r.Symbol.Kind == kind {
					filtered = append(filtered, r)
				}
			}
			results = filtered
		}

		if len(results) == 0 {
			return fmt.Sprintf("No symbols found matching '%s'", input.Query), nil
		}

		var sb strings.Builder
		sb.WriteString(fmt.Sprintf("Found %d symbols matching '%s':\n\n", len(results), input.Query))

		for _, r := range results {
			matchInfo := fmt.Sprintf("[%s %.0f%%]", r.MatchType, r.Score*100)
			if r.Symbol.Signature != "" {
				sb.WriteString(fmt.Sprintf("%s %s\n", matchInfo, r.Symbol.Signature))
			} else {
				sb.WriteString(fmt.Sprintf("%s %s %s\n", matchInfo, r.Symbol.Kind, r.Symbol.Name))
			}
			sb.WriteString(fmt.Sprintf("  File: %s (L%d-%d)\n\n", r.File, r.Symbol.StartLine, r.Symbol.EndLine))
		}

		return sb.String(), nil
	})
}

// ---- File Outline Tool ----

type FileOutlineInput struct {
	Path string `json:"path"`
}

func NewFileOutlineTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "workspace_file_outline",
		Desc: `Get the outline of a specific file from the index.
Shows all functions, types, and classes with line numbers.
Use this to understand a file's structure before reading its content.`,
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"path": {Type: schema.String, Required: true, Desc: "File path to get outline for"},
		}),
	}, func(ctx context.Context, input *FileOutlineInput) (string, error) {
		svc := GetRepoMapService()
		if svc == nil {
			return fmt.Sprintf("Error: repo map service not available"), nil
		}

		if input.Path == "" {
			return fmt.Sprintf("Error: path is required"), nil
		}

		idx := svc.GetIndex(tc.WorkspaceID)
		if idx == nil {
			return "Workspace not indexed yet.", nil
		}

		file := idx.GetFile(input.Path)
		if file == nil {
			return fmt.Sprintf("File '%s' not found in index. It may not be a code file or not yet indexed.", input.Path), nil
		}

		var sb strings.Builder
		sb.WriteString(fmt.Sprintf("File: %s\n", file.Path))
		sb.WriteString(fmt.Sprintf("Language: %s\n", file.Language))
		sb.WriteString(fmt.Sprintf("Symbols: %d\n", len(file.Symbols)))
		sb.WriteString(fmt.Sprintf("Indexed: %s\n\n", file.IndexedAt.Format("2006-01-02 15:04:05")))

		for _, sym := range file.Symbols {
			formatSymbolDetail(&sb, sym, 0)
		}

		return sb.String(), nil
	})
}

// ---- List Functions Tool ----

type ListFunctionsInput struct {
	Path  string `json:"path,omitempty"` // Filter by path prefix
	Limit int    `json:"limit,omitempty"`
}

func NewListFunctionsTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "workspace_list_functions",
		Desc: `List all functions and methods in the workspace.
Optionally filter by directory path.`,
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"path":  {Type: schema.String, Required: false, Desc: "Filter by path prefix (e.g., \"pkg/service\")"},
			"limit": {Type: schema.Integer, Required: false, Desc: "Max results (default: 50)"},
		}),
	}, func(ctx context.Context, input *ListFunctionsInput) (string, error) {
		svc := GetRepoMapService()
		if svc == nil {
			return fmt.Sprintf("Error: repo map service not available"), nil
		}

		idx := svc.GetIndex(tc.WorkspaceID)
		if idx == nil {
			return "Workspace not indexed yet.", nil
		}

		limit := input.Limit
		if limit <= 0 {
			limit = 50
		}

		// Get files
		var files []*repomap.FileSymbols
		if input.Path != "" {
			files = idx.GetFilesInDir(input.Path)
		} else {
			files = idx.GetAllFiles()
		}

		// Collect functions
		type funcInfo struct {
			file      string
			signature string
			line      int
		}
		var funcs []funcInfo

		for _, file := range files {
			for _, sym := range file.Symbols {
				if sym.Kind == repomap.SymbolKindFunction || sym.Kind == repomap.SymbolKindMethod {
					sig := sym.Signature
					if sig == "" {
						sig = sym.Name
					}
					funcs = append(funcs, funcInfo{
						file:      file.Path,
						signature: sig,
						line:      sym.StartLine,
					})
				}
				// Check children (methods)
				for _, child := range sym.Children {
					if child.Kind == repomap.SymbolKindMethod {
						sig := child.Signature
						if sig == "" {
							sig = child.Name
						}
						funcs = append(funcs, funcInfo{
							file:      file.Path,
							signature: sig,
							line:      child.StartLine,
						})
					}
				}
			}
		}

		if len(funcs) == 0 {
			if input.Path != "" {
				return fmt.Sprintf("No functions found in '%s'", input.Path), nil
			}
			return "No functions found in workspace.", nil
		}

		// Sort by file then line
		sort.Slice(funcs, func(i, j int) bool {
			if funcs[i].file != funcs[j].file {
				return funcs[i].file < funcs[j].file
			}
			return funcs[i].line < funcs[j].line
		})

		if len(funcs) > limit {
			funcs = funcs[:limit]
		}

		var sb strings.Builder
		sb.WriteString(fmt.Sprintf("Functions (%d):\n\n", len(funcs)))

		currentFile := ""
		for _, f := range funcs {
			if f.file != currentFile {
				currentFile = f.file
				sb.WriteString(fmt.Sprintf("\n%s:\n", currentFile))
			}
			sb.WriteString(fmt.Sprintf("  L%-4d %s\n", f.line, f.signature))
		}

		return sb.String(), nil
	})
}

// ---- Index Stats Tool ----

type IndexStatsInput struct{}

func NewIndexStatsTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name:        "workspace_index_stats",
		Desc:        "Get statistics about the workspace code index.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{}),
	}, func(ctx context.Context, input *IndexStatsInput) (string, error) {
		svc := GetRepoMapService()
		if svc == nil {
			return fmt.Sprintf("Error: repo map service not available"), nil
		}

		stats := svc.GetStats(tc.WorkspaceID)
		if stats == nil {
			return "Workspace not indexed yet.", nil
		}

		var sb strings.Builder
		sb.WriteString("Workspace Index Statistics:\n\n")
		sb.WriteString(fmt.Sprintf("Total Files: %d\n", stats.TotalFiles))
		sb.WriteString(fmt.Sprintf("Total Symbols: %d\n", stats.TotalSymbols))
		sb.WriteString(fmt.Sprintf("Last Index: %s\n", stats.LastIndexTime.Format("2006-01-02 15:04:05")))
		sb.WriteString(fmt.Sprintf("Index Duration: %v\n", stats.IndexDuration))
		sb.WriteString("\nBy Language:\n")

		// Sort languages
		var langs []string
		for lang := range stats.LanguageStats {
			langs = append(langs, lang)
		}
		sort.Strings(langs)

		for _, lang := range langs {
			sb.WriteString(fmt.Sprintf("  %s: %d files\n", lang, stats.LanguageStats[lang]))
		}

		return sb.String(), nil
	})
}

// ---- Helpers ----

func formatSymbolDetail(sb *strings.Builder, sym repomap.Symbol, indent int) {
	prefix := strings.Repeat("  ", indent)

	if sym.Signature != "" {
		sb.WriteString(fmt.Sprintf("%s%s (L%d-%d)\n", prefix, sym.Signature, sym.StartLine, sym.EndLine))
	} else {
		sb.WriteString(fmt.Sprintf("%s%s %s (L%d-%d)\n", prefix, sym.Kind, sym.Name, sym.StartLine, sym.EndLine))
	}

	for _, child := range sym.Children {
		formatSymbolDetail(sb, child, indent+1)
	}
}

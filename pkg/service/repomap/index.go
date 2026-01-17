// Package repomap provides code structure analysis using Tree-sitter.
// It includes a background service that periodically indexes the workspace
// and provides search capabilities for LLM tools.
package repomap

import (
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	sitter "github.com/smacker/go-tree-sitter"
)

// Symbol represents a code symbol (function, type, method, etc.)
type Symbol struct {
	Name      string     `json:"name"`
	Kind      SymbolKind `json:"kind"`
	Signature string     `json:"signature,omitempty"`
	StartLine int        `json:"start_line"`
	EndLine   int        `json:"end_line"`
	Children  []Symbol   `json:"children,omitempty"`
}

type SymbolKind string

const (
	SymbolKindFunction  SymbolKind = "function"
	SymbolKindMethod    SymbolKind = "method"
	SymbolKindType      SymbolKind = "type"
	SymbolKindStruct    SymbolKind = "struct"
	SymbolKindInterface SymbolKind = "interface"
	SymbolKindClass     SymbolKind = "class"
	SymbolKindVariable  SymbolKind = "variable"
	SymbolKindConstant  SymbolKind = "constant"
)

// FileSymbols represents symbols extracted from a single file
type FileSymbols struct {
	Path      string    `json:"path"`
	Language  string    `json:"language"`
	Symbols   []Symbol  `json:"symbols"`
	Hash      string    `json:"hash"`
	IndexedAt time.Time `json:"indexed_at"`
}

// IndexStats holds indexing statistics
type IndexStats struct {
	TotalFiles    int            `json:"total_files"`
	TotalSymbols  int            `json:"total_symbols"`
	LastIndexTime time.Time      `json:"last_index_time"`
	IndexDuration time.Duration  `json:"index_duration"`
	LanguageStats map[string]int `json:"language_stats"`
}

// SearchResult represents a search result
type SearchResult struct {
	File      string  `json:"file"`
	Symbol    Symbol  `json:"symbol"`
	Score     float64 `json:"score"`
	MatchType string  `json:"match_type"` // "exact", "prefix", "contains"
}

// RepoMapIndex holds the indexed data for a workspace
type RepoMapIndex struct {
	mu          sync.RWMutex
	files       map[string]*FileSymbols // path -> symbols
	symbolIndex map[string][]*symbolRef // symbol name -> references
	stats       IndexStats
	workspaceID string
	rootPath    string
}

type symbolRef struct {
	file   string
	symbol *Symbol
}

// NewRepoMapIndex creates a new index
func NewRepoMapIndex(workspaceID, rootPath string) *RepoMapIndex {
	return &RepoMapIndex{
		files:       make(map[string]*FileSymbols),
		symbolIndex: make(map[string][]*symbolRef),
		workspaceID: workspaceID,
		rootPath:    rootPath,
		stats: IndexStats{
			LanguageStats: make(map[string]int),
		},
	}
}

// Update updates index for a single file
func (idx *RepoMapIndex) Update(file *FileSymbols) {
	idx.mu.Lock()
	defer idx.mu.Unlock()

	// Remove old symbols from index
	if old, ok := idx.files[file.Path]; ok {
		idx.removeSymbolsFromIndex(file.Path, old.Symbols)
	}

	// Add new symbols
	idx.files[file.Path] = file
	idx.addSymbolsToIndex(file.Path, file.Symbols)
}

// Remove removes a file from index
func (idx *RepoMapIndex) Remove(path string) {
	idx.mu.Lock()
	defer idx.mu.Unlock()

	if file, ok := idx.files[path]; ok {
		idx.removeSymbolsFromIndex(path, file.Symbols)
		delete(idx.files, path)
	}
}

func (idx *RepoMapIndex) addSymbolsToIndex(path string, symbols []Symbol) {
	for i := range symbols {
		sym := &symbols[i]
		nameLower := strings.ToLower(sym.Name)
		idx.symbolIndex[nameLower] = append(idx.symbolIndex[nameLower], &symbolRef{
			file:   path,
			symbol: sym,
		})
		// Also index children
		idx.addSymbolsToIndex(path, sym.Children)
	}
}

func (idx *RepoMapIndex) removeSymbolsFromIndex(path string, symbols []Symbol) {
	for _, sym := range symbols {
		nameLower := strings.ToLower(sym.Name)
		refs := idx.symbolIndex[nameLower]
		filtered := refs[:0]
		for _, ref := range refs {
			if ref.file != path {
				filtered = append(filtered, ref)
			}
		}
		if len(filtered) == 0 {
			delete(idx.symbolIndex, nameLower)
		} else {
			idx.symbolIndex[nameLower] = filtered
		}
		idx.removeSymbolsFromIndex(path, sym.Children)
	}
}

// Search searches for symbols by name
func (idx *RepoMapIndex) Search(query string, limit int) []SearchResult {
	idx.mu.RLock()
	defer idx.mu.RUnlock()

	if limit <= 0 {
		limit = 20
	}

	queryLower := strings.ToLower(query)
	var results []SearchResult

	// Exact match
	if refs, ok := idx.symbolIndex[queryLower]; ok {
		for _, ref := range refs {
			results = append(results, SearchResult{
				File:      ref.file,
				Symbol:    *ref.symbol,
				Score:     1.0,
				MatchType: "exact",
			})
		}
	}

	// Prefix and contains match
	for name, refs := range idx.symbolIndex {
		if name == queryLower {
			continue // Already added
		}

		var matchType string
		var score float64

		if strings.HasPrefix(name, queryLower) {
			matchType = "prefix"
			score = 0.8
		} else if strings.Contains(name, queryLower) {
			matchType = "contains"
			score = 0.5
		} else {
			continue
		}

		for _, ref := range refs {
			results = append(results, SearchResult{
				File:      ref.file,
				Symbol:    *ref.symbol,
				Score:     score,
				MatchType: matchType,
			})
		}
	}

	// Sort by score
	sort.Slice(results, func(i, j int) bool {
		return results[i].Score > results[j].Score
	})

	if len(results) > limit {
		results = results[:limit]
	}

	return results
}

// SearchByKind searches for symbols of a specific kind
func (idx *RepoMapIndex) SearchByKind(kind SymbolKind, limit int) []SearchResult {
	idx.mu.RLock()
	defer idx.mu.RUnlock()

	if limit <= 0 {
		limit = 50
	}

	var results []SearchResult
	for path, file := range idx.files {
		for _, sym := range file.Symbols {
			if sym.Kind == kind {
				results = append(results, SearchResult{
					File:      path,
					Symbol:    sym,
					Score:     1.0,
					MatchType: "kind",
				})
			}
			// Check children
			for _, child := range sym.Children {
				if child.Kind == kind {
					results = append(results, SearchResult{
						File:      path,
						Symbol:    child,
						Score:     1.0,
						MatchType: "kind",
					})
				}
			}
		}
	}

	if len(results) > limit {
		results = results[:limit]
	}
	return results
}

// GetFile returns symbols for a specific file
func (idx *RepoMapIndex) GetFile(path string) *FileSymbols {
	idx.mu.RLock()
	defer idx.mu.RUnlock()
	return idx.files[path]
}

// GetFilesInDir returns all files in a directory
func (idx *RepoMapIndex) GetFilesInDir(dir string) []*FileSymbols {
	idx.mu.RLock()
	defer idx.mu.RUnlock()

	var results []*FileSymbols
	for path, file := range idx.files {
		if strings.HasPrefix(path, dir) {
			results = append(results, file)
		}
	}

	sort.Slice(results, func(i, j int) bool {
		return results[i].Path < results[j].Path
	})
	return results
}

// GetStats returns index statistics
func (idx *RepoMapIndex) GetStats() IndexStats {
	idx.mu.RLock()
	defer idx.mu.RUnlock()

	stats := idx.stats
	stats.TotalFiles = len(idx.files)
	stats.TotalSymbols = 0
	stats.LanguageStats = make(map[string]int)

	for _, file := range idx.files {
		stats.TotalSymbols += countSymbols(file.Symbols)
		stats.LanguageStats[file.Language]++
	}
	return stats
}

func countSymbols(symbols []Symbol) int {
	count := len(symbols)
	for _, sym := range symbols {
		count += countSymbols(sym.Children)
	}
	return count
}

// GetAllFiles returns all indexed files
func (idx *RepoMapIndex) GetAllFiles() []*FileSymbols {
	idx.mu.RLock()
	defer idx.mu.RUnlock()

	files := make([]*FileSymbols, 0, len(idx.files))
	for _, file := range idx.files {
		files = append(files, file)
	}

	sort.Slice(files, func(i, j int) bool {
		return files[i].Path < files[j].Path
	})
	return files
}

// FormatRepoMap formats index as repo map string
func (idx *RepoMapIndex) FormatRepoMap(paths []string, maxTokens int) string {
	idx.mu.RLock()
	defer idx.mu.RUnlock()

	var sb strings.Builder

	// Filter files if paths specified
	var files []*FileSymbols
	if len(paths) == 0 {
		files = idx.GetAllFiles()
	} else {
		for _, file := range idx.files {
			for _, p := range paths {
				if strings.HasPrefix(file.Path, p) {
					files = append(files, file)
					break
				}
			}
		}
		sort.Slice(files, func(i, j int) bool {
			return files[i].Path < files[j].Path
		})
	}

	for _, file := range files {
		sb.WriteString(fmt.Sprintf("%s:\n", file.Path))
		for _, sym := range file.Symbols {
			formatSymbol(&sb, sym, 1)
		}
		sb.WriteString("\n")

		if maxTokens > 0 && sb.Len()/4 > maxTokens {
			sb.WriteString("... (truncated)\n")
			break
		}
	}

	return sb.String()
}

func formatSymbol(sb *strings.Builder, sym Symbol, indent int) {
	prefix := strings.Repeat("  ", indent)

	switch sym.Kind {
	case SymbolKindFunction, SymbolKindMethod:
		if sym.Signature != "" {
			sb.WriteString(fmt.Sprintf("%s- %s\n", prefix, sym.Signature))
		} else {
			sb.WriteString(fmt.Sprintf("%s- func %s\n", prefix, sym.Name))
		}
	case SymbolKindStruct, SymbolKindClass:
		sb.WriteString(fmt.Sprintf("%s- type %s struct\n", prefix, sym.Name))
	case SymbolKindInterface:
		sb.WriteString(fmt.Sprintf("%s- type %s interface\n", prefix, sym.Name))
	case SymbolKindType:
		sb.WriteString(fmt.Sprintf("%s- type %s\n", prefix, sym.Name))
	case SymbolKindConstant:
		sb.WriteString(fmt.Sprintf("%s- const %s\n", prefix, sym.Name))
	case SymbolKindVariable:
		sb.WriteString(fmt.Sprintf("%s- var %s\n", prefix, sym.Name))
	default:
		sb.WriteString(fmt.Sprintf("%s- %s\n", prefix, sym.Name))
	}

	for _, child := range sym.Children {
		formatSymbol(sb, child, indent+1)
	}
}

// LanguageParser wraps Tree-sitter parser for a specific language
type LanguageParser struct {
	parser    *sitter.Parser
	language  *sitter.Language
	extractor SymbolExtractor
}

// SymbolExtractor extracts symbols from AST for a specific language
type SymbolExtractor interface {
	Extract(node *sitter.Node, content []byte) []Symbol
}

// detectLanguage detects the programming language from file extension
func detectLanguage(path string) string {
	ext := strings.ToLower(filepath.Ext(path))
	base := strings.ToLower(filepath.Base(path))

	// Special files without extension
	switch base {
	case "dockerfile":
		return "dockerfile"
	case "makefile", "gnumakefile":
		return "bash" // Use bash for makefiles
	}

	switch ext {
	// Go
	case ".go":
		return "go"

	// TypeScript/JavaScript
	case ".ts", ".tsx":
		return "typescript"
	case ".js", ".jsx", ".mjs", ".cjs":
		return "javascript"

	// Python
	case ".py", ".pyw", ".pyi":
		return "python"

	// Rust
	case ".rs":
		return "rust"

	// Java
	case ".java":
		return "java"

	// Kotlin
	case ".kt", ".kts":
		return "kotlin"

	// Scala
	case ".scala", ".sc":
		return "scala"

	// C/C++
	case ".c", ".h":
		return "c"
	case ".cpp", ".cc", ".cxx", ".hpp", ".hxx", ".hh":
		return "cpp"

	// C#
	case ".cs":
		return "csharp"

	// Ruby
	case ".rb", ".rake", ".gemspec":
		return "ruby"

	// PHP
	case ".php", ".php3", ".php4", ".php5", ".phtml":
		return "php"

	// Swift
	case ".swift":
		return "swift"

	// Elixir
	case ".ex", ".exs":
		return "elixir"

	// Lua
	case ".lua":
		return "lua"

	// Elm
	case ".elm":
		return "elm"

	// OCaml
	case ".ml", ".mli":
		return "ocaml"

	// Groovy
	case ".groovy", ".gradle":
		return "groovy"

	// SQL
	case ".sql":
		return "sql"

	// Shell/Bash
	case ".sh", ".bash", ".zsh":
		return "bash"

	// HCL (Terraform)
	case ".tf", ".tfvars", ".hcl":
		return "hcl"

	// Protocol Buffers
	case ".proto":
		return "protobuf"

	// CSS
	case ".css", ".scss", ".sass", ".less":
		return "css"

	// HTML
	case ".html", ".htm", ".xhtml":
		return "html"

	// Svelte
	case ".svelte":
		return "svelte"

	// YAML
	case ".yaml", ".yml":
		return "yaml"

	// TOML
	case ".toml":
		return "toml"

	// Markdown
	case ".md", ".markdown":
		return "markdown"

	// JSON (no tree-sitter, but mark as code file)
	case ".json":
		return "json"

	default:
		return ""
	}
}

// IsCodeFile checks if a file should be included in repo map
func IsCodeFile(path string) bool {
	lang := detectLanguage(path)
	// json doesn't have a parser, skip it
	return lang != "" && lang != "json"
}

// ShouldIgnorePath checks if a path should be ignored
func ShouldIgnorePath(path string) bool {
	ignorePatterns := []string{
		"node_modules/",
		"vendor/",
		".git/",
		"dist/",
		"build/",
		"__pycache__/",
		".venv/",
		"venv/",
		".idea/",
		".vscode/",
		"target/",
	}

	for _, pattern := range ignorePatterns {
		if strings.Contains(path, pattern) {
			return true
		}
	}
	return false
}

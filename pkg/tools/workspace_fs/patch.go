// Package workspace_fs provides file system tools for workspace operations.
package workspace_fs

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/components/tool/utils"
	"github.com/cloudwego/eino/schema"

	"github.com/choraleia/choraleia/pkg/tools"
)

func init() {
	tools.Register(tools.ToolDefinition{
		ID:          "workspace_fs_patch",
		Name:        "Patch File",
		Description: "Apply smart edits to a file using a simplified patch format. More efficient than rewriting entire files.",
		Category:    tools.CategoryWorkspace,
		Scope:       tools.ScopeWorkspace,
		Dangerous:   true,
	}, NewPatchTool)
}

// PatchInput represents the input for the patch tool
type PatchInput struct {
	// Path is the file path to edit
	Path string `json:"path"`
	// Patch is the patch content describing the changes
	// Uses a simplified format with "// ...existing code..." markers
	Patch string `json:"patch"`
	// CreateIfNotExists creates the file if it doesn't exist (treats patch as full content)
	CreateIfNotExists bool `json:"create_if_not_exists,omitempty"`
}

// NewPatchTool creates a new patch file tool
func NewPatchTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "workspace_fs_patch",
		Desc: `Apply smart edits to a file using a simplified patch format. This is more efficient than rewriting entire files.

The patch format uses special markers:
- "// ...existing code..." - preserve unchanged code region
- "// ...delete..." - delete code until next marker or content

Example: Add a method to a class
` + "```" + `
class MyClass {
    // ...existing code...
    
    newMethod() {
        return "hello";
    }
}
` + "```" + `

Example: Delete a function
` + "```" + `
// ...existing code...

// ...delete...
func oldFunction() {
}
// ...end delete...

// ...existing code...
` + "```" + `

Best practices:
- Include enough context (3-5 lines) around changes for accurate matching
- Use "// ...existing code..." to preserve unchanged regions
- Use "// ...delete..." to remove code sections
- Omit code you want to delete (the tool will skip it if not in patch)`,
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"path":                 {Type: schema.String, Required: true, Desc: "File path to edit"},
			"patch":                {Type: schema.String, Required: true, Desc: "Patch content with changes and context markers"},
			"create_if_not_exists": {Type: schema.Boolean, Required: false, Desc: "Create file if it doesn't exist (default: false)"},
		}),
	}, func(ctx context.Context, input *PatchInput) (string, error) {
		// Read existing file content
		existingContent, err := tc.ReadFile(ctx, tc.WorkspaceEndpoint(), input.Path)
		if err != nil {
			if input.CreateIfNotExists {
				// If file doesn't exist and create flag is set, use patch as content
				cleanedPatch := removeMarkers(input.Patch)
				if err := tc.WriteFile(ctx, tc.WorkspaceEndpoint(), input.Path, cleanedPatch); err != nil {
					return fmt.Sprintf("Error: failed to create file '%s': %v", input.Path, err), nil
				}
				return fmt.Sprintf("Created new file %s with %d bytes", input.Path, len(cleanedPatch)), nil
			}
			return fmt.Sprintf("Error: file not found '%s'. Use 'create_if_not_exists: true' to create a new file, or use workspace_fs_write to create the file first", input.Path), nil
		}

		// Apply patch
		result, err := applySmartPatch(existingContent, input.Patch)
		if err != nil {
			return fmt.Sprintf("Error: failed to apply patch to '%s': %v", input.Path, err), nil
		}

		// Write result
		if err := tc.WriteFile(ctx, tc.WorkspaceEndpoint(), input.Path, result); err != nil {
			return fmt.Sprintf("Error: failed to write patched file '%s': %v", input.Path, err), nil
		}

		return fmt.Sprintf("Successfully patched %s", input.Path), nil
	})
}

// existingCodePattern matches markers like "// ...existing code...", "# ...existing code...", etc.
var existingCodePattern = regexp.MustCompile(`(?i)^\s*(//|#|--|/\*|\*|<!--|;)\s*\.{2,}.*existing.*code.*\.{2,}\s*(\*/|-->)?\s*$`)

// deletePattern matches delete markers like "// ...delete...", "# ...delete...", etc.
var deletePattern = regexp.MustCompile(`(?i)^\s*(//|#|--|/\*|\*|<!--|;)\s*\.{2,}\s*delete\s*\.{2,}\s*(\*/|-->)?\s*$`)

// endDeletePattern matches end delete markers like "// ...end delete...", etc.
var endDeletePattern = regexp.MustCompile(`(?i)^\s*(//|#|--|/\*|\*|<!--|;)\s*\.{2,}\s*end\s*delete\s*\.{2,}\s*(\*/|-->)?\s*$`)

// removeMarkers removes all markers from content
func removeMarkers(content string) string {
	lines := strings.Split(content, "\n")
	var result []string
	inDelete := false
	for _, line := range lines {
		if deletePattern.MatchString(line) {
			inDelete = true
			continue
		}
		if endDeletePattern.MatchString(line) {
			inDelete = false
			continue
		}
		if inDelete {
			continue
		}
		if !existingCodePattern.MatchString(line) {
			result = append(result, line)
		}
	}
	return strings.Join(result, "\n")
}

// removeExistingCodeMarkers removes all "...existing code..." markers from content (legacy, kept for compatibility)
func removeExistingCodeMarkers(content string) string {
	return removeMarkers(content)
}

// applySmartPatch applies a smart patch to existing content
func applySmartPatch(existing, patch string) (string, error) {
	existingLines := strings.Split(existing, "\n")
	patchLines := strings.Split(patch, "\n")

	// Parse patch into segments (context lines and "existing code" markers)
	segments := parsePatchSegments(patchLines)

	if len(segments) == 0 {
		return "Error: empty patch - no content to apply", nil
	}

	// If no special markers, replace entire file
	hasMarkers := false
	for _, seg := range segments {
		if seg.isExistingMarker || seg.isDeleteMarker {
			hasMarkers = true
			break
		}
	}
	if !hasMarkers {
		return patch, nil
	}

	// Build result by processing segments
	return applySegmentsV2(existingLines, segments)
}

// patchSegment represents a segment of the patch
type patchSegment struct {
	lines            []string
	isExistingMarker bool
	isDeleteMarker   bool // marks content to be deleted from existing file
}

// parsePatchSegments parses patch lines into segments
func parsePatchSegments(lines []string) []patchSegment {
	var segments []patchSegment
	var currentLines []string
	inDeleteBlock := false

	for _, line := range lines {
		// Check for delete markers
		if deletePattern.MatchString(line) {
			// Save accumulated lines as a segment
			if len(currentLines) > 0 {
				segments = append(segments, patchSegment{lines: currentLines, isExistingMarker: false})
				currentLines = nil
			}
			inDeleteBlock = true
			continue
		}

		if endDeletePattern.MatchString(line) {
			// Save delete block content
			if len(currentLines) > 0 {
				segments = append(segments, patchSegment{lines: currentLines, isDeleteMarker: true})
				currentLines = nil
			}
			inDeleteBlock = false
			continue
		}

		// Check for existing code markers
		if existingCodePattern.MatchString(line) {
			// Save accumulated lines as a segment
			if len(currentLines) > 0 {
				if inDeleteBlock {
					segments = append(segments, patchSegment{lines: currentLines, isDeleteMarker: true})
				} else {
					segments = append(segments, patchSegment{lines: currentLines, isExistingMarker: false})
				}
				currentLines = nil
			}
			// Add marker segment
			segments = append(segments, patchSegment{isExistingMarker: true})
		} else {
			currentLines = append(currentLines, line)
		}
	}

	// Save remaining lines
	if len(currentLines) > 0 {
		segments = append(segments, patchSegment{lines: currentLines, isExistingMarker: false})
	}

	return segments
}

// applySegmentsV2 applies segments using a search-based approach
func applySegmentsV2(existingLines []string, segments []patchSegment) (string, error) {
	var result []string
	existingIdx := 0

	for i, seg := range segments {
		if seg.isExistingMarker {
			// "...existing code..." marker - we need to preserve content from existing file

			// Determine the range of existing content to preserve:
			// From current existingIdx to where the next patch segment content starts

			preserveEnd := len(existingLines) // default: preserve until end

			// Look for the next content segment to find where to stop preserving
			for j := i + 1; j < len(segments); j++ {
				if !segments[j].isExistingMarker && !segments[j].isDeleteMarker && len(segments[j].lines) > 0 {
					// Find where this content starts in existing file
					anchorIdx, err := findContentStart(existingLines, existingIdx, segments[j].lines)
					if err != nil {
						return fmt.Sprintf("Error applying patch: %v", err), nil
					}
					if anchorIdx >= 0 {
						preserveEnd = anchorIdx
					}
					break
				} else if segments[j].isDeleteMarker && len(segments[j].lines) > 0 {
					// Find where delete content starts in existing file
					anchorIdx, err := findContentStart(existingLines, existingIdx, segments[j].lines)
					if err != nil {
						return fmt.Sprintf("Error applying patch: %v", err), nil
					}
					if anchorIdx >= 0 {
						preserveEnd = anchorIdx
					}
					break
				}
			}

			// Preserve existing content
			if existingIdx < preserveEnd {
				result = append(result, existingLines[existingIdx:preserveEnd]...)
				existingIdx = preserveEnd
			}
		} else if seg.isDeleteMarker {
			// Delete marker - skip the matching content in existing file
			// Find and skip the content that matches the delete block
			if len(seg.lines) > 0 {
				// Find where this content starts
				startIdx, err := findContentStart(existingLines, existingIdx, seg.lines)
				if err != nil {
					return fmt.Sprintf("Error applying patch: %v", err), nil
				}
				if startIdx >= 0 {
					existingIdx = startIdx
				}
				// Find where this content ends and skip it
				endIdx := findContentEnd(existingLines, existingIdx, seg.lines)
				if endIdx > existingIdx {
					existingIdx = endIdx
				}
			}
		} else {
			// Content segment - these are the new/modified lines to include
			result = append(result, seg.lines...)

			// Move past corresponding content in existing file if it matches
			endIdx := findContentEnd(existingLines, existingIdx, seg.lines)
			if endIdx > existingIdx {
				existingIdx = endIdx
			}
		}
	}

	return strings.Join(result, "\n"), nil
}

// ErrMultipleMatches is returned when patch content matches multiple locations
var ErrMultipleMatches = fmt.Errorf("multiple matches found, please provide more context to uniquely identify the location")

// ErrNoMatch is returned when patch content doesn't match any location
var ErrNoMatch = fmt.Errorf("no matching content found in file")

// findContentStart finds where content starts in existing lines
// Returns the index where the content appears, or error if not found or multiple matches
// Uses multiple lines for matching to ensure precise location
func findContentStart(existing []string, startFrom int, content []string) (int, error) {
	if len(content) == 0 {
		return -1, nil
	}

	// Get first few non-empty lines from content for matching
	var anchorLines []string
	for _, line := range content {
		trimmed := strings.TrimSpace(line)
		if trimmed != "" {
			anchorLines = append(anchorLines, trimmed)
			if len(anchorLines) >= 3 { // Use up to 3 lines for matching
				break
			}
		}
	}

	if len(anchorLines) == 0 {
		return -1, nil
	}

	firstLine := anchorLines[0]
	var matches []int

	// Search in existing lines
	for i := startFrom; i < len(existing); i++ {
		if strings.TrimSpace(existing[i]) == firstLine {
			// Found first line match, verify subsequent lines if available
			if len(anchorLines) == 1 {
				matches = append(matches, i)
				continue
			}

			// Check if subsequent anchor lines also match
			match := true
			existIdx := i + 1
			anchorIdx := 1

			for anchorIdx < len(anchorLines) && existIdx < len(existing) {
				existTrimmed := strings.TrimSpace(existing[existIdx])
				// Skip empty lines in existing
				if existTrimmed == "" {
					existIdx++
					continue
				}

				if existTrimmed != anchorLines[anchorIdx] {
					match = false
					break
				}
				anchorIdx++
				existIdx++
			}

			// If we matched all anchor lines
			if match && anchorIdx == len(anchorLines) {
				matches = append(matches, i)
			}
		}
	}

	if len(matches) == 0 {
		return -1, nil // No match found, let caller handle
	}

	if len(matches) > 1 {
		return -1, fmt.Errorf("%w: found %d matches at lines %v. Include more surrounding context (3-5 unique lines) to identify the exact location",
			ErrMultipleMatches, len(matches), matches)
	}

	return matches[0], nil
}

// findContentEnd finds where matching content ends in existing lines
// Returns the index after the last matching line
func findContentEnd(existing []string, startFrom int, content []string) int {
	if len(content) == 0 || startFrom >= len(existing) {
		return startFrom
	}

	// Try to match content lines starting from startFrom
	matched := 0
	existIdx := startFrom
	contentIdx := 0

	for contentIdx < len(content) && existIdx < len(existing) {
		contentLine := strings.TrimSpace(content[contentIdx])
		existLine := strings.TrimSpace(existing[existIdx])

		// Skip empty lines in both
		if contentLine == "" {
			contentIdx++
			continue
		}
		if existLine == "" {
			existIdx++
			continue
		}

		if contentLine == existLine {
			matched++
			contentIdx++
			existIdx++
		} else {
			// Mismatch - try to find next content line in existing
			found := false
			for j := existIdx + 1; j < len(existing) && j < existIdx+5; j++ {
				if strings.TrimSpace(existing[j]) == contentLine {
					existIdx = j + 1
					contentIdx++
					matched++
					found = true
					break
				}
			}
			if !found {
				break
			}
		}
	}

	if matched > 0 {
		return existIdx
	}
	return startFrom
}

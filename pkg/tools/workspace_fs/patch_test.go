package workspace_fs

import (
	"fmt"
	"strings"
	"testing"
)

func TestApplySmartPatch_AddMethod(t *testing.T) {
	existing := `package main

type MyClass struct {
	name string
}

func (c *MyClass) GetName() string {
	return c.name
}
`

	// Patch that adds a new method after existing ones
	// Include full function signature and body structure for precise matching
	patch := `package main

type MyClass struct {
	name string
}

func (c *MyClass) GetName() string {
	return c.name
}

func (c *MyClass) SetName(name string) {
	c.name = name
}
`

	result, err := applySmartPatch(existing, patch)
	if err != nil {
		t.Fatalf("applySmartPatch failed: %v", err)
	}

	// Check that SetName method was added
	if !strings.Contains(result, "func (c *MyClass) SetName") {
		t.Errorf("Expected SetName method in result:\n%s", result)
	}

	// Check that existing GetName method is preserved
	if !strings.Contains(result, "func (c *MyClass) GetName") {
		t.Errorf("Expected GetName method to be preserved in result:\n%s", result)
	}
}

func TestApplySmartPatch_ModifyFunction(t *testing.T) {
	existing := `package main

func hello() string {
	return "hello"
}

func goodbye() string {
	return "goodbye"
}
`

	// Patch that modifies hello and keeps goodbye
	// Using full file replacement since we're modifying specific functions
	patch := `package main

func hello() string {
	return "hello world"
}

func goodbye() string {
	return "goodbye"
}
`

	result, err := applySmartPatch(existing, patch)
	if err != nil {
		t.Fatalf("applySmartPatch failed: %v", err)
	}

	// Check that hello function was modified
	if !strings.Contains(result, `return "hello world"`) {
		t.Errorf("Expected modified hello function in result:\n%s", result)
	}

	// Check that goodbye function is preserved
	if !strings.Contains(result, "func goodbye()") {
		t.Errorf("Expected goodbye function to be preserved in result:\n%s", result)
	}
}

func TestApplySmartPatch_InsertField(t *testing.T) {
	existing := `type Config struct {
	Host string
	Port int
}
`

	// Patch that adds a new field - need to include the closing brace context
	patch := `type Config struct {
	Host string
	Port int
	Timeout int
}
`

	result, err := applySmartPatch(existing, patch)
	if err != nil {
		t.Fatalf("applySmartPatch failed: %v", err)
	}

	// Check that Timeout field was added
	if !strings.Contains(result, "Timeout int") {
		t.Errorf("Expected Timeout field in result:\n%s", result)
	}

	// Check that Port field is preserved
	if !strings.Contains(result, "Port int") {
		t.Errorf("Expected Port field to be preserved in result:\n%s", result)
	}
}

func TestApplySmartPatch_NoMarkers(t *testing.T) {
	existing := `old content`
	patch := `new content`

	result, err := applySmartPatch(existing, patch)
	if err != nil {
		t.Fatalf("applySmartPatch failed: %v", err)
	}

	if result != patch {
		t.Errorf("Expected full replacement when no markers, got:\n%s", result)
	}
}

func TestApplySmartPatch_AddToEnd(t *testing.T) {
	existing := `package main

func foo() {
}
`
	patch := `package main

// ...existing code...

func bar() {
}
`

	result, err := applySmartPatch(existing, patch)
	if err != nil {
		t.Fatalf("applySmartPatch failed: %v", err)
	}

	if !strings.Contains(result, "func foo()") {
		t.Errorf("Expected foo to be preserved:\n%s", result)
	}
	if !strings.Contains(result, "func bar()") {
		t.Errorf("Expected bar to be added:\n%s", result)
	}
}

func TestApplySmartPatch_MultipleMatches(t *testing.T) {
	// Test case with duplicate patterns - should match based on context
	existing := `package main

func process(x int) int {
	return x * 2
}

func process(y string) string {
	return y + y
}

func other() {
}
`

	// Modify the second process function (string version)
	// Use enough context to distinguish from the first one
	patch := `package main

// ...existing code...

func process(y string) string {
	return y + y + y  // Modified: triple instead of double
}

// ...existing code...
`

	result, err := applySmartPatch(existing, patch)
	if err != nil {
		t.Fatalf("applySmartPatch failed: %v", err)
	}

	// First process function should be preserved
	if !strings.Contains(result, "return x * 2") {
		t.Errorf("Expected first process function to be preserved:\n%s", result)
	}

	// Second process function should be modified
	if !strings.Contains(result, "return y + y + y") {
		t.Errorf("Expected second process function to be modified:\n%s", result)
	}

	// other function should be preserved
	if !strings.Contains(result, "func other()") {
		t.Errorf("Expected other function to be preserved:\n%s", result)
	}
}

func TestApplySmartPatch_MultipleMatchesError(t *testing.T) {
	// Test case where context is too ambiguous - should return error
	// Both functions have identical signatures AND body
	existing := `package main

import "fmt"

func doSomething() {
	fmt.Println("hello")
}

func other() {
	fmt.Println("other")
}

func doSomething() {
	fmt.Println("hello")
}
`

	// Patch that has marker followed by ambiguous content
	// The "func doSomething()" with "fmt.Println("hello")" matches two locations
	// We use ONLY the context from the original file to test multiple match detection
	patch := `package main

import "fmt"

// ...existing code...

func doSomething() {
	fmt.Println("hello")
}

// ...existing code...
`

	_, err := applySmartPatch(existing, patch)
	if err == nil {
		t.Fatal("Expected error for multiple matches, but got none")
	}

	if !strings.Contains(err.Error(), "multiple matches") {
		t.Errorf("Expected 'multiple matches' error, got: %v", err)
	}
}

func TestExistingCodePattern(t *testing.T) {
	tests := []struct {
		line    string
		matches bool
	}{
		{"// ...existing code...", true},
		{"// ... existing code ...", true},
		{"# ...existing code...", true},
		{"# ... existing code ...", true},
		{"-- ...existing code...", true},
		{"/* ...existing code... */", true},
		{"  // ...existing code...", true},
		{"// ...EXISTING CODE...", true},
		{"// regular comment", false},
		{"code line", false},
		{"", false},
	}

	for _, tt := range tests {
		t.Run(tt.line, func(t *testing.T) {
			if existingCodePattern.MatchString(tt.line) != tt.matches {
				t.Errorf("Line %q: expected matches=%v", tt.line, tt.matches)
			}
		})
	}
}

func TestApplySmartPatch_DeleteFunction(t *testing.T) {
	existing := `package main

func foo() {
	fmt.Println("foo specific")
}

func bar() {
	fmt.Println("bar specific")
}

func baz() {
	fmt.Println("baz specific")
}
`

	// Delete the bar function using distinct context
	patch := `package main

func foo() {
	fmt.Println("foo specific")
}

// ...delete...
func bar() {
	fmt.Println("bar specific")
}
// ...end delete...

func baz() {
	fmt.Println("baz specific")
}
`

	result, err := applySmartPatch(existing, patch)
	if err != nil {
		t.Fatalf("applySmartPatch failed: %v", err)
	}

	// Check that foo is preserved
	if !strings.Contains(result, "func foo()") {
		t.Errorf("Expected foo to be preserved:\n%s", result)
	}

	// Check that bar is deleted
	if strings.Contains(result, "func bar()") {
		t.Errorf("Expected bar to be deleted:\n%s", result)
	}

	// Check that baz is preserved
	if !strings.Contains(result, "func baz()") {
		t.Errorf("Expected baz to be preserved:\n%s", result)
	}
}

func TestApplySmartPatch_DeleteByOmission(t *testing.T) {
	existing := `package main

func foo() {
}

func bar() {
}

func baz() {
}
`

	// Delete bar by simply not including it between existing markers
	patch := `package main

func foo() {
}

func baz() {
}
`

	result, err := applySmartPatch(existing, patch)
	if err != nil {
		t.Fatalf("applySmartPatch failed: %v", err)
	}

	// No markers means full replacement, so bar should be gone
	if strings.Contains(result, "func bar()") {
		t.Errorf("Expected bar to be deleted:\n%s", result)
	}

	// foo and baz should be present
	if !strings.Contains(result, "func foo()") {
		t.Errorf("Expected foo to be present:\n%s", result)
	}
	if !strings.Contains(result, "func baz()") {
		t.Errorf("Expected baz to be present:\n%s", result)
	}
}

func TestDeletePattern(t *testing.T) {
	tests := []struct {
		line    string
		matches bool
	}{
		{"// ...delete...", true},
		{"// ... delete ...", true},
		{"# ...delete...", true},
		{"  // ...delete...", true},
		{"// ...DELETE...", true},
		{"// regular comment", false},
		{"// ...existing code...", false},
	}

	for _, tt := range tests {
		t.Run(tt.line, func(t *testing.T) {
			if deletePattern.MatchString(tt.line) != tt.matches {
				t.Errorf("Line %q: expected matches=%v", tt.line, tt.matches)
			}
		})
	}
}

func TestEndDeletePattern(t *testing.T) {
	tests := []struct {
		line    string
		matches bool
	}{
		{"// ...end delete...", true},
		{"// ... end delete ...", true},
		{"# ...end delete...", true},
		{"  // ...end delete...", true},
		{"// ...END DELETE...", true},
		{"// ...delete...", false},
		{"// regular comment", false},
	}

	for _, tt := range tests {
		t.Run(tt.line, func(t *testing.T) {
			if endDeletePattern.MatchString(tt.line) != tt.matches {
				t.Errorf("Line %q: expected matches=%v", tt.line, tt.matches)
			}
		})
	}
}

func TestFindContentStart_MultipleMatches(t *testing.T) {
	existing := []string{
		"package main",
		"",
		"func doSomething() {",
		"	fmt.Println(\"hello\")",
		"}",
		"",
		"func other() {",
		"}",
		"",
		"func doSomething() {",
		"	fmt.Println(\"hello\")",
		"}",
	}

	content := []string{
		"func doSomething() {",
		"	fmt.Println(\"hello\")",
		"}",
	}

	_, err := findContentStart(existing, 0, content)
	if err == nil {
		t.Fatal("Expected error for multiple matches, but got none")
	}

	if !strings.Contains(err.Error(), "multiple matches") {
		t.Errorf("Expected 'multiple matches' error, got: %v", err)
	}
}

func TestFindContentStart_SingleMatch(t *testing.T) {
	existing := []string{
		"package main",
		"",
		"func foo() {",
		"	fmt.Println(\"foo\")",
		"}",
		"",
		"func bar() {",
		"	fmt.Println(\"bar\")",
		"}",
	}

	content := []string{
		"func bar() {",
		"	fmt.Println(\"bar\")",
		"}",
	}

	idx, err := findContentStart(existing, 0, content)
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}

	if idx != 6 {
		t.Errorf("Expected index 6, got %d", idx)
	}
}

// ---- Additional Test Cases ----

func TestApplySmartPatch_EmptyPatch(t *testing.T) {
	existing := `package main

func foo() {
}
`
	patch := ``

	// Empty patch with no markers means replace entire file with empty content
	result, err := applySmartPatch(existing, patch)
	if err != nil {
		t.Fatalf("applySmartPatch failed: %v", err)
	}

	if result != "" {
		t.Errorf("Expected empty result for empty patch, got: %q", result)
	}
}

func TestApplySmartPatch_OnlyMarkers(t *testing.T) {
	existing := `package main

func foo() {
}
`
	// Patch with only existing code markers - should preserve all content
	patch := `// ...existing code...`

	result, err := applySmartPatch(existing, patch)
	if err != nil {
		t.Fatalf("applySmartPatch failed: %v", err)
	}

	if !strings.Contains(result, "func foo()") {
		t.Errorf("Expected foo to be preserved:\n%s", result)
	}
}

func TestApplySmartPatch_InsertAtBeginning(t *testing.T) {
	existing := `package main

func existing() {
}
`
	patch := `package main

import "fmt"

// ...existing code...
`

	result, err := applySmartPatch(existing, patch)
	if err != nil {
		t.Fatalf("applySmartPatch failed: %v", err)
	}

	if !strings.Contains(result, `import "fmt"`) {
		t.Errorf("Expected import to be added:\n%s", result)
	}
	if !strings.Contains(result, "func existing()") {
		t.Errorf("Expected existing function to be preserved:\n%s", result)
	}
}

func TestApplySmartPatch_ReplaceMiddleSection(t *testing.T) {
	existing := `package main

func first() {
	// first function
}

func second() {
	// old implementation
}

func third() {
	// third function
}
`
	patch := `package main

func first() {
	// first function
}

func second() {
	// new implementation
	fmt.Println("updated")
}

func third() {
	// third function
}
`

	result, err := applySmartPatch(existing, patch)
	if err != nil {
		t.Fatalf("applySmartPatch failed: %v", err)
	}

	if !strings.Contains(result, "// new implementation") {
		t.Errorf("Expected new implementation:\n%s", result)
	}
	if strings.Contains(result, "// old implementation") {
		t.Errorf("Expected old implementation to be replaced:\n%s", result)
	}
}

func TestApplySmartPatch_MultipleExistingMarkers(t *testing.T) {
	existing := `package main

import (
	"fmt"
	"strings"
)

func foo() {
	fmt.Println("foo")
}

func bar() {
	fmt.Println("bar")
}

func baz() {
	fmt.Println("baz")
}
`
	// Multiple existing markers to preserve different sections
	patch := `package main

// ...existing code...

func bar() {
	fmt.Println("bar modified")
}

// ...existing code...
`

	result, err := applySmartPatch(existing, patch)
	if err != nil {
		t.Fatalf("applySmartPatch failed: %v", err)
	}

	// Imports should be preserved
	if !strings.Contains(result, `"fmt"`) {
		t.Errorf("Expected fmt import to be preserved:\n%s", result)
	}
	// foo should be preserved
	if !strings.Contains(result, "func foo()") {
		t.Errorf("Expected foo to be preserved:\n%s", result)
	}
	// bar should be modified
	if !strings.Contains(result, "bar modified") {
		t.Errorf("Expected bar to be modified:\n%s", result)
	}
	// baz should be preserved
	if !strings.Contains(result, "func baz()") {
		t.Errorf("Expected baz to be preserved:\n%s", result)
	}
}

func TestApplySmartPatch_WhitespaceHandling(t *testing.T) {
	existing := `package main

func foo()    {
	return
}
`
	// Patch with different whitespace
	patch := `package main

func foo() {
	return
	// added comment
}
`

	result, err := applySmartPatch(existing, patch)
	if err != nil {
		t.Fatalf("applySmartPatch failed: %v", err)
	}

	if !strings.Contains(result, "// added comment") {
		t.Errorf("Expected added comment:\n%s", result)
	}
}

func TestApplySmartPatch_NestedStructures(t *testing.T) {
	existing := `package main

type Outer struct {
	Inner struct {
		Value int
	}
}
`
	patch := `package main

type Outer struct {
	Inner struct {
		Value int
		Name  string
	}
}
`

	result, err := applySmartPatch(existing, patch)
	if err != nil {
		t.Fatalf("applySmartPatch failed: %v", err)
	}

	if !strings.Contains(result, "Name  string") {
		t.Errorf("Expected Name field to be added:\n%s", result)
	}
	if !strings.Contains(result, "Value int") {
		t.Errorf("Expected Value field to be preserved:\n%s", result)
	}
}

func TestApplySmartPatch_CommentStyles(t *testing.T) {
	// Test different comment styles for markers
	existing := `# Python file
def foo():
    pass

def bar():
    pass
`
	patch := `# Python file
def foo():
    pass

# ...existing code...
`

	result, err := applySmartPatch(existing, patch)
	if err != nil {
		t.Fatalf("applySmartPatch failed: %v", err)
	}

	if !strings.Contains(result, "def bar():") {
		t.Errorf("Expected bar to be preserved:\n%s", result)
	}
}

func TestApplySmartPatch_SQLCommentStyle(t *testing.T) {
	existing := `-- SQL file
CREATE TABLE users (
    id INT PRIMARY KEY,
    name VARCHAR(100)
);

CREATE TABLE orders (
    id INT PRIMARY KEY
);
`
	patch := `-- SQL file
CREATE TABLE users (
    id INT PRIMARY KEY,
    name VARCHAR(100),
    email VARCHAR(200)
);

-- ...existing code...
`

	result, err := applySmartPatch(existing, patch)
	if err != nil {
		t.Fatalf("applySmartPatch failed: %v", err)
	}

	if !strings.Contains(result, "email VARCHAR(200)") {
		t.Errorf("Expected email field to be added:\n%s", result)
	}
	if !strings.Contains(result, "CREATE TABLE orders") {
		t.Errorf("Expected orders table to be preserved:\n%s", result)
	}
}

func TestApplySmartPatch_DeleteMultipleFunctions(t *testing.T) {
	existing := `package main

func keep1() {}

func delete1() {}

func delete2() {}

func keep2() {}
`
	// Delete two functions
	patch := `package main

func keep1() {}

// ...delete...
func delete1() {}

func delete2() {}
// ...end delete...

func keep2() {}
`

	result, err := applySmartPatch(existing, patch)
	if err != nil {
		t.Fatalf("applySmartPatch failed: %v", err)
	}

	if !strings.Contains(result, "func keep1()") {
		t.Errorf("Expected keep1 to be preserved:\n%s", result)
	}
	if !strings.Contains(result, "func keep2()") {
		t.Errorf("Expected keep2 to be preserved:\n%s", result)
	}
	if strings.Contains(result, "func delete1()") {
		t.Errorf("Expected delete1 to be deleted:\n%s", result)
	}
	if strings.Contains(result, "func delete2()") {
		t.Errorf("Expected delete2 to be deleted:\n%s", result)
	}
}

func TestApplySmartPatch_PreserveEmptyLines(t *testing.T) {
	existing := `package main

func foo() {
}


func bar() {
}
`
	patch := `package main

func foo() {
	// added
}

// ...existing code...
`

	result, err := applySmartPatch(existing, patch)
	if err != nil {
		t.Fatalf("applySmartPatch failed: %v", err)
	}

	if !strings.Contains(result, "// added") {
		t.Errorf("Expected added comment:\n%s", result)
	}
	if !strings.Contains(result, "func bar()") {
		t.Errorf("Expected bar to be preserved:\n%s", result)
	}
}

func TestApplySmartPatch_LargeFile(t *testing.T) {
	// Build a large file with many functions
	var sb strings.Builder
	sb.WriteString("package main\n\n")
	for i := 0; i < 50; i++ {
		sb.WriteString(fmt.Sprintf("func func%d() {\n\t// function %d\n}\n\n", i, i))
	}
	existing := sb.String()

	// Modify function in the middle
	patch := `package main

// ...existing code...

func func25() {
	// modified function 25
}

// ...existing code...
`

	result, err := applySmartPatch(existing, patch)
	if err != nil {
		t.Fatalf("applySmartPatch failed: %v", err)
	}

	if !strings.Contains(result, "// modified function 25") {
		t.Errorf("Expected modified function 25:\n%s", result)
	}
	// Check some other functions are preserved
	if !strings.Contains(result, "func func0()") {
		t.Errorf("Expected func0 to be preserved")
	}
	if !strings.Contains(result, "func func49()") {
		t.Errorf("Expected func49 to be preserved")
	}
}

func TestFindContentStart_EmptyContent(t *testing.T) {
	existing := []string{"line1", "line2"}
	content := []string{}

	idx, err := findContentStart(existing, 0, content)
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if idx != -1 {
		t.Errorf("Expected -1 for empty content, got %d", idx)
	}
}

func TestFindContentStart_NoMatch(t *testing.T) {
	existing := []string{"package main", "func foo() {}"}
	content := []string{"func bar() {}"}

	idx, err := findContentStart(existing, 0, content)
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if idx != -1 {
		t.Errorf("Expected -1 for no match, got %d", idx)
	}
}

func TestFindContentStart_MatchWithOffset(t *testing.T) {
	existing := []string{
		"func foo() {}",
		"func bar() {}",
		"func foo() {}",
	}
	content := []string{"func foo() {}"}

	// Start from index 1, should find the second foo at index 2
	idx, err := findContentStart(existing, 1, content)
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if idx != 2 {
		t.Errorf("Expected index 2, got %d", idx)
	}
}

func TestRemoveMarkers(t *testing.T) {
	input := `package main

// ...existing code...

func foo() {
}

// ...delete...
func bar() {
}
// ...end delete...

func baz() {
}
`
	// removeMarkers removes marker lines and delete block content
	result := removeMarkers(input)

	// Check key elements are present/absent
	if strings.Contains(result, "...existing code...") {
		t.Error("Expected existing code marker to be removed")
	}
	if strings.Contains(result, "...delete...") {
		t.Error("Expected delete marker to be removed")
	}
	if strings.Contains(result, "func bar()") {
		t.Error("Expected bar function to be removed (was in delete block)")
	}
	if !strings.Contains(result, "func foo()") {
		t.Error("Expected foo function to be preserved")
	}
	if !strings.Contains(result, "func baz()") {
		t.Error("Expected baz function to be preserved")
	}
}

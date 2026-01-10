// Package browser provides browser automation tools for AI agents.
// Browsers run in Docker containers using chromedp/headless-shell image.
package browser

import (
	"context"
	"encoding/base64"
	"fmt"
	"strings"
	"time"

	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/components/tool/utils"
	"github.com/cloudwego/eino/schema"

	"github.com/choraleia/choraleia/pkg/tools"
)

func init() {
	// Browser lifecycle tools
	tools.Register(tools.ToolDefinition{
		ID:          "browser_start",
		Name:        "Start Browser",
		Description: "Start a new browser instance in a Docker container",
		Category:    tools.CategoryBrowser,
		Scope:       tools.ScopeBoth,
		Dangerous:   false,
		RequiresEnv: []string{"docker"},
	}, NewBrowserStartTool)

	tools.Register(tools.ToolDefinition{
		ID:          "browser_close",
		Name:        "Close Browser",
		Description: "Close a browser instance",
		Category:    tools.CategoryBrowser,
		Scope:       tools.ScopeBoth,
		Dangerous:   false,
	}, NewBrowserCloseTool)

	tools.Register(tools.ToolDefinition{
		ID:          "browser_list",
		Name:        "List Browsers",
		Description: "List all active browser instances in the current conversation with their status and URLs",
		Category:    tools.CategoryBrowser,
		Scope:       tools.ScopeBoth,
		Dangerous:   false,
	}, NewBrowserListTool)

	// Navigation tools
	tools.Register(tools.ToolDefinition{
		ID:          "browser_go_to_url",
		Name:        "Go To URL",
		Description: "Navigate browser to a URL",
		Category:    tools.CategoryBrowser,
		Scope:       tools.ScopeBoth,
		Dangerous:   false,
	}, NewBrowserGoToURLTool)

	tools.Register(tools.ToolDefinition{
		ID:          "browser_web_search",
		Name:        "Web Search",
		Description: "Perform a web search using Google, Bing, or DuckDuckGo",
		Category:    tools.CategoryBrowser,
		Scope:       tools.ScopeBoth,
		Dangerous:   false,
	}, NewBrowserWebSearchTool)

	// Interaction tools
	tools.Register(tools.ToolDefinition{
		ID:          "browser_click_element",
		Name:        "Click Element",
		Description: "Click an element on the page by CSS selector",
		Category:    tools.CategoryBrowser,
		Scope:       tools.ScopeBoth,
		Dangerous:   false,
	}, NewBrowserClickTool)

	tools.Register(tools.ToolDefinition{
		ID:          "browser_input_text",
		Name:        "Input Text",
		Description: "Type text into an input element",
		Category:    tools.CategoryBrowser,
		Scope:       tools.ScopeBoth,
		Dangerous:   false,
	}, NewBrowserInputTextTool)

	tools.Register(tools.ToolDefinition{
		ID:          "browser_scroll_down",
		Name:        "Scroll Down",
		Description: "Scroll the page down",
		Category:    tools.CategoryBrowser,
		Scope:       tools.ScopeBoth,
		Dangerous:   false,
	}, NewBrowserScrollDownTool)

	tools.Register(tools.ToolDefinition{
		ID:          "browser_scroll_up",
		Name:        "Scroll Up",
		Description: "Scroll the page up",
		Category:    tools.CategoryBrowser,
		Scope:       tools.ScopeBoth,
		Dangerous:   false,
	}, NewBrowserScrollUpTool)

	tools.Register(tools.ToolDefinition{
		ID:          "browser_get_scroll_info",
		Name:        "Get Scroll Info",
		Description: "Get the current scroll position and page dimensions to determine if the page has scrollbars and where the current scroll position is",
		Category:    tools.CategoryBrowser,
		Scope:       tools.ScopeBoth,
		Dangerous:   false,
	}, NewBrowserGetScrollInfoTool)

	// Content tools
	tools.Register(tools.ToolDefinition{
		ID:          "browser_extract_content",
		Name:        "Extract Content",
		Description: "Extract text or HTML content from the page",
		Category:    tools.CategoryBrowser,
		Scope:       tools.ScopeBoth,
		Dangerous:   false,
	}, NewBrowserExtractContentTool)

	tools.Register(tools.ToolDefinition{
		ID:          "browser_screenshot",
		Name:        "Take Screenshot",
		Description: "Take a screenshot of the current page",
		Category:    tools.CategoryBrowser,
		Scope:       tools.ScopeBoth,
		Dangerous:   false,
	}, NewBrowserScreenshotTool)

	// Wait tool
	tools.Register(tools.ToolDefinition{
		ID:          "browser_wait",
		Name:        "Wait",
		Description: "Wait for an element to appear or a specified duration",
		Category:    tools.CategoryBrowser,
		Scope:       tools.ScopeBoth,
		Dangerous:   false,
	}, NewBrowserWaitTool)

	// Tab management tools
	tools.Register(tools.ToolDefinition{
		ID:          "browser_open_tab",
		Name:        "Open Tab",
		Description: "Open a new browser tab with the specified URL",
		Category:    tools.CategoryBrowser,
		Scope:       tools.ScopeBoth,
		Dangerous:   false,
	}, NewBrowserOpenTabTool)

	tools.Register(tools.ToolDefinition{
		ID:          "browser_switch_tab",
		Name:        "Switch Tab",
		Description: "Switch to a different browser tab by index",
		Category:    tools.CategoryBrowser,
		Scope:       tools.ScopeBoth,
		Dangerous:   false,
	}, NewBrowserSwitchTabTool)

	tools.Register(tools.ToolDefinition{
		ID:          "browser_close_tab",
		Name:        "Close Tab",
		Description: "Close a browser tab by index (cannot close the last tab)",
		Category:    tools.CategoryBrowser,
		Scope:       tools.ScopeBoth,
		Dangerous:   false,
	}, NewBrowserCloseTabTool)

	tools.Register(tools.ToolDefinition{
		ID:          "browser_list_tabs",
		Name:        "List Tabs",
		Description: "List all tabs in a browser instance with their URLs and titles",
		Category:    tools.CategoryBrowser,
		Scope:       tools.ScopeBoth,
		Dangerous:   false,
	}, NewBrowserListTabsTool)
}

// ---- Browser Start Tool ----

type BrowserStartInput struct{}

func NewBrowserStartTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name:        "browser_start",
		Desc:        "Start a new browser instance in a Docker container. Returns the browser_id which must be used for all subsequent browser operations. The browser will automatically close after 10 minutes of inactivity.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{}),
	}, func(ctx context.Context, input *BrowserStartInput) (string, error) {
		if tc.BrowserService == nil {
			return "Error: browser service not available", nil
		}
		if tc.ConversationID == "" {
			return "Error: conversation context required for browser operations", nil
		}

		instance, err := tc.BrowserService.StartBrowser(ctx, tc.ConversationID)
		if err != nil {
			return fmt.Sprintf("Error: failed to start browser: %v", err), nil
		}

		return fmt.Sprintf("Browser started successfully.\nbrowser_id: %s\nStatus: %s\nUse this browser_id for all subsequent browser operations.", instance.ID, instance.Status), nil
	})
}

// ---- Browser Close Tool ----

type BrowserCloseInput struct {
	BrowserID string `json:"browser_id"`
}

func NewBrowserCloseTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "browser_close",
		Desc: "Close a browser instance and release its resources.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"browser_id": {Type: schema.String, Required: true, Desc: "The browser instance ID to close"},
		}),
	}, func(ctx context.Context, input *BrowserCloseInput) (string, error) {
		if tc.BrowserService == nil {
			return "Error: browser service not available", nil
		}

		if err := tc.BrowserService.CloseBrowser(input.BrowserID); err != nil {
			return fmt.Sprintf("Error: %v", err), nil
		}

		return "Browser closed successfully.", nil
	})
}

// ---- Browser List Tool ----

type BrowserListInput struct{}

func NewBrowserListTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name:        "browser_list",
		Desc:        "List all active browser instances in the current conversation. Use this to check which browsers are running and their current state before performing browser operations.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{}),
	}, func(ctx context.Context, input *BrowserListInput) (string, error) {
		if tc.BrowserService == nil {
			return "Error: browser service not available", nil
		}
		if tc.ConversationID == "" {
			return "No active browsers (no conversation context)", nil
		}

		browsers := tc.BrowserService.ListBrowsers(tc.ConversationID)
		if len(browsers) == 0 {
			return "No active browsers in this conversation. Use browser_start to create a new browser instance.", nil
		}

		var sb strings.Builder
		sb.WriteString(fmt.Sprintf("Active browsers in this conversation: %d\n\n", len(browsers)))

		for i, b := range browsers {
			sb.WriteString(fmt.Sprintf("Browser %d:\n", i+1))
			sb.WriteString(fmt.Sprintf("  browser_id: %s\n", b.ID))
			sb.WriteString(fmt.Sprintf("  status: %s\n", b.Status))
			sb.WriteString(fmt.Sprintf("  current_url: %s\n", b.CurrentURL))
			sb.WriteString(fmt.Sprintf("  current_title: %s\n", b.CurrentTitle))
			sb.WriteString(fmt.Sprintf("  tabs: %d (active: %d)\n", len(b.Tabs), b.ActiveTab))
			if b.ErrorMessage != "" {
				sb.WriteString(fmt.Sprintf("  error: %s\n", b.ErrorMessage))
			}
			sb.WriteString("\n")
		}

		return sb.String(), nil
	})
}

// ---- Browser Go To URL Tool ----

type BrowserGoToURLInput struct {
	BrowserID string `json:"browser_id"`
	URL       string `json:"url"`
}

func NewBrowserGoToURLTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "browser_go_to_url",
		Desc: "Navigate the browser to a specified URL and wait for the page to load.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"browser_id": {Type: schema.String, Required: true, Desc: "The browser instance ID"},
			"url":        {Type: schema.String, Required: true, Desc: "The URL to navigate to (e.g., 'https://example.com')"},
		}),
	}, func(ctx context.Context, input *BrowserGoToURLInput) (string, error) {
		if tc.BrowserService == nil {
			return "Error: browser service not available", nil
		}

		if err := tc.BrowserService.Navigate(ctx, input.BrowserID, input.URL); err != nil {
			return fmt.Sprintf("Error: %v", err), nil
		}

		instance, _ := tc.BrowserService.GetBrowser(input.BrowserID)
		title := ""
		if instance != nil {
			title = instance.CurrentTitle
		}

		return fmt.Sprintf("Navigated to: %s\nPage title: %s", input.URL, title), nil
	})
}

// ---- Browser Web Search Tool ----

type BrowserWebSearchInput struct {
	BrowserID string `json:"browser_id"`
	Query     string `json:"query"`
	Engine    string `json:"engine,omitempty"`
}

func NewBrowserWebSearchTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "browser_web_search",
		Desc: "Perform a web search using a search engine.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"browser_id": {Type: schema.String, Required: true, Desc: "The browser instance ID"},
			"query":      {Type: schema.String, Required: true, Desc: "The search query"},
			"engine":     {Type: schema.String, Required: false, Desc: "Search engine to use: 'google' (default), 'bing', or 'duckduckgo'"},
		}),
	}, func(ctx context.Context, input *BrowserWebSearchInput) (string, error) {
		if tc.BrowserService == nil {
			return "Error: browser service not available", nil
		}

		engine := input.Engine
		if engine == "" {
			engine = "google"
		}

		if err := tc.BrowserService.WebSearch(ctx, input.BrowserID, input.Query, engine); err != nil {
			return fmt.Sprintf("Error: %v", err), nil
		}

		return fmt.Sprintf("Search completed for: %s (using %s)", input.Query, engine), nil
	})
}

// ---- Browser Click Tool ----

type BrowserClickInput struct {
	BrowserID string `json:"browser_id"`
	Selector  string `json:"selector"`
}

func NewBrowserClickTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "browser_click_element",
		Desc: "Click an element on the page. The element is identified by a CSS selector.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"browser_id": {Type: schema.String, Required: true, Desc: "The browser instance ID"},
			"selector":   {Type: schema.String, Required: true, Desc: "CSS selector for the element to click (e.g., 'button.submit', '#login-btn', 'a[href=\"/next\"]')"},
		}),
	}, func(ctx context.Context, input *BrowserClickInput) (string, error) {
		if tc.BrowserService == nil {
			return "Error: browser service not available", nil
		}

		if err := tc.BrowserService.Click(ctx, input.BrowserID, input.Selector); err != nil {
			return fmt.Sprintf("Error: %v", err), nil
		}

		return fmt.Sprintf("Clicked element: %s", input.Selector), nil
	})
}

// ---- Browser Input Text Tool ----

type BrowserInputTextInput struct {
	BrowserID string `json:"browser_id"`
	Selector  string `json:"selector"`
	Text      string `json:"text"`
	Clear     bool   `json:"clear,omitempty"`
}

func NewBrowserInputTextTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "browser_input_text",
		Desc: "Type text into an input element on the page.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"browser_id": {Type: schema.String, Required: true, Desc: "The browser instance ID"},
			"selector":   {Type: schema.String, Required: true, Desc: "CSS selector for the input element (e.g., 'input[name=\"username\"]', '#search-box')"},
			"text":       {Type: schema.String, Required: true, Desc: "The text to type into the element"},
			"clear":      {Type: schema.Boolean, Required: false, Desc: "Whether to clear the input before typing (default: false)"},
		}),
	}, func(ctx context.Context, input *BrowserInputTextInput) (string, error) {
		if tc.BrowserService == nil {
			return "Error: browser service not available", nil
		}

		if err := tc.BrowserService.InputText(ctx, input.BrowserID, input.Selector, input.Text, input.Clear); err != nil {
			return fmt.Sprintf("Error: %v", err), nil
		}

		return fmt.Sprintf("Entered text into: %s", input.Selector), nil
	})
}

// ---- Browser Scroll Down Tool ----

type BrowserScrollDownInput struct {
	BrowserID string `json:"browser_id"`
	Amount    int    `json:"amount,omitempty"`
}

func NewBrowserScrollDownTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "browser_scroll_down",
		Desc: "Scroll the page down by a specified amount in pixels.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"browser_id": {Type: schema.String, Required: true, Desc: "The browser instance ID"},
			"amount":     {Type: schema.Integer, Required: false, Desc: "Pixels to scroll down (default: 500)"},
		}),
	}, func(ctx context.Context, input *BrowserScrollDownInput) (string, error) {
		if tc.BrowserService == nil {
			return "Error: browser service not available", nil
		}

		amount := input.Amount
		if amount <= 0 {
			amount = 500
		}

		if err := tc.BrowserService.Scroll(ctx, input.BrowserID, "down", amount); err != nil {
			return fmt.Sprintf("Error: %v", err), nil
		}

		return fmt.Sprintf("Scrolled down %d pixels", amount), nil
	})
}

// ---- Browser Scroll Up Tool ----

type BrowserScrollUpInput struct {
	BrowserID string `json:"browser_id"`
	Amount    int    `json:"amount,omitempty"`
}

func NewBrowserScrollUpTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "browser_scroll_up",
		Desc: "Scroll the page up by a specified amount in pixels.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"browser_id": {Type: schema.String, Required: true, Desc: "The browser instance ID"},
			"amount":     {Type: schema.Integer, Required: false, Desc: "Pixels to scroll up (default: 500)"},
		}),
	}, func(ctx context.Context, input *BrowserScrollUpInput) (string, error) {
		if tc.BrowserService == nil {
			return "Error: browser service not available", nil
		}

		amount := input.Amount
		if amount <= 0 {
			amount = 500
		}

		if err := tc.BrowserService.Scroll(ctx, input.BrowserID, "up", amount); err != nil {
			return fmt.Sprintf("Error: %v", err), nil
		}

		return fmt.Sprintf("Scrolled up %d pixels", amount), nil
	})
}

// ---- Browser Get Scroll Info Tool ----

type BrowserGetScrollInfoInput struct {
	BrowserID string `json:"browser_id"`
}

func NewBrowserGetScrollInfoTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "browser_get_scroll_info",
		Desc: "Get the current scroll position and page dimensions. Returns information about whether the page has scrollbars, current scroll position, total page dimensions, and whether the page is scrolled to top/bottom/left/right. Use this before scrolling to understand the page layout.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"browser_id": {Type: schema.String, Required: true, Desc: "The browser instance ID"},
		}),
	}, func(ctx context.Context, input *BrowserGetScrollInfoInput) (string, error) {
		if tc.BrowserService == nil {
			return "Error: browser service not available", nil
		}

		info, err := tc.BrowserService.GetScrollInfo(ctx, input.BrowserID)
		if err != nil {
			return fmt.Sprintf("Error: %v", err), nil
		}

		// Format the response in a clear way for the AI
		var sb strings.Builder
		sb.WriteString("Page Scroll Information:\n")
		sb.WriteString(fmt.Sprintf("- Viewport size: %d x %d pixels\n", info.ClientWidth, info.ClientHeight))
		sb.WriteString(fmt.Sprintf("- Total page size: %d x %d pixels\n", info.ScrollWidth, info.ScrollHeight))
		sb.WriteString(fmt.Sprintf("- Has vertical scrollbar: %v\n", info.HasScrollbarY))
		sb.WriteString(fmt.Sprintf("- Has horizontal scrollbar: %v\n", info.HasScrollbarX))

		if info.HasScrollbarY {
			sb.WriteString(fmt.Sprintf("- Vertical scroll position: %d pixels (%.0f%% from top)\n", info.ScrollY, float64(info.PercentY)))
			if info.AtTop {
				sb.WriteString("- Currently at: TOP of page\n")
			} else if info.AtBottom {
				sb.WriteString("- Currently at: BOTTOM of page\n")
			} else {
				sb.WriteString("- Currently at: MIDDLE of page\n")
			}
			remainingDown := info.ScrollHeight - info.ClientHeight - info.ScrollY
			if remainingDown < 0 {
				remainingDown = 0
			}
			sb.WriteString(fmt.Sprintf("- Can scroll up: %d pixels\n", info.ScrollY))
			sb.WriteString(fmt.Sprintf("- Can scroll down: %d pixels\n", remainingDown))
		} else {
			sb.WriteString("- No vertical scrolling needed (content fits in viewport)\n")
		}

		if info.HasScrollbarX {
			sb.WriteString(fmt.Sprintf("- Horizontal scroll position: %d pixels (%.0f%% from left)\n", info.ScrollX, float64(info.PercentX)))
		}

		return sb.String(), nil
	})
}

// ---- Browser Extract Content Tool ----

type BrowserExtractContentInput struct {
	BrowserID   string `json:"browser_id"`
	Selector    string `json:"selector,omitempty"`
	ContentType string `json:"content_type,omitempty"`
}

func NewBrowserExtractContentTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "browser_extract_content",
		Desc: "Extract text or HTML content from the current page or a specific element.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"browser_id":   {Type: schema.String, Required: true, Desc: "The browser instance ID"},
			"selector":     {Type: schema.String, Required: false, Desc: "CSS selector for the element to extract from (default: 'body')"},
			"content_type": {Type: schema.String, Required: false, Desc: "Type of content to extract: 'html' (default) or 'text'"},
		}),
	}, func(ctx context.Context, input *BrowserExtractContentInput) (string, error) {
		if tc.BrowserService == nil {
			return "Error: browser service not available", nil
		}

		selector := input.Selector
		if selector == "" {
			selector = "body"
		}

		contentType := input.ContentType
		if contentType == "" {
			contentType = "text"
		}

		content, err := tc.BrowserService.ExtractContent(ctx, input.BrowserID, selector, contentType)
		if err != nil {
			return fmt.Sprintf("Error: %v", err), nil
		}

		// Truncate if too long
		if len(content) > 10000 {
			content = content[:10000] + "\n... (content truncated)"
		}

		return fmt.Sprintf("Extracted %s content from '%s':\n\n%s", contentType, selector, content), nil
	})
}

// ---- Browser Screenshot Tool ----

type BrowserScreenshotInput struct {
	BrowserID string `json:"browser_id"`
	FullPage  bool   `json:"full_page,omitempty"`
}

func NewBrowserScreenshotTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "browser_screenshot",
		Desc: "Take a screenshot of the current page. Returns the screenshot as base64-encoded PNG.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"browser_id": {Type: schema.String, Required: true, Desc: "The browser instance ID"},
			"full_page":  {Type: schema.Boolean, Required: false, Desc: "Whether to capture the full page (default: false, captures viewport only)"},
		}),
	}, func(ctx context.Context, input *BrowserScreenshotInput) (string, error) {
		if tc.BrowserService == nil {
			return "Error: browser service not available", nil
		}

		data, err := tc.BrowserService.Screenshot(ctx, input.BrowserID, input.FullPage)
		if err != nil {
			return fmt.Sprintf("Error: %v", err), nil
		}

		encoded := base64.StdEncoding.EncodeToString(data)
		return fmt.Sprintf("Screenshot captured (%d bytes).\nBase64 PNG:\n%s", len(data), encoded), nil
	})
}

// ---- Browser Wait Tool ----

type BrowserWaitInput struct {
	BrowserID string `json:"browser_id"`
	Selector  string `json:"selector,omitempty"`
	Seconds   int    `json:"seconds,omitempty"`
}

func NewBrowserWaitTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "browser_wait",
		Desc: "Wait for an element to become visible or wait for a specified duration.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"browser_id": {Type: schema.String, Required: true, Desc: "The browser instance ID"},
			"selector":   {Type: schema.String, Required: false, Desc: "CSS selector to wait for (if provided, waits for element to be visible)"},
			"seconds":    {Type: schema.Integer, Required: false, Desc: "Seconds to wait (default: 5). If selector is provided, this is the timeout."},
		}),
	}, func(ctx context.Context, input *BrowserWaitInput) (string, error) {
		if tc.BrowserService == nil {
			return "Error: browser service not available", nil
		}

		seconds := input.Seconds
		if seconds <= 0 {
			seconds = 5
		}
		timeout := time.Duration(seconds) * time.Second

		if err := tc.BrowserService.Wait(ctx, input.BrowserID, input.Selector, timeout); err != nil {
			return fmt.Sprintf("Error: %v", err), nil
		}

		if input.Selector != "" {
			return fmt.Sprintf("Element '%s' is now visible", input.Selector), nil
		}
		return fmt.Sprintf("Waited %d seconds", seconds), nil
	})
}

// ---- Browser Open Tab Tool ----

type BrowserOpenTabInput struct {
	BrowserID string `json:"browser_id"`
	URL       string `json:"url,omitempty"`
}

func NewBrowserOpenTabTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "browser_open_tab",
		Desc: "Open a new browser tab, optionally navigating to a URL.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"browser_id": {Type: schema.String, Required: true, Desc: "The browser instance ID"},
			"url":        {Type: schema.String, Required: false, Desc: "URL to open in the new tab (default: about:blank)"},
		}),
	}, func(ctx context.Context, input *BrowserOpenTabInput) (string, error) {
		if tc.BrowserService == nil {
			return "Error: browser service not available", nil
		}

		url := input.URL
		if url == "" {
			url = "about:blank"
		}

		if err := tc.BrowserService.OpenTab(ctx, input.BrowserID, url); err != nil {
			return fmt.Sprintf("Error: %v", err), nil
		}

		instance, _ := tc.BrowserService.GetBrowser(input.BrowserID)
		tabCount := 0
		if instance != nil {
			tabCount = len(instance.Tabs)
		}

		return fmt.Sprintf("Opened new tab (tab index: %d) with URL: %s", tabCount-1, url), nil
	})
}

// ---- Browser Switch Tab Tool ----

type BrowserSwitchTabInput struct {
	BrowserID string `json:"browser_id"`
	TabIndex  int    `json:"tab_index"`
}

func NewBrowserSwitchTabTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "browser_switch_tab",
		Desc: "Switch to a different browser tab by index.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"browser_id": {Type: schema.String, Required: true, Desc: "The browser instance ID"},
			"tab_index":  {Type: schema.Integer, Required: true, Desc: "The index of the tab to switch to (0-based)"},
		}),
	}, func(ctx context.Context, input *BrowserSwitchTabInput) (string, error) {
		if tc.BrowserService == nil {
			return "Error: browser service not available", nil
		}

		if err := tc.BrowserService.SwitchTab(ctx, input.BrowserID, input.TabIndex); err != nil {
			return fmt.Sprintf("Error: %v", err), nil
		}

		instance, _ := tc.BrowserService.GetBrowser(input.BrowserID)
		var sb strings.Builder
		sb.WriteString(fmt.Sprintf("Switched to tab %d", input.TabIndex))
		if instance != nil && input.TabIndex < len(instance.Tabs) {
			sb.WriteString(fmt.Sprintf("\nURL: %s", instance.Tabs[input.TabIndex].URL))
			sb.WriteString(fmt.Sprintf("\nTitle: %s", instance.Tabs[input.TabIndex].Title))
		}

		return sb.String(), nil
	})
}

// ---- Browser Close Tab Tool ----

type BrowserCloseTabInput struct {
	BrowserID string `json:"browser_id"`
	TabIndex  int    `json:"tab_index"`
}

func NewBrowserCloseTabTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "browser_close_tab",
		Desc: "Close a browser tab by index. Cannot close the last remaining tab.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"browser_id": {Type: schema.String, Required: true, Desc: "The browser instance ID"},
			"tab_index":  {Type: schema.Integer, Required: true, Desc: "The index of the tab to close (0-based)"},
		}),
	}, func(ctx context.Context, input *BrowserCloseTabInput) (string, error) {
		if tc.BrowserService == nil {
			return "Error: browser service not available", nil
		}

		if err := tc.BrowserService.CloseTab(ctx, input.BrowserID, input.TabIndex); err != nil {
			return fmt.Sprintf("Error: %v", err), nil
		}

		instance, _ := tc.BrowserService.GetBrowser(input.BrowserID)
		tabCount := 0
		activeTab := 0
		if instance != nil {
			tabCount = len(instance.Tabs)
			activeTab = instance.ActiveTab
		}

		return fmt.Sprintf("Closed tab %d. Remaining tabs: %d, active tab: %d", input.TabIndex, tabCount, activeTab), nil
	})
}

// ---- Browser List Tabs Tool ----

type BrowserListTabsInput struct {
	BrowserID string `json:"browser_id"`
}

func NewBrowserListTabsTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "browser_list_tabs",
		Desc: "List all tabs in a browser instance. Returns the tab index, URL, and title for each tab, and indicates which tab is currently active.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"browser_id": {Type: schema.String, Required: true, Desc: "The browser instance ID"},
		}),
	}, func(ctx context.Context, input *BrowserListTabsInput) (string, error) {
		if tc.BrowserService == nil {
			return "Error: browser service not available", nil
		}

		instance, err := tc.BrowserService.GetBrowser(input.BrowserID)
		if err != nil {
			return fmt.Sprintf("Error: %v", err), nil
		}

		if len(instance.Tabs) == 0 {
			return "No tabs open in this browser.", nil
		}

		var sb strings.Builder
		sb.WriteString(fmt.Sprintf("Browser %s has %d tab(s):\n\n", input.BrowserID[:8], len(instance.Tabs)))

		for i, tab := range instance.Tabs {
			activeMarker := ""
			if i == instance.ActiveTab {
				activeMarker = " [ACTIVE]"
			}
			sb.WriteString(fmt.Sprintf("Tab %d%s:\n", i, activeMarker))
			sb.WriteString(fmt.Sprintf("  URL: %s\n", tab.URL))
			sb.WriteString(fmt.Sprintf("  Title: %s\n", tab.Title))
			sb.WriteString("\n")
		}

		return sb.String(), nil
	})
}

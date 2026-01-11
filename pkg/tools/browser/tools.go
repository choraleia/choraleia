// Package browser provides browser automation tools for AI agents.
// Browsers run in Docker containers using chromedp/headless-shell image.
package browser

import (
	"context"
	"encoding/base64"
	"fmt"
	"strings"
	"time"

	"github.com/choraleia/choraleia/pkg/models"
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
		ID:          "browser_back",
		Name:        "Go Back",
		Description: "Navigate back to the previous page in browser history",
		Category:    tools.CategoryBrowser,
		Scope:       tools.ScopeBoth,
		Dangerous:   false,
	}, NewBrowserBackTool)

	tools.Register(tools.ToolDefinition{
		ID:          "browser_forward",
		Name:        "Go Forward",
		Description: "Navigate forward to the next page in browser history",
		Category:    tools.CategoryBrowser,
		Scope:       tools.ScopeBoth,
		Dangerous:   false,
	}, NewBrowserForwardTool)

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
		ID:          "browser_scroll",
		Name:        "Scroll Page",
		Description: "Scroll the page in any direction (up, down, left, right)",
		Category:    tools.CategoryBrowser,
		Scope:       tools.ScopeBoth,
		Dangerous:   false,
	}, NewBrowserScrollTool)

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

	// Vision-based tools (for visual automation)
	tools.Register(tools.ToolDefinition{
		ID:          "browser_get_visual_state",
		Name:        "Get Visual State",
		Description: "Get a screenshot with labeled interactive elements. Returns a screenshot image with numbered labels on clickable elements, plus a list of all elements with their labels, types, and text. Use this to 'see' the page and interact by label number.",
		Category:    tools.CategoryBrowser,
		Scope:       tools.ScopeBoth,
		Dangerous:   false,
	}, NewBrowserGetVisualStateTool)

	tools.Register(tools.ToolDefinition{
		ID:          "browser_click_at",
		Name:        "Click At Coordinates",
		Description: "Click at specific x, y coordinates on the page. Use when you know exact pixel coordinates.",
		Category:    tools.CategoryBrowser,
		Scope:       tools.ScopeBoth,
		Dangerous:   false,
	}, NewBrowserClickAtTool)

	tools.Register(tools.ToolDefinition{
		ID:          "browser_click_label",
		Name:        "Click By Label",
		Description: "Click an element by its label number from browser_get_visual_state. First call browser_get_visual_state, then use the label number to click the desired element.",
		Category:    tools.CategoryBrowser,
		Scope:       tools.ScopeBoth,
		Dangerous:   false,
	}, NewBrowserClickLabelTool)

	tools.Register(tools.ToolDefinition{
		ID:          "browser_type",
		Name:        "Type Text",
		Description: "Type text at the current cursor position. First click on an input field using browser_click_label or browser_click_at, then use this to type text.",
		Category:    tools.CategoryBrowser,
		Scope:       tools.ScopeBoth,
		Dangerous:   false,
	}, NewBrowserTypeTool)

	tools.Register(tools.ToolDefinition{
		ID:          "browser_press_key",
		Name:        "Press Key",
		Description: "Press a special key like Enter, Tab, Escape, Backspace, Delete, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Home, End, PageUp, PageDown, or Space.",
		Category:    tools.CategoryBrowser,
		Scope:       tools.ScopeBoth,
		Dangerous:   false,
	}, NewBrowserPressKeyTool)
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

// ---- Browser Back Tool ----

type BrowserBackInput struct {
	BrowserID string `json:"browser_id"`
}

func NewBrowserBackTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "browser_back",
		Desc: "Navigate back to the previous page in browser history. Equivalent to clicking the browser's back button.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"browser_id": {Type: schema.String, Required: true, Desc: "The browser instance ID"},
		}),
	}, func(ctx context.Context, input *BrowserBackInput) (string, error) {
		if tc.BrowserService == nil {
			return "Error: browser service not available", nil
		}

		if err := tc.BrowserService.GoBack(ctx, input.BrowserID); err != nil {
			return fmt.Sprintf("Error: %v", err), nil
		}

		instance, _ := tc.BrowserService.GetBrowser(input.BrowserID)
		url, title := "", ""
		if instance != nil {
			url = instance.CurrentURL
			title = instance.CurrentTitle
		}

		return fmt.Sprintf("Navigated back.\nCurrent URL: %s\nPage title: %s", url, title), nil
	})
}

// ---- Browser Forward Tool ----

type BrowserForwardInput struct {
	BrowserID string `json:"browser_id"`
}

func NewBrowserForwardTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "browser_forward",
		Desc: "Navigate forward to the next page in browser history. Equivalent to clicking the browser's forward button.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"browser_id": {Type: schema.String, Required: true, Desc: "The browser instance ID"},
		}),
	}, func(ctx context.Context, input *BrowserForwardInput) (string, error) {
		if tc.BrowserService == nil {
			return "Error: browser service not available", nil
		}

		if err := tc.BrowserService.GoForward(ctx, input.BrowserID); err != nil {
			return fmt.Sprintf("Error: %v", err), nil
		}

		instance, _ := tc.BrowserService.GetBrowser(input.BrowserID)
		url, title := "", ""
		if instance != nil {
			url = instance.CurrentURL
			title = instance.CurrentTitle
		}

		return fmt.Sprintf("Navigated forward.\nCurrent URL: %s\nPage title: %s", url, title), nil
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

// ---- Browser Scroll Tool ----

type BrowserScrollInput struct {
	BrowserID string `json:"browser_id"`
	Direction string `json:"direction"`
	Amount    int    `json:"amount,omitempty"`
}

func NewBrowserScrollTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "browser_scroll",
		Desc: "Scroll the page in any direction by a specified amount in pixels.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"browser_id": {Type: schema.String, Required: true, Desc: "The browser instance ID"},
			"direction":  {Type: schema.String, Required: true, Desc: "Scroll direction: 'up', 'down', 'left', or 'right'"},
			"amount":     {Type: schema.Integer, Required: false, Desc: "Pixels to scroll (default: 500)"},
		}),
	}, func(ctx context.Context, input *BrowserScrollInput) (string, error) {
		if tc.BrowserService == nil {
			return "Error: browser service not available", nil
		}

		direction := strings.ToLower(input.Direction)
		if direction != "up" && direction != "down" && direction != "left" && direction != "right" {
			return "Error: direction must be 'up', 'down', 'left', or 'right'", nil
		}

		amount := input.Amount
		if amount <= 0 {
			amount = 500
		}

		if err := tc.BrowserService.Scroll(ctx, input.BrowserID, direction, amount); err != nil {
			return fmt.Sprintf("Error: %v", err), nil
		}

		return fmt.Sprintf("Scrolled %s %d pixels", direction, amount), nil
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

// ---- Vision-Based Tools ----

// ---- Browser Get Visual State Tool ----

type BrowserGetVisualStateInput struct {
	BrowserID    string `json:"browser_id"`
	AnalyzeImage bool   `json:"analyze_image,omitempty"`
}

func NewBrowserGetVisualStateTool(tc *tools.ToolContext) tool.InvokableTool {
	// Determine description based on whether vision model is configured
	desc := "Get the current page state with numbered labels on all interactive elements (links, buttons, inputs, etc.). Returns a list of all labeled elements with their details."
	if tc.VisionModelID != "" {
		desc += " Set analyze_image=true to use the configured vision AI model to describe the page visually."
	} else {
		desc += " Vision analysis is not available (no vision model configured in workspace tools)."
	}

	return utils.NewTool(&schema.ToolInfo{
		Name: "browser_get_visual_state",
		Desc: desc,
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"browser_id":    {Type: schema.String, Required: true, Desc: "The browser instance ID"},
			"analyze_image": {Type: schema.Boolean, Required: false, Desc: "If true, use a vision AI model to analyze and describe the screenshot (default: false, requires vision model configured)"},
		}),
	}, func(ctx context.Context, input *BrowserGetVisualStateInput) (string, error) {
		if tc.BrowserService == nil {
			return "Error: browser service not available", nil
		}

		state, err := tc.BrowserService.GetVisualState(ctx, input.BrowserID)
		if err != nil {
			return fmt.Sprintf("Error: %v", err), nil
		}

		var sb strings.Builder
		sb.WriteString("=== Page Visual State ===\n")
		sb.WriteString(fmt.Sprintf("Title: %s\n", state.Title))
		sb.WriteString(fmt.Sprintf("URL: %s\n", state.URL))
		sb.WriteString(fmt.Sprintf("Viewport: %dx%d pixels\n", state.ViewportSize.Width, state.ViewportSize.Height))

		if state.ScrollInfo != nil {
			sb.WriteString(fmt.Sprintf("Scroll Position: %d%% from top", state.ScrollInfo.PercentY))
			if state.ScrollInfo.AtTop {
				sb.WriteString(" (at TOP)")
			} else if state.ScrollInfo.AtBottom {
				sb.WriteString(" (at BOTTOM)")
			}
			sb.WriteString("\n")
		}

		// If vision analysis is requested
		if input.AnalyzeImage {
			if tc.ModelService == nil {
				sb.WriteString("\n=== Vision Analysis (Error) ===\nModel service not available\n")
			} else if tc.VisionModelID == "" {
				sb.WriteString("\n=== Vision Analysis (Error) ===\nNo vision model configured. Please configure a vision model in workspace browser tools settings.\n")
			} else {
				imageDataURI := fmt.Sprintf("data:image/png;base64,%s", base64.StdEncoding.EncodeToString(state.Screenshot))

				prompt := `Analyze this webpage screenshot with numbered labels on interactive elements. Describe:
1. The overall layout and purpose of the page
2. Key visual elements and content visible
3. Notable interactive elements you can see (buttons, forms, links, etc.)
4. Any important information displayed on the page
Be concise but comprehensive.`

				analysis, err := analyzeImage(ctx, tc, imageDataURI, prompt, tc.VisionModelID)
				if err != nil {
					sb.WriteString(fmt.Sprintf("\n=== Vision Analysis (Error) ===\n%v\n", err))
				} else {
					sb.WriteString(fmt.Sprintf("\n=== Vision Analysis ===\n%s\n", analysis))
				}
			}
		}

		sb.WriteString(fmt.Sprintf("\n=== Interactive Elements (%d found) ===\n", len(state.Elements)))
		sb.WriteString("Format: [label] tag[type] \"text\" (placeholder) -> href @(x,y)\n\n")

		for _, el := range state.Elements {
			sb.WriteString(fmt.Sprintf("[%s] %s", el.Label, el.Tag))
			if el.Type != "" {
				sb.WriteString(fmt.Sprintf("[%s]", el.Type))
			}
			if el.Text != "" {
				text := el.Text
				if len(text) > 60 {
					text = text[:60] + "..."
				}
				sb.WriteString(fmt.Sprintf(" \"%s\"", text))
			}
			if el.Placeholder != "" {
				sb.WriteString(fmt.Sprintf(" (placeholder: \"%s\")", el.Placeholder))
			}
			if el.Href != "" && el.Tag == "a" {
				href := el.Href
				if len(href) > 50 {
					href = href[:50] + "..."
				}
				sb.WriteString(fmt.Sprintf(" -> %s", href))
			}
			sb.WriteString(fmt.Sprintf(" @(%d,%d)", el.X, el.Y))
			sb.WriteString("\n")
		}

		sb.WriteString("\n=== Usage ===\n")
		sb.WriteString("To interact with an element, use browser_click_label with the label number.\n")
		sb.WriteString("Example: browser_click_label(browser_id, \"5\") to click element [5]\n")
		sb.WriteString("After clicking an input, use browser_type to enter text.\n")

		return sb.String(), nil
	})
}

// ---- Browser Click At Coordinates Tool ----

type BrowserClickAtInput struct {
	BrowserID string `json:"browser_id"`
	X         int    `json:"x"`
	Y         int    `json:"y"`
}

func NewBrowserClickAtTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "browser_click_at",
		Desc: "Click at specific x, y pixel coordinates on the page. Use this when you know the exact coordinates from analyzing a screenshot.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"browser_id": {Type: schema.String, Required: true, Desc: "The browser instance ID"},
			"x":          {Type: schema.Integer, Required: true, Desc: "X coordinate (pixels from left)"},
			"y":          {Type: schema.Integer, Required: true, Desc: "Y coordinate (pixels from top)"},
		}),
	}, func(ctx context.Context, input *BrowserClickAtInput) (string, error) {
		if tc.BrowserService == nil {
			return "Error: browser service not available", nil
		}

		if err := tc.BrowserService.ClickAtCoordinates(ctx, input.BrowserID, input.X, input.Y); err != nil {
			return fmt.Sprintf("Error: %v", err), nil
		}

		return fmt.Sprintf("Clicked at coordinates (%d, %d)", input.X, input.Y), nil
	})
}

// ---- Browser Click By Label Tool ----

type BrowserClickLabelInput struct {
	BrowserID string `json:"browser_id"`
	Label     string `json:"label"`
}

func NewBrowserClickLabelTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "browser_click_label",
		Desc: "Click an element by its label number from browser_get_visual_state. First call browser_get_visual_state to see the page with labeled elements, then use the label number (e.g., '1', '2', '3') to click the desired element.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"browser_id": {Type: schema.String, Required: true, Desc: "The browser instance ID"},
			"label":      {Type: schema.String, Required: true, Desc: "The label number of the element to click (e.g., '1', '2', '3')"},
		}),
	}, func(ctx context.Context, input *BrowserClickLabelInput) (string, error) {
		if tc.BrowserService == nil {
			return "Error: browser service not available", nil
		}

		if err := tc.BrowserService.ClickByLabel(ctx, input.BrowserID, input.Label); err != nil {
			return fmt.Sprintf("Error: %v", err), nil
		}

		return fmt.Sprintf("Clicked element with label [%s]", input.Label), nil
	})
}

// ---- Browser Type Tool ----

type BrowserTypeInput struct {
	BrowserID string `json:"browser_id"`
	Text      string `json:"text"`
	Clear     bool   `json:"clear,omitempty"`
}

func NewBrowserTypeTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "browser_type",
		Desc: "Type text at the current cursor position. First click on an input field using browser_click_label or browser_click_at to focus it, then use this tool to type text. Set clear=true to select all and replace existing content.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"browser_id": {Type: schema.String, Required: true, Desc: "The browser instance ID"},
			"text":       {Type: schema.String, Required: true, Desc: "The text to type"},
			"clear":      {Type: schema.Boolean, Required: false, Desc: "If true, select all existing text first (Ctrl+A) so new text replaces it (default: false)"},
		}),
	}, func(ctx context.Context, input *BrowserTypeInput) (string, error) {
		if tc.BrowserService == nil {
			return "Error: browser service not available", nil
		}

		if err := tc.BrowserService.TypeText(ctx, input.BrowserID, input.Text, input.Clear); err != nil {
			return fmt.Sprintf("Error: %v", err), nil
		}

		if input.Clear {
			return fmt.Sprintf("Cleared and typed: \"%s\"", input.Text), nil
		}
		return fmt.Sprintf("Typed: \"%s\"", input.Text), nil
	})
}

// ---- Browser Press Key Tool ----

type BrowserPressKeyInput struct {
	BrowserID string `json:"browser_id"`
	Key       string `json:"key"`
}

func NewBrowserPressKeyTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "browser_press_key",
		Desc: "Press a special key on the keyboard. Supported keys: Enter, Tab, Escape, Backspace, Delete, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Home, End, PageUp, PageDown, Space. Use this after typing text to submit forms (Enter) or navigate (Tab, Arrow keys).",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"browser_id": {Type: schema.String, Required: true, Desc: "The browser instance ID"},
			"key":        {Type: schema.String, Required: true, Desc: "The key to press (e.g., 'Enter', 'Tab', 'Escape', 'Backspace', 'ArrowDown')"},
		}),
	}, func(ctx context.Context, input *BrowserPressKeyInput) (string, error) {
		if tc.BrowserService == nil {
			return "Error: browser service not available", nil
		}

		if err := tc.BrowserService.PressKey(ctx, input.BrowserID, input.Key); err != nil {
			return fmt.Sprintf("Error: %v", err), nil
		}

		return fmt.Sprintf("Pressed key: %s", input.Key), nil
	})
}

// analyzeImage uses a vision-capable model to analyze an image
// imageDataURI should be a data URI (data:image/...;base64,...) or a URL
// prompt is the instruction for the model
// modelID is required - specifies which vision model to use
func analyzeImage(ctx context.Context, tc *tools.ToolContext, imageDataURI string, prompt string, modelID string) (string, error) {
	if tc.ModelService == nil {
		return "", fmt.Errorf("model service not available")
	}

	// Load models
	modelsList, err := models.LoadModels()
	if err != nil {
		return "", fmt.Errorf("failed to load models: %w", err)
	}

	// Find the specified model
	var visionConfig *models.ModelConfig
	for _, cfg := range modelsList {
		if cfg.ID == modelID {
			visionConfig = cfg
			break
		}
	}

	if visionConfig == nil {
		return "", fmt.Errorf("specified vision model not found: %s", modelID)
	}

	// Create the chat model
	chatModel, err := tc.ModelService.CreateChatModel(ctx, visionConfig)
	if err != nil {
		return "", fmt.Errorf("failed to create vision model: %w", err)
	}

	// Build multimodal message with image
	messages := []*schema.Message{
		{
			Role: schema.User,
			MultiContent: []schema.ChatMessagePart{
				{
					Type: schema.ChatMessagePartTypeText,
					Text: prompt,
				},
				{
					Type: schema.ChatMessagePartTypeImageURL,
					ImageURL: &schema.ChatMessageImageURL{
						URL:    imageDataURI,
						Detail: "auto",
					},
				},
			},
		},
	}

	// Call the model
	resp, err := chatModel.Generate(ctx, messages)
	if err != nil {
		return "", fmt.Errorf("vision model call failed: %w", err)
	}

	if resp == nil || resp.Content == "" {
		return "", fmt.Errorf("vision model returned empty response")
	}

	return resp.Content, nil
}

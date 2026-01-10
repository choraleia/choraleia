// Package all imports and initializes all built-in tools.
// Import this package to register all tools.
package all

import (
	// Import all tool packages to trigger their init() functions
	_ "github.com/choraleia/choraleia/pkg/tools/asset_exec"
	_ "github.com/choraleia/choraleia/pkg/tools/asset_fs"
	_ "github.com/choraleia/choraleia/pkg/tools/browser"
	_ "github.com/choraleia/choraleia/pkg/tools/database"
	_ "github.com/choraleia/choraleia/pkg/tools/transfer"
	_ "github.com/choraleia/choraleia/pkg/tools/workspace_exec"
	_ "github.com/choraleia/choraleia/pkg/tools/workspace_fs"
)

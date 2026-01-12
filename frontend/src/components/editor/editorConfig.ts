import type { editor } from "monaco-editor";

/**
 * Default Monaco Editor options
 */
export const defaultEditorOptions: editor.IStandaloneEditorConstructionOptions = {
  minimap: { enabled: false },
  fontSize: 13,
  lineNumbers: "on",
  wordWrap: "on",
  automaticLayout: false, // Disabled to prevent resize loops in split panes
  tabSize: 2,
  insertSpaces: true,
  renderLineHighlight: "line",
  cursorBlinking: "smooth",
  cursorSmoothCaretAnimation: "on",
  smoothScrolling: true,
  bracketPairColorization: { enabled: true },
  guides: { bracketPairs: true, indentation: true },
  scrollBeyondLastLine: false,
  folding: true,
  foldingHighlight: true,
  showFoldingControls: "mouseover",
  formatOnPaste: true,
  formatOnType: false,
  quickSuggestions: true,
  suggestOnTriggerCharacters: true,
  acceptSuggestionOnEnter: "on",
  contextmenu: true,
  mouseWheelZoom: true,
  // Additional useful options
  linkedEditing: true,           // Auto-rename matching tags
  renderWhitespace: "selection", // Show whitespace when selected
  rulers: [80, 120],             // Column rulers
  stickyScroll: { enabled: true }, // Sticky scroll for nested scopes
  inlayHints: { enabled: "on" }, // Inlay hints for types
  hover: { enabled: true, delay: 300 }, // Hover tooltips
  links: true,                   // Clickable links
  colorDecorators: true,         // Color preview in CSS
  dragAndDrop: true,             // Drag and drop text
  emptySelectionClipboard: false, // Don't copy empty selection
  find: {
    addExtraSpaceOnTop: false,
    autoFindInSelection: "multiline",
    seedSearchStringFromSelection: "selection",
  },
};

/**
 * Read-only editor options (for viewing files without editing)
 */
export const readOnlyEditorOptions: editor.IStandaloneEditorConstructionOptions = {
  ...defaultEditorOptions,
  readOnly: true,
  domReadOnly: true,
};

/**
 * Diff editor options
 */
export const diffEditorOptions: editor.IStandaloneDiffEditorConstructionOptions = {
  automaticLayout: true,
  renderSideBySide: true,
  readOnly: false,
  originalEditable: false,
};


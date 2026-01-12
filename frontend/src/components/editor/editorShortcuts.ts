import type { editor as MonacoEditor, KeyMod, KeyCode } from "monaco-editor";
import type * as Monaco from "monaco-editor";

/**
 * Register keyboard shortcuts for the editor
 */
export function registerEditorShortcuts(
  editor: MonacoEditor.IStandaloneCodeEditor,
  monaco: typeof Monaco,
  options?: {
    onSave?: () => void;
  }
) {
  const { KeyMod: KM, KeyCode: KC } = monaco;

  // Ctrl+S - Save file (must also prevent default browser save dialog)
  editor.addCommand(KM.CtrlCmd | KC.KeyS, () => {
    options?.onSave?.();
  });

  // Ctrl+F - Find
  editor.addCommand(KM.CtrlCmd | KC.KeyF, () => {
    editor.trigger("keyboard", "actions.find", null);
  });

  // Ctrl+H - Find and Replace
  editor.addCommand(KM.CtrlCmd | KC.KeyH, () => {
    editor.trigger("keyboard", "editor.action.startFindReplaceAction", null);
  });

  // Ctrl+G - Go to Line
  editor.addCommand(KM.CtrlCmd | KC.KeyG, () => {
    editor.trigger("keyboard", "editor.action.gotoLine", null);
  });

  // Ctrl+D - Select Next Occurrence
  editor.addCommand(KM.CtrlCmd | KC.KeyD, () => {
    editor.trigger("keyboard", "editor.action.addSelectionToNextFindMatch", null);
  });

  // Ctrl+Shift+K - Delete Line
  editor.addCommand(KM.CtrlCmd | KM.Shift | KC.KeyK, () => {
    editor.trigger("keyboard", "editor.action.deleteLines", null);
  });

  // Alt+Up - Move Line Up
  editor.addCommand(KM.Alt | KC.UpArrow, () => {
    editor.trigger("keyboard", "editor.action.moveLinesUpAction", null);
  });

  // Alt+Down - Move Line Down
  editor.addCommand(KM.Alt | KC.DownArrow, () => {
    editor.trigger("keyboard", "editor.action.moveLinesDownAction", null);
  });

  // Ctrl+/ - Toggle Comment
  editor.addCommand(KM.CtrlCmd | KC.Slash, () => {
    editor.trigger("keyboard", "editor.action.commentLine", null);
  });

  // Ctrl+Shift+F - Format Document
  editor.addCommand(KM.CtrlCmd | KM.Shift | KC.KeyF, () => {
    editor.trigger("keyboard", "editor.action.formatDocument", null);
  });

  // Ctrl+[ - Outdent
  editor.addCommand(KM.CtrlCmd | KC.BracketLeft, () => {
    editor.trigger("keyboard", "editor.action.outdentLines", null);
  });

  // Ctrl+] - Indent
  editor.addCommand(KM.CtrlCmd | KC.BracketRight, () => {
    editor.trigger("keyboard", "editor.action.indentLines", null);
  });

  // Ctrl+Shift+D - Duplicate Line
  editor.addCommand(KM.CtrlCmd | KM.Shift | KC.KeyD, () => {
    editor.trigger("keyboard", "editor.action.copyLinesDownAction", null);
  });

  // Ctrl+L - Select Line
  editor.addCommand(KM.CtrlCmd | KC.KeyL, () => {
    editor.trigger("keyboard", "expandLineSelection", null);
  });

  // Ctrl+Shift+[ - Fold
  editor.addCommand(KM.CtrlCmd | KM.Shift | KC.BracketLeft, () => {
    editor.trigger("keyboard", "editor.fold", null);
  });

  // Ctrl+Shift+] - Unfold
  editor.addCommand(KM.CtrlCmd | KM.Shift | KC.BracketRight, () => {
    editor.trigger("keyboard", "editor.unfold", null);
  });

  // Ctrl+K Ctrl+0 - Fold All
  editor.addCommand(KM.CtrlCmd | KC.Digit0, () => {
    editor.trigger("keyboard", "editor.foldAll", null);
  });

  // Ctrl+K Ctrl+J - Unfold All
  editor.addCommand(KM.CtrlCmd | KC.KeyJ, () => {
    editor.trigger("keyboard", "editor.unfoldAll", null);
  });
}

/**
 * List of all available keyboard shortcuts (for help/documentation)
 */
export const editorShortcuts = [
  { key: "Ctrl+S", action: "Save file" },
  { key: "Ctrl+F", action: "Find" },
  { key: "Ctrl+H", action: "Find and Replace" },
  { key: "Ctrl+G", action: "Go to Line" },
  { key: "Ctrl+D", action: "Select Next Occurrence" },
  { key: "Ctrl+Shift+K", action: "Delete Line" },
  { key: "Alt+↑", action: "Move Line Up" },
  { key: "Alt+↓", action: "Move Line Down" },
  { key: "Ctrl+/", action: "Toggle Comment" },
  { key: "Ctrl+Shift+F", action: "Format Document" },
  { key: "Ctrl+[", action: "Outdent" },
  { key: "Ctrl+]", action: "Indent" },
  { key: "Ctrl+Shift+D", action: "Duplicate Line" },
  { key: "Ctrl+L", action: "Select Line" },
  { key: "Ctrl+Shift+[", action: "Fold" },
  { key: "Ctrl+Shift+]", action: "Unfold" },
  { key: "Ctrl+0", action: "Fold All" },
  { key: "Ctrl+J", action: "Unfold All" },
  { key: "Ctrl+Z", action: "Undo (built-in)" },
  { key: "Ctrl+Shift+Z", action: "Redo (built-in)" },
  { key: "Ctrl+C", action: "Copy (built-in)" },
  { key: "Ctrl+V", action: "Paste (built-in)" },
  { key: "Ctrl+X", action: "Cut (built-in)" },
  { key: "Ctrl+A", action: "Select All (built-in)" },
  { key: "F1", action: "Command Palette (built-in)" },
  { key: "Alt+Click", action: "Add Cursor (built-in)" },
  { key: "Ctrl+Wheel", action: "Zoom (built-in)" },
];


import React, { useRef, useEffect, useCallback, useState } from "react";
import MonacoEditor, { OnMount } from "@monaco-editor/react";
import { Box, useTheme } from "@mui/material";
import { defaultEditorOptions } from "./editorConfig";
import { registerEditorShortcuts } from "./editorShortcuts";
import type { editor as MonacoEditorType } from "monaco-editor";

export interface EditorProps {
  /** File path for language detection */
  filePath?: string;
  /** Editor content */
  value: string;
  /** Callback when content changes */
  onChange?: (value: string) => void;
  /** Callback when save is triggered (Ctrl+S) */
  onSave?: () => void;
  /** Whether the editor is read-only */
  readOnly?: boolean;
  /** Custom height (default: 100%) */
  height?: string | number;
  /** Override default options */
  options?: MonacoEditorType.IStandaloneEditorConstructionOptions;
  /** Callback when editor mounts */
  onMount?: OnMount;
}

/**
 * Editor component with preconfigured options and shortcuts
 */
const Editor: React.FC<EditorProps> = ({
  filePath,
  value,
  onChange,
  onSave,
  readOnly = false,
  height = "100%",
  options,
  onMount,
}) => {
  const theme = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<MonacoEditorType.IStandaloneCodeEditor | null>(null);
  const [editorReady, setEditorReady] = useState(false);

  // Use ref to always have the latest onSave callback
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  // Manual resize handling - only setup after editor is ready
  // Use ResizeObserver to detect container size changes (debounced)
  // This handles all resize scenarios: window resize, pane drag, toggle chat/browser, etc.
  useEffect(() => {
    if (!containerRef.current || !editorReady || !editorRef.current) return;

    let resizeTimeout: ReturnType<typeof setTimeout> | null = null;

    const doLayout = () => {
      // Debounce: only layout after resize stops for 150ms
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }
      resizeTimeout = setTimeout(() => {
        requestAnimationFrame(() => {
          editorRef.current?.layout();
        });
      }, 150);
    };

    const resizeObserver = new ResizeObserver(doLayout);
    resizeObserver.observe(containerRef.current);

    // Also listen to window resize as backup
    window.addEventListener("resize", doLayout);

    return () => {
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }
      resizeObserver.disconnect();
      window.removeEventListener("resize", doLayout);
    };
  }, [editorReady]);

  const handleMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;

      // Register shortcuts with ref-based save to avoid stale closure
      registerEditorShortcuts(editor, monaco, {
        onSave: () => onSaveRef.current?.(),
      });

      // Initial layout
      editor.layout();

      // Mark editor as ready to setup ResizeObserver
      setEditorReady(true);

      // Call custom onMount if provided
      onMount?.(editor, monaco);
    },
    [onMount]
  );

  const mergedOptions: MonacoEditorType.IStandaloneEditorConstructionOptions = {
    ...defaultEditorOptions,
    readOnly,
    domReadOnly: readOnly,
    ...options,
  };

  return (
    <Box
      ref={containerRef}
      sx={{
        width: "100%",
        height: height,
        minWidth: 0,
        minHeight: 0,
        overflow: "hidden",
        position: "relative",
      }}
    >
      <Box
        sx={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
        }}
      >
        <MonacoEditor
          height="100%"
          width="100%"
          path={filePath}
          value={value}
          theme={theme.palette.mode === "dark" ? "vs-dark" : "light"}
          onChange={(newValue) => {
            if (newValue !== undefined) {
              onChange?.(newValue);
            }
          }}
          onMount={handleMount}
          options={mergedOptions}
        />
      </Box>
    </Box>
  );
};

export default Editor;

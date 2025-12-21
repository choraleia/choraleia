import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { CanvasAddon } from "@xterm/addon-canvas";
import { ImageAddon } from "@xterm/addon-image";
import "@xterm/xterm/css/xterm.css";
import { getWsUrl } from "../../api/base";

interface TerminalProps {
  hostInfo: {
    ip: string;
    port: number;
    name: string;
  };
  tabKey: string;
  assetId: string; // Added: asset ID
  isActive: boolean;
  onConnectionStateChange?: (connected: boolean) => void;
}

// Global terminal instance manager
const terminalInstances = new Map<
  string,
  {
    terminal: Terminal;
    socket: WebSocket | null;
    fitAddon: FitAddon;
    isInitialized: boolean;
    domElement: HTMLDivElement | null;
  }
>();

export function sendToTerminal(
  tabKey: string,
  text: string,
  execute: boolean = false,
) {
  const data = terminalInstances.get(tabKey);
  if (!data) return false;
  const { terminal, socket } = data;
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    terminal.writeln(`\r\n\x1b[31m[Not Connected]\x1b[m ${text}`);
    return false;
  }
  // Avoid local echo to prevent duplication (remote shell will echo input)
  if (execute) {
    socket.send(JSON.stringify({ type: "TermInput", data: text + "\r" }));
  } else {
    socket.send(JSON.stringify({ type: "TermInput", data: text }));
  }
  return true;
}

// Function to handle terminal output request
const handleTerminalOutputRequest = (
  terminal: Terminal,
  socket: WebSocket,
  request: any,
) => {
  try {
    const requestedLines: number =
      request.lines && request.lines > 0 ? request.lines : 200;

    // xterm v5+ active is current buffer (normal or alt), get its length
    const buffer: any = (terminal as any).buffer.active; // compatibility type
    const totalLines: number = buffer.length;
    const end = totalLines; // logical end
    const start = Math.max(0, end - requestedLines);
    const lines: string[] = [];

    for (let i = start; i < end; i++) {
      try {
        const line = buffer.getLine(i);
        if (line) {
          // translateToString(true) removes right-side blanks
          const text = line.translateToString(true);
          lines.push(text);
        } else {
          lines.push("");
        }
      } catch (e) {
        console.warn("read line error", i, e);
        lines.push("");
      }
    }

    // Trim leading and trailing empty lines (preserve middle structure)
    let firstIdx = 0;
    while (firstIdx < lines.length && lines[firstIdx].trim() === "") firstIdx++;
    let lastIdx = lines.length - 1;
    while (lastIdx >= firstIdx && lines[lastIdx].trim() === "") lastIdx--;
    let sliced = firstIdx <= lastIdx ? lines.slice(firstIdx, lastIdx + 1) : [];

    // Fallback: if still empty, use selection approach
    if (sliced.length === 0) {
      try {
        terminal.selectAll();
        const selection = terminal.getSelection();
        terminal.clearSelection();
        if (selection) {
          const selLines = selection.split(/\r?\n/);
          sliced = selLines
            .slice(-requestedLines)
            .filter((l) => l.trim() !== "");
        }
      } catch (e) {
        console.warn("fallback selection failed", e);
      }
    }

    const response = {
      type: "TermOutputResponse",
      request_id: request.request_id,
      output: sliced,
      success: true,
      error: "",
      debug_info: {
        totalLines,
        requestedLines,
        start,
        end,
        returned: sliced.length,
      },
    };
    socket.send(JSON.stringify(response));
  } catch (error) {
    const errorResponse = {
      type: "TermOutputResponse",
      request_id: request.request_id,
      output: [],
      success: false,
      error: String(error),
    };
    socket.send(JSON.stringify(errorResponse));
  }
};

function TerminalComponent({
  hostInfo,
  tabKey,
  assetId,
  isActive,
  onConnectionStateChange,
}: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    let terminalData = terminalInstances.get(tabKey);

    if (!terminalData) {
      // Create new terminal instance
      const isWebGLAvailable = () => {
        try {
          const canvas = document.createElement("canvas");
          const gl =
            canvas.getContext("webgl") ||
            canvas.getContext("experimental-webgl");
          if (!gl) return false;

          // Check WebGL extensions & capabilities
          const webglContext = gl as WebGLRenderingContext;
          const debugInfo = webglContext.getExtension(
            "WEBGL_debug_renderer_info",
          );
          if (debugInfo) {
            const renderer = webglContext.getParameter(
              debugInfo.UNMASKED_RENDERER_WEBGL,
            );
            // Avoid WebGL on problematic renderers
            if (renderer && renderer.includes("SwiftShader")) {
              console.log("WebGL fallback detected, using Canvas instead");
              return false;
            }
          }

          return true;
        } catch (e) {
          console.warn("WebGL availability check failed:", e);
          return false;
        }
      };

      const terminal = new Terminal({
        cursorBlink: true,
        allowProposedApi: true,
        allowTransparency: true,
        macOptionIsMeta: true,
        macOptionClickForcesSelection: true,
        scrollback: 10000,
        fontSize: 13,
        fontFamily: "Consolas,Liberation Mono,Menlo,Courier,monospace",
        theme: window.matchMedia("(prefers-color-scheme: dark)").matches
          ? {
              background: "#1e1e1e",
              foreground: "#d4d4d4",
              cursor: "#ffffff",
            }
          : {
              background: "#ffffff",
              foreground: "#000000",
              cursor: "#000000",
            },
      });

      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);

      const imageAddon = new ImageAddon();
      terminal.loadAddon(imageAddon);

      // Improved renderer loading logic
      if (isWebGLAvailable()) {
        try {
          const webglAddon = new WebglAddon();

          // Add WebGL error handling
          // webglAddon.onContextLoss(() => {
          //     console.warn('WebGL context lost, falling back to Canvas renderer');
          //     webglAddon.dispose();
          //
          //     // Switch to Canvas renderer
          //     try {
          //         const canvasAddon = new CanvasAddon();
          //         terminal.loadAddon(canvasAddon);
          //         console.log('Switched to Canvas rendering after WebGL context loss');
          //     } catch (canvasError) {
          //         console.warn('Canvas fallback also failed:', canvasError);
          //         // Continue using DOM renderer
          //     }
          // });

          // Listen for WebGL errors and auto switch
          const handleWebGLError = () => {
            console.warn("WebGL error detected, disposing WebGL addon");
            webglAddon.dispose();

            // Switch to Canvas renderer
            try {
              const canvasAddon = new CanvasAddon();
              terminal.loadAddon(canvasAddon);
              console.log("Switched to Canvas rendering after WebGL error");
            } catch (canvasError) {
              console.warn("Canvas fallback failed:", canvasError);
            }
          };

          // Listen for global error events
          const errorListener = (event: ErrorEvent) => {
            if (
              event.message &&
              event.message.includes("WebGL") &&
              event.message.includes("INVALID_OPERATION")
            ) {
              handleWebGLError();
            }
          };

          window.addEventListener("error", errorListener);

          // Try to load WebGL addon
          terminal.loadAddon(webglAddon);
          console.log("Using WebGL rendering");

          // Clean up listener function
          setTimeout(() => {
            window.removeEventListener("error", errorListener);
          }, 5000);
        } catch (webglError) {
          console.warn("WebGL addon loading failed:", webglError);
          // Fall back to Canvas renderer
          try {
            const canvasAddon = new CanvasAddon();
            terminal.loadAddon(canvasAddon);
            console.log("Using Canvas rendering after WebGL failure");
          } catch (canvasError) {
            console.warn("Canvas addon loading failed:", canvasError);
            console.log("Using DOM rendering");
          }
        }
      } else {
        try {
          const canvasAddon = new CanvasAddon();
          terminal.loadAddon(canvasAddon);
          console.log("Using Canvas rendering");
        } catch (canvasError) {
          console.warn("Canvas addon loading failed:", canvasError);
          console.log("Using DOM rendering");
        }
      }

      // Create terminal data object
      terminalData = {
        terminal,
        socket: null,
        fitAddon,
        isInitialized: false,
        domElement: null,
      };

      terminalInstances.set(tabKey, terminalData);

      try {
        terminal.open(terminalRef.current);
        terminalData.domElement = terminalRef.current;
        fitAddon.fit();
        terminal.focus();
      } catch (error) {
        console.warn("Terminal initial mount failed:", error);
      }

      const HIGH = 100000;
      const LOW = 20000;
      let watermark = 0;
      let isPaused = false;

      // Establish WebSocket connection - use asset ID instead of host info
      const rawPath = `/terminal/connect/${assetId}`;
      const connectSocket = async () => {
        const socketUrl = getWsUrl(rawPath);

        if (!socketUrl) {
          terminalData?.terminal.writeln(
            "\r\n\x1b[31mBackend WebSocket base URL is not configured. Please check VITE_API_BASE_URL or the current page origin.\x1b[m",
          );
          onConnectionStateChange?.(false);
          return;
        }

        const socket = new WebSocket(socketUrl);
        terminalData!.socket = socket;
        console.log("Connecting to asset:", assetId, "via URL:", socketUrl);

        socket.binaryType = "arraybuffer";

        socket.onopen = () => {
          console.log(
            "WebSocket connected for asset:",
            assetId,
            "tab:",
            tabKey,
          );
          onConnectionStateChange?.(true);
          const currentTerminalData = terminalInstances.get(tabKey);
          if (currentTerminalData) {
            // First send tab key for session mapping
            socket.send(
              JSON.stringify({
                type: "TermSetSessionId",
                session_id: tabKey,
              }),
            );

            currentTerminalData.fitAddon.fit();
            const { rows, cols } = currentTerminalData.terminal;
            // Send initial resize with new message format
            socket.send(
              JSON.stringify({
                type: "TermResize",
                rows: rows,
                cols: cols,
              }),
            );
            currentTerminalData.terminal.writeln(
              `\r\n\x1b[32mConnecting to ${hostInfo.name}...\x1b[m`,
            );
          }
        };

        socket.onmessage = (event) => {
          const currentTerminalData = terminalInstances.get(tabKey);
          if (!currentTerminalData) return;

          if (typeof event.data === "string") {
            try {
              const msg = JSON.parse(event.data);
              if (msg.type === "status") {
                // Handle connection status messages
                if (msg.data.status === "disconnected") {
                  console.log("SSH connection disconnected:", msg.data.message);
                  currentTerminalData.terminal.writeln(
                    `\r\n\x1b[33m${msg.data.message}\x1b[m`,
                  );
                  onConnectionStateChange?.(false);
                } else if (msg.data.status === "error") {
                  console.error("SSH connection error:", msg.data.message);
                  currentTerminalData.terminal.writeln(
                    `\r\n\x1b[31mConnection Error: ${msg.data.message}\x1b[m`,
                  );
                  currentTerminalData.terminal.writeln(
                    `\x1b[31mTrying to reconnect...\x1b[m`,
                  );
                  onConnectionStateChange?.(false);
                  // Could add reconnect logic here
                }
              } else if (msg.type === "error") {
                console.error("Terminal error:", msg.message);
                currentTerminalData.terminal.writeln(
                  `\r\n\x1b[31mError: ${msg.message}\x1b[m`,
                );
              } else if (msg.type === "change-theme") {
                currentTerminalData.terminal.options.theme = msg.themeOptions;
              } else if (msg.type === "TermOutputRequest") {
                // Handle terminal output retrieval request
                console.log("Received terminal output request:", msg);
                handleTerminalOutputRequest(
                  currentTerminalData.terminal,
                  socket,
                  msg,
                );
              }
            } catch (e) {
              // If not JSON
              console.log(
                "handle text message error:",
                e,
                "received text data:",
                event.data,
              );
            }
          } else {
            let dataArray = new Uint8Array(event.data);
            watermark += dataArray.length;
            currentTerminalData.terminal.write(dataArray, () => {
              //watermark = Math.max(watermark - dataArray.length, 0);
              watermark = watermark - dataArray.length;
              if (isPaused && watermark < LOW) {
                console.log("resume terminal write due to flow control");
                // Send resume message with new format
                socket.send(
                  JSON.stringify({
                    type: "TermPause",
                    pause: false,
                  }),
                );
                isPaused = false;
              }
            });
            if (!isPaused && watermark > HIGH) {
              console.log("pause terminal write due to flow control");
              // Send pause message with new format
              socket.send(
                JSON.stringify({
                  type: "TermPause",
                  pause: true,
                }),
              );
              isPaused = true;
            }
          }
        };

        socket.onclose = () => {
          console.log("WebSocket closed for asset:", assetId, "tab:", tabKey);
          onConnectionStateChange?.(false);
          const currentTerminalData = terminalInstances.get(tabKey);
          if (currentTerminalData) {
            currentTerminalData.terminal.writeln(
              "\r\n\x1b[31mConnection closed\x1b[m",
            );
          }
        };

        socket.onerror = (error) => {
          console.error("WebSocket error for asset:", assetId, error);
          onConnectionStateChange?.(false);
          const currentTerminalData = terminalInstances.get(tabKey);
          if (currentTerminalData) {
            currentTerminalData.terminal.writeln(
              "\r\n\x1b[31mConnection error\x1b[m",
            );
          }
        };

        // Terminal event handling
        terminalData!.terminal.onResize(({ rows, cols }) => {
          console.log("resize tty", rows, cols);
          if (socket.readyState === WebSocket.OPEN) {
            // Use new message format
            socket.send(
              JSON.stringify({
                type: "TermResize",
                rows: rows,
                cols: cols,
              }),
            );
          }
        });

        terminalData!.terminal.onData((data) => {
          if (socket.readyState === WebSocket.OPEN) {
            // Use new message format
            socket.send(
              JSON.stringify({
                type: "TermInput",
                data: data,
              }),
            );
          }
        });

        terminalData!.terminal.onRender(() => {
          const currentTerminalData = terminalInstances.get(tabKey);
          if (currentTerminalData) {
            currentTerminalData.terminal.refresh(
              currentTerminalData.terminal.rows,
              currentTerminalData.terminal.rows,
            );
          }
        });

        // Theme change handling
        const handleThemeChange = (e: MediaQueryListEvent) => {
          const currentTerminalData = terminalInstances.get(tabKey);
          if (currentTerminalData) {
            currentTerminalData.terminal.options.theme = e.matches
              ? {
                  background: "#1e1e1e",
                  foreground: "#d4d4d4",
                  cursor: "#ffffff",
                }
              : {
                  background: "#ffffff",
                  foreground: "#000000",
                  cursor: "#000000",
                };
          }
        };

        const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
        mediaQuery.addEventListener("change", handleThemeChange);

        // Cleanup
        return () => {
          mediaQuery.removeEventListener("change", handleThemeChange);
        };
      };

      void connectSocket();

      return () => {
        const td = terminalInstances.get(tabKey);
        if (td?.socket) {
          td.socket.close();
        }
      };
    }

    // Terminal already exists: no setup needed here.
    return;
  }, [tabKey]);

  // On tab active, fit only on size change
  useEffect(() => {
    const fitIfNeeded = () => {
      const terminalData = terminalInstances.get(tabKey);
      const container = terminalRef.current;
      if (!terminalData || !container) return;
      const { fitAddon, terminal } = terminalData;
      const dims = fitAddon.proposeDimensions && fitAddon.proposeDimensions();
      if (
        dims &&
        (terminal.cols !== dims.cols || terminal.rows !== dims.rows)
      ) {
        fitAddon.fit();
      } else if (!dims) {
        fitAddon.fit();
      }
    };

    if (!isActive) return;
    setTimeout(() => {
      fitIfNeeded();
      const terminalData = terminalInstances.get(tabKey);
      if (terminalData) {
        terminalData.terminal.focus();
      }
    }, 0);
  }, [isActive, tabKey]);

  // Listen to terminal-resize event
  useEffect(() => {
    const handleResize = () => {
      if (!isActive) return;
      const terminalData = terminalInstances.get(tabKey);
      if (!terminalData || !terminalRef.current) return;
      terminalData.fitAddon.fit();
    };

    window.addEventListener("asset-tree-resize", handleResize as EventListener);
    window.addEventListener(
      "asset-tree-visible",
      handleResize as EventListener,
    );
    return () => {
      window.removeEventListener(
        "asset-tree-resize",
        handleResize as EventListener,
      );
      window.removeEventListener(
        "asset-tree-visible",
        handleResize as EventListener,
      );
    };
  }, [isActive, tabKey]);

  // Listen to window resize
  useEffect(() => {
    const handleWindowResize = () => {
      if (!isActive) return;
      const terminalData = terminalInstances.get(tabKey);
      if (!terminalData || !terminalRef.current) return;
      terminalData.fitAddon.fit();
    };

    window.addEventListener("resize", handleWindowResize);
    return () => {
      window.removeEventListener("resize", handleWindowResize);
    };
  }, [isActive, tabKey]);

  return (
    <div
      ref={terminalRef}
      style={{
        height: "100%",
        width: "100%",
        overflow: "hidden",
      }}
    />
  );
}

// Function to clean up terminal instance
export const cleanupTerminal = (tabKey: string) => {
  const terminalData = terminalInstances.get(tabKey);
  if (terminalData) {
    try {
      // Close WebSocket connection
      if (terminalData.socket) {
        terminalData.socket.close();
      }

      // Destroy terminal instance
      terminalData.terminal.dispose();

      // Delete from Map
      terminalInstances.delete(tabKey);

      console.log("Terminal cleaned up:", tabKey);
    } catch (error) {
      console.error("Error cleaning up terminal:", error);
    }
  }
};

export default TerminalComponent;

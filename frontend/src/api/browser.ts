// Browser API for browser preview

import { getApiBase } from "./base";

const baseUrl = getApiBase();

// Browser instance from backend
export interface BrowserInstance {
  id: string;
  conversation_id: string;
  container_id: string;
  container_name: string;
  devtools_url: string;
  devtools_port: number;
  current_url: string;
  current_title: string;
  status: "starting" | "ready" | "busy" | "closed" | "error";
  error_message?: string;
  created_at: string;
  last_activity_at: string;
  tabs: BrowserTab[];
  active_tab: number;
}

export interface BrowserTab {
  id: string;
  url: string;
  title: string;
}

// WebSocket message types
export interface BrowserWSMessage {
  type: "browser_list" | "screenshot" | "state_change";
  payload: any;
}

export interface ScreenshotPayload {
  browser_id: string;
  data: string; // base64 encoded PNG
  url: string;
  title: string;
  tabs?: BrowserTab[];
  active_tab?: number;
}

// List browsers for a conversation
export async function listBrowsers(conversationId: string): Promise<BrowserInstance[]> {
  const res = await fetch(`${baseUrl}/api/browser/list/${conversationId}`);
  if (!res.ok) {
    throw new Error(`Failed to list browsers: ${res.statusText}`);
  }
  return res.json();
}

// Get screenshot URL
export function getScreenshotUrl(browserId: string, fullPage = false): string {
  return `${baseUrl}/api/browser/screenshot/${browserId}${fullPage ? "?full_page=true" : ""}`;
}

// WebSocket connection for browser updates
export function connectBrowserWS(
  conversationId: string,
  onMessage: (msg: BrowserWSMessage) => void,
  onError?: (error: Event) => void,
  onClose?: () => void
): WebSocket {
  const wsBase = baseUrl.replace(/^http/, "ws");
  const wsUrl = `${wsBase}/api/browser/ws?conversation_id=${conversationId}`;
  console.log("[BrowserWS] Connecting to:", wsUrl);
  const ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log("[BrowserWS] Connected successfully");
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data) as BrowserWSMessage;
      onMessage(msg);
    } catch (e) {
      console.error("Failed to parse browser WS message:", e);
    }
  };

  ws.onerror = (error) => {
    console.error("Browser WebSocket error:", error);
    onError?.(error);
  };

  ws.onclose = () => {
    console.log("[BrowserWS] Connection closed");
    onClose?.();
  };

  return ws;
}


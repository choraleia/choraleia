// Event Client - Pure WebSocket event notification library
//
// This is a generic event client with no business logic.
// Business-specific events should be defined in separate files.

import { getWsBase } from "./base";

// ============================================================================
// Types
// ============================================================================

export type EventName = string;

export type EventData = Record<string, unknown>;

export interface WSMessage {
  event: EventName;
  data?: EventData;
  ts: number;
}

type Listener<T = EventData> = (data: T, event: EventName) => void;

// ============================================================================
// Event Emitter
// ============================================================================

class EventEmitter {
  private listeners = new Map<string, Set<Listener>>();
  private anyListeners = new Set<Listener>();

  on<T extends EventData = EventData>(event: EventName, fn: Listener<T>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(fn as Listener);
    return () => this.listeners.get(event)?.delete(fn as Listener);
  }

  onAny(fn: Listener): () => void {
    this.anyListeners.add(fn);
    return () => this.anyListeners.delete(fn);
  }

  emit(event: EventName, data: EventData) {
    this.listeners.get(event)?.forEach((fn) => fn(data, event));
    this.anyListeners.forEach((fn) => fn(data, event));
  }
}

// ============================================================================
// WebSocket Client
// ============================================================================

function buildWsUrl(endpoint: string, events?: EventName[]): string {
  const url = new URL(endpoint, getWsBase());
  if (events?.length) {
    url.searchParams.set("events", events.join(","));
  }
  return url.toString();
}

export interface EventClientOptions {
  /** WebSocket endpoint path, default: "/api/events/ws" */
  endpoint?: string;
  /** Reconnect settings */
  reconnect?: {
    maxDelay?: number;    // Max delay between reconnects (ms), default: 10000
    baseDelay?: number;   // Base delay for exponential backoff (ms), default: 500
  };
}

const DEFAULT_OPTIONS = {
  endpoint: "/api/events/ws",
  reconnect: {
    maxDelay: 10000,
    baseDelay: 500,
  },
};

/** Internal event emitted when WebSocket reconnects */
export const RECONNECT_EVENT = "__reconnect__";

class EventClient {
  private ws: WebSocket | null = null;
  private emitter = new EventEmitter();
  private reconnectTimer: number | null = null;
  private reconnectAttempt = 0;
  private stopped = true;
  private events?: EventName[];
  private endpoint: string;
  private maxDelay: number;
  private baseDelay: number;
  private wasConnected = false;

  constructor(options?: EventClientOptions) {
    this.endpoint = options?.endpoint ?? DEFAULT_OPTIONS.endpoint;
    this.maxDelay = options?.reconnect?.maxDelay ?? DEFAULT_OPTIONS.reconnect.maxDelay;
    this.baseDelay = options?.reconnect?.baseDelay ?? DEFAULT_OPTIONS.reconnect.baseDelay;
  }

  /** Start listening for events */
  start(events?: EventName[]) {
    this.events = events;
    this.stopped = false;
    this.connect();
  }

  /** Stop and disconnect */
  stop() {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  /** Check if connected */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Subscribe to a specific event */
  on<T extends EventData = EventData>(event: EventName, fn: Listener<T>): () => void {
    return this.emitter.on(event, fn);
  }

  /** Subscribe to all events */
  onAny(fn: Listener): () => void {
    return this.emitter.onAny(fn);
  }

  private connect() {
    if (this.stopped || this.ws) return;

    this.ws = new WebSocket(buildWsUrl(this.endpoint, this.events));

    this.ws.onopen = () => {
      const isReconnect = this.wasConnected;
      this.reconnectAttempt = 0;
      this.wasConnected = true;
      console.log("[EventClient] Connected");

      // Emit reconnect event so consumers can refresh their data
      if (isReconnect) {
        console.log("[EventClient] Reconnected - emitting refresh signal");
        this.emitter.emit(RECONNECT_EVENT, {});
      }
    };

    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as WSMessage;
        this.emitter.emit(msg.event, msg.data ?? {});
      } catch {
        // Ignore malformed messages
      }
    };

    this.ws.onclose = () => {
      this.ws = null;
      console.log("[EventClient] Disconnected");
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // onclose will fire
    };
  }

  private scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    const delay = Math.min(this.maxDelay, this.baseDelay * Math.pow(2, this.reconnectAttempt++));
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay + Math.random() * 500);
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const eventClient = new EventClient();

/** Create a new EventClient instance with custom options */
export function createEventClient(options?: EventClientOptions): EventClient {
  return new EventClient(options);
}


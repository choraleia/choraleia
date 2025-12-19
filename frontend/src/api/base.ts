let cachedRuntime: {
  httpBaseUrl: string;
  wsBaseUrl: string;
  port: number;
} | null = null;
let runtimePromise: Promise<{
  httpBaseUrl: string;
  wsBaseUrl: string;
  port: number;
} | null> | null = null;

async function fetchRuntimeInfo(): Promise<{
  httpBaseUrl: string;
  wsBaseUrl: string;
  port: number;
} | null> {
  if (cachedRuntime) return cachedRuntime;
  if (runtimePromise) return runtimePromise;

  runtimePromise = (async () => {
    // In packaged GUI, window.location is wails://..., so we can't use same-origin.
    // We query the backend directly on localhost to discover the actual port/base.
    // Note: we keep a small best-effort port list to stay compatible with dev/prod.
    const candidates = [
      // Common default
      "http://127.0.0.1:8088",
      // Allow override via build-time env (useful for dev)
      ...(import.meta.env.VITE_API_BASE_URL
        ? [String(import.meta.env.VITE_API_BASE_URL)]
        : []),
    ];

    for (const base of candidates) {
      try {
        const url = new URL("/api/runtime", base);
        const resp = await fetch(url.toString(), {
          method: "GET",
          // Avoid CORS preflight complications
          credentials: "omit",
        });
        if (!resp.ok) continue;

        const data = (await resp.json()) as {
          http_base_url?: string;
          ws_base_url?: string;
          port?: number;
        };
        if (!data.http_base_url || !data.ws_base_url || !data.port) continue;

        cachedRuntime = {
          httpBaseUrl: data.http_base_url.replace(/\/$/, ""),
          wsBaseUrl: data.ws_base_url.replace(/\/$/, ""),
          port: data.port,
        };
        return cachedRuntime;
      } catch {
        // try next
      }
    }

    return null;
  })();

  const result = await runtimePromise;
  runtimePromise = null;
  return result;
}

export function getApiBase(): string {
  // Prefer explicit override from environment (Vite) for flexibility.
  const fromEnv = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv.replace(/\/$/, "");
  }

  if (typeof window !== "undefined" && window.location) {
    // Packaged GUI (wails://...): must not use same-origin, it would create wails://api/... URLs.
    if (window.location.protocol === "wails:") {
      // If runtime has been fetched, use it. Otherwise return empty for now and let callers
      // use getApiBaseAsync() (recommended) or handle retry.
      return cachedRuntime?.httpBaseUrl ?? "";
    }

    // In production/headless where the frontend is served by the backend, same-origin works.
    return window.location.origin;
  }

  // Non-browser environments should provide VITE_API_BASE_URL.
  return "";
}

export async function getApiBaseAsync(): Promise<string> {
  const sync = getApiBase();
  if (sync) return sync;

  if (typeof window !== "undefined" && window.location?.protocol === "wails:") {
    const rt = await fetchRuntimeInfo();
    return rt?.httpBaseUrl ?? "";
  }

  // Dev (vite) can use relative URLs + proxy.
  return "";
}

function joinUrl(base: string, path: string): string {
  // Ensure path starts with exactly one slash.
  const cleanPath = ("/" + path).replace(/\/+/g, "/");

  // If base is empty, return a clean absolute-path URL.
  if (!base) return cleanPath;

  // Remove trailing slashes from base to avoid `base//path`.
  const cleanBase = base.replace(/\/+$/, "");
  return cleanBase + cleanPath;
}

export function getApiUrl(path: string): string {
  const base = getApiBase();

  // In packaged GUI before runtime discovery finishes, base can be empty.
  // Never return a `wails://...` URL; fall back to a relative path so callers
  // either wait for Root(runtimeReady) or hit the backend-served origin.
  if (
    !base &&
    typeof window !== "undefined" &&
    window.location?.protocol === "wails:"
  ) {
    return joinUrl("", path);
  }

  return joinUrl(base, path);
}

export async function getApiUrlAsync(path: string): Promise<string> {
  // Deprecated: runtime discovery happens in main.tsx.
  // Keep this export for potential future use, but implement via getApiBaseAsync.
  const base = await getApiBaseAsync();
  return joinUrl(base, path);
}

export function getWsBase(): string {
  const fromEnv = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (fromEnv && fromEnv.length > 0) {
    try {
      const url = new URL(fromEnv);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.pathname = "";
      url.search = "";
      url.hash = "";
      return url.toString().replace(/\/$/, "");
    } catch {
      // ignore and fall back below
    }
  }

  if (typeof window !== "undefined" && window.location?.protocol === "wails:") {
    return cachedRuntime?.wsBaseUrl ?? "";
  }

  const apiBase = getApiBase();
  if (!apiBase) {
    return "";
  }

  try {
    const url = new URL(apiBase);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

export async function getWsBaseAsync(): Promise<string> {
  const sync = getWsBase();
  if (sync) return sync;

  if (typeof window !== "undefined" && window.location?.protocol === "wails:") {
    const rt = await fetchRuntimeInfo();
    return rt?.wsBaseUrl ?? "";
  }

  return "";
}

export function getWsUrl(path: string): string {
  const base = getWsBase();

  // In packaged GUI before runtime discovery finishes, base can be empty.
  // Falling back to window.location.host would incorrectly produce `ws://localhost`.
  // Return a relative URL so code that hasn't awaited runtime init can't accidentally
  // connect to the wrong place.
  if (
    !base &&
    typeof window !== "undefined" &&
    window.location?.protocol === "wails:"
  ) {
    return joinUrl("", path);
  }

  return joinUrl(base, path);
}

export async function getWsUrlAsync(path: string): Promise<string> {
  // Deprecated: runtime discovery happens in main.tsx.
  const base = await getWsBaseAsync();

  if (!base) {
    if (typeof window === "undefined" || !window.location) {
      return joinUrl("", path);
    }
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const origin = `${proto}//${window.location.host}`;
    return joinUrl(origin, path);
  }

  return joinUrl(base, path);
}

export function getApiBase(): string {
  // 1) Prefer explicit override from environment (Vite)
  const fromEnv = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv.replace(/\/$/, "");
  }

  // 2) Default to same-origin.
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }

  console.error(
    "Choraleia API base URL is not configured. " +
      "Expected browser window.location.origin or VITE_API_BASE_URL.",
  );
  return "";
}

export function getWsBase(): string {
  // 1) Prefer explicit override from environment (Vite)
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
      // ignore
    }
  }

  // 2) Default to same-origin WebSocket.
  if (typeof window !== "undefined" && window.location) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return protocol + "//" + window.location.host;
  }

  console.error(
    "Choraleia WS base URL is not configured. " +
      "Expected browser window.location or VITE_API_BASE_URL.",
  );
  return "";
}

function joinUrl(base: string, path: string): string {
  const cleanPath = "/" + String(path || "").replace(/^\/+/, "");

  if (!base) return cleanPath;

  try {
    // If base is absolute (e.g. http://127.0.0.1:8088), use the URL resolver.
    const u = new URL(base);
    const baseNoSlash = u.toString().replace(/\/+$/, "");
    return baseNoSlash + cleanPath;
  } catch {
    // base might be relative; fall back to simple concatenation.
    const cleanBase = String(base).replace(/\/+$/, "");
    return cleanBase + cleanPath;
  }
}

export function getApiUrl(path: string): string {
  return joinUrl(getApiBase(), path);
}

export function getWsUrl(path: string): string {
  return joinUrl(getWsBase(), path);
}

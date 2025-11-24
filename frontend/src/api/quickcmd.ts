export interface QuickCommandDTO {
  id: string;
  name: string;
  content: string;
  tags: string[];
  order?: number;
  updatedAt?: string;
}

interface Response<T = any> {
  code: number;
  message: string;
  data?: T;
}
interface ListResponse {
  commands: QuickCommandDTO[];
  total: number;
}

const API_BASE = "http://wails.localhost:8088/api/quickcmd";

export async function fetchQuickCommands(): Promise<QuickCommandDTO[]> {
  const resp = await fetch(API_BASE);
  if (!resp.ok) throw new Error("HTTP " + resp.status);
  const j: Response<ListResponse> = await resp.json();
  if (j.code !== 200) throw new Error(j.message || "load failed");
  return j.data?.commands || [];
}

export async function createQuickCommand(payload: {
  name: string;
  content: string;
  tags: string[];
}): Promise<QuickCommandDTO> {
  const resp = await fetch(API_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const j: Response<QuickCommandDTO> = await resp.json();
  if (resp.status === 201 && j.code === 200) return j.data as QuickCommandDTO;
  if (j.code !== 200) throw new Error(j.message || "create failed");
  return j.data as QuickCommandDTO;
}

export async function updateQuickCommand(
  id: string,
  payload: Partial<{ name: string; content: string; tags: string[] }>,
): Promise<QuickCommandDTO> {
  const resp = await fetch(`${API_BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const j: Response<QuickCommandDTO> = await resp.json();
  if (j.code !== 200) throw new Error(j.message || "update failed");
  return j.data as QuickCommandDTO;
}

export async function deleteQuickCommand(id: string): Promise<void> {
  const resp = await fetch(`${API_BASE}/${id}`, { method: "DELETE" });
  const j: Response = await resp.json();
  if (j.code !== 200) throw new Error(j.message || "delete failed");
}

export async function reorderQuickCommands(
  ids: string[],
): Promise<QuickCommandDTO[]> {
  const resp = await fetch(`${API_BASE}/reorder`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  const j: Response<ListResponse> = await resp.json();
  if (j.code !== 200) throw new Error(j.message || "reorder failed");
  return j.data?.commands || [];
}

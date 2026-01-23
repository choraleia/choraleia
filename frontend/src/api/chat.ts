// Workspace Chat API - OpenAI-compatible format
import { getApiBase } from "./base";

const baseUrl = getApiBase();

// ========== Types ==========

export type MessageRole = "user" | "assistant" | "system" | "tool";

// ========== MessagePart Types (matches db.MessagePart) ==========

export type MessagePartType =
  | "text"
  | "reasoning"
  | "tool_call"
  | "tool_result"
  | "image_url"
  | "audio_url"
  | "video_url"
  | "file_url";

export interface ToolCallPart {
  id: string;
  name: string;
  arguments: string;
}

export interface ToolResultPart {
  tool_call_id: string;
  name?: string;
  content: string;
}

export interface ImageURL {
  url: string;
  mime_type?: string;
  detail?: "auto" | "low" | "high";
}

export interface AudioURL {
  url: string;
  mime_type?: string;
  duration?: number;
}

export interface VideoURL {
  url: string;
  mime_type?: string;
  duration?: number;
}

export interface FileURL {
  url: string;
  mime_type?: string;
  name?: string;
  size?: number;
}

export interface MessagePart {
  type: MessagePartType;
  index?: number; // Round index for agent multi-round scenarios
  text?: string;
  tool_call?: ToolCallPart;
  tool_result?: ToolResultPart;
  image_url?: ImageURL;
  audio_url?: AudioURL;
  video_url?: VideoURL;
  file_url?: FileURL;
}

// ========== OpenAI-compatible Types ==========

export interface ToolCall {
  index?: number;
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// OpenAI-compatible message for API request/response
export interface ChatCompletionMessage {
  role: MessageRole;
  content: string | null;
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  reasoning_content?: string;
}

// ========== Database/Storage Types ==========

export interface Conversation {
  id: string;
  workspace_id: string;
  room_id?: string;
  title: string;
  model_id?: string;
  status: "active" | "archived";
  // Compression fields
  compressed_at?: string;
  compression_count?: number;
  summary?: string;
  key_topics?: string[];
  key_decisions?: string[];
  created_at: string;
  updated_at: string;
}

// Message - matches db.Message structure
// This is what we get from the API when loading messages
export interface Message {
  id: string;
  conversation_id: string;
  parent_id?: string | null;
  branch_index: number;
  role: "user" | "assistant" | "system";
  parts?: MessagePart[]; // Can be undefined/null
  name?: string;
  status: "pending" | "streaming" | "completed" | "error";
  finish_reason?: string;
  usage?: TokenUsage;
  // Compression fields
  is_compressed?: boolean;
  snapshot_id?: string;
  token_count?: number;
  created_at: string;
  updated_at: string;
}

// ========== Request/Response Types ==========

export interface ChatCompletionRequest {
  model?: string;
  messages: ChatCompletionMessage[];
  stream?: boolean;
  conversation_id?: string;
  workspace_id?: string;
  room_id?: string;
  agent_id?: string; // WorkspaceAgent ID to use
  temperature?: number;
  max_tokens?: number;
  // Branch support
  parent_id?: string;
  source_id?: string;
  action?: "new" | "edit" | "regenerate";
}

export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  conversation_id?: string;
  choices: Array<{
    index: number;
    message: ChatCompletionMessage;
    finish_reason: string;
  }>;
  usage?: TokenUsage;
}

// System event for compression notifications, etc.
export interface SystemEvent {
  type: string;
  message?: string;
  data?: Record<string, unknown>;
}

export interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  conversation_id?: string;
  choices: Array<{
    index: number;
    delta: {
      role?: MessageRole;
      content?: string;
      tool_calls?: ToolCall[];
      tool_call_id?: string;
      reasoning_content?: string;
      agent_name?: string;
      system_event?: SystemEvent;
    };
    finish_reason?: string;
  }>;
  usage?: TokenUsage;
}

export interface CreateConversationRequest {
  title?: string;
  workspace_id: string;
  room_id?: string;
  model_id?: string;
}

export interface UpdateConversationRequest {
  title?: string;
  status?: "active" | "archived";
}

export interface ConversationListResponse {
  conversations: Conversation[];
  has_more: boolean;
}

export interface MessageListResponse {
  messages: Message[];
}

// ========== Helper Functions ==========

/**
 * Extract text content from message parts
 */
export function getTextFromParts(parts: MessagePart[]): string {
  return parts
    .filter(p => p.type === "text" && p.text)
    .map(p => p.text!)
    .join("\n");
}

/**
 * Extract reasoning content from message parts
 */
export function getReasoningFromParts(parts: MessagePart[]): string {
  return parts
    .filter(p => p.type === "reasoning" && p.text)
    .map(p => p.text!)
    .join("\n");
}

/**
 * Extract tool calls from message parts
 */
export function getToolCallsFromParts(parts: MessagePart[]): ToolCallPart[] {
  return parts
    .filter(p => p.type === "tool_call" && p.tool_call)
    .map(p => p.tool_call!);
}

/**
 * Extract tool results from message parts
 */
export function getToolResultsFromParts(parts: MessagePart[]): ToolResultPart[] {
  return parts
    .filter(p => p.type === "tool_result" && p.tool_result)
    .map(p => p.tool_result!);
}

/**
 * Get the maximum round index from parts
 */
export function getMaxRoundIndex(parts: MessagePart[]): number {
  return Math.max(0, ...parts.map(p => p.index ?? 0));
}

// ========== API Functions ==========

/**
 * Create a new conversation
 */
export async function createConversation(
  req: CreateConversationRequest
): Promise<Conversation> {
  const res = await fetch(`${baseUrl}/api/v1/conversations?workspace_id=${req.workspace_id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to create conversation: ${res.statusText}`);
  }
  return res.json();
}

/**
 * List conversations for a workspace
 */
export async function listConversations(
  workspaceId: string,
  options?: { status?: string; limit?: number; offset?: number }
): Promise<ConversationListResponse> {
  const params = new URLSearchParams({ workspace_id: workspaceId });
  if (options?.status) params.set("status", options.status);
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.offset) params.set("offset", String(options.offset));

  const res = await fetch(`${baseUrl}/api/v1/conversations?${params}`);
  if (!res.ok) {
    throw new Error(`Failed to list conversations: ${res.statusText}`);
  }
  return res.json();
}

/**
 * Get a conversation by ID
 */
export async function getConversation(id: string): Promise<Conversation> {
  const res = await fetch(`${baseUrl}/api/v1/conversations/${id}`);
  if (!res.ok) {
    throw new Error(`Failed to get conversation: ${res.statusText}`);
  }
  return res.json();
}

/**
 * Update a conversation
 */
export async function updateConversation(
  id: string,
  req: UpdateConversationRequest
): Promise<Conversation> {
  const res = await fetch(`${baseUrl}/api/v1/conversations/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    throw new Error(`Failed to update conversation: ${res.statusText}`);
  }
  return res.json();
}

/**
 * Delete a conversation
 */
export async function deleteConversation(id: string): Promise<void> {
  const res = await fetch(`${baseUrl}/api/v1/conversations/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    throw new Error(`Failed to delete conversation: ${res.statusText}`);
  }
}

/**
 * Get messages for a conversation
 */
export async function getMessages(
  conversationId: string
): Promise<MessageListResponse> {
  const res = await fetch(`${baseUrl}/api/v1/conversations/${conversationId}/messages`);
  if (!res.ok) {
    throw new Error(`Failed to get messages: ${res.statusText}`);
  }
  return res.json();
}

/**
 * Send a chat completion request (non-streaming)
 */
export async function chatCompletion(
  req: ChatCompletionRequest
): Promise<ChatCompletionResponse> {
  const params = new URLSearchParams();
  if (req.workspace_id) params.set("workspace_id", req.workspace_id);

  const res = await fetch(`${baseUrl}/api/v1/chat/completions?${params}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...req, stream: false }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Chat completion failed: ${res.statusText}`);
  }
  return res.json();
}

/**
 * Send a streaming chat completion request
 * Returns an async generator that yields chunks
 */
export async function* chatCompletionStream(
  req: ChatCompletionRequest
): AsyncGenerator<ChatCompletionChunk, void, unknown> {
  const params = new URLSearchParams();
  if (req.workspace_id) params.set("workspace_id", req.workspace_id);

  const res = await fetch(`${baseUrl}/api/v1/chat/completions?${params}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...req, stream: true }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Chat completion failed: ${res.statusText}`);
  }

  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error("No response body");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "data: [DONE]") continue;
        if (trimmed.startsWith("data: ")) {
          try {
            const data = JSON.parse(trimmed.slice(6));
            yield data as ChatCompletionChunk;
          } catch (e) {
            console.warn("Failed to parse SSE data:", trimmed);
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Cancel an active streaming session
 */
export async function cancelStream(conversationId: string): Promise<void> {
  const res = await fetch(`${baseUrl}/api/v1/chat/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversation_id: conversationId }),
  });
  if (!res.ok) {
    throw new Error(`Failed to cancel stream: ${res.statusText}`);
  }
}

/**
 * Get the streaming status of a conversation
 */
export async function getStreamStatus(conversationId: string): Promise<{ conversation_id: string; is_streaming: boolean }> {
  const res = await fetch(`${baseUrl}/api/v1/chat/status/${encodeURIComponent(conversationId)}`);
  if (!res.ok) {
    throw new Error(`Failed to get stream status: ${res.statusText}`);
  }
  return res.json();
}

// StreamState represents the current state of a streaming session
export interface StreamState {
  is_streaming: boolean;
  conversation_id: string;
  message_id?: string;
  last_event_id: number;
  started_at?: string;
}

/**
 * Get the streaming state of a conversation
 */
export async function getStreamState(conversationId: string): Promise<StreamState> {
  const res = await fetch(`${baseUrl}/api/v1/chat/state/${encodeURIComponent(conversationId)}`);
  if (!res.ok) {
    throw new Error(`Failed to get stream state: ${res.statusText}`);
  }
  return res.json();
}

/**
 * Continue/reconnect to an active stream
 * This will first replay all buffered chunks, then stream new chunks until completion
 */
export function continueStream(conversationId: string): AsyncIterable<ChatCompletionChunk> {
  return {
    async *[Symbol.asyncIterator]() {
      const res = await fetch(`${baseUrl}/api/v1/chat/completions/continue/${encodeURIComponent(conversationId)}`);
      if (!res.ok) {
        throw new Error(`Failed to continue stream: ${res.statusText}`);
      }
      if (!res.body) {
        throw new Error("No response body");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;

          const data = trimmed.slice(6);
          if (data === "[DONE]") return;

          try {
            const chunk = JSON.parse(data) as ChatCompletionChunk;
            yield chunk;
          } catch {
            // Skip invalid JSON
          }
        }
      }
    },
  };
}


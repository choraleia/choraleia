// Compression API client
import { getApiBase } from "./base";

const baseUrl = getApiBase();

// ========== Types ==========

export interface ConversationSnapshot {
  id: string;
  conversation_id: string;
  workspace_id: string;
  summary: string;
  key_topics?: string[];
  key_decisions?: string[];
  from_message_id: string;
  to_message_id: string;
  message_count: number;
  original_tokens: number;
  compressed_tokens: number;
  compression_ratio: number;
  memory_ids?: string[];
  created_at: string;
}

export interface CompressionInfo {
  is_compressed: boolean;
  snapshot_id?: string;
}

export interface MessageWithCompression {
  id: string;
  conversation_id: string;
  parent_id?: string | null;
  branch_index: number;
  role: "user" | "assistant" | "system";
  parts?: unknown[];
  name?: string;
  status: "pending" | "streaming" | "completed" | "error";
  finish_reason?: string;
  created_at: string;
  updated_at: string;
  compression_info?: CompressionInfo;
}

// Extended conversation with compression fields
export interface ConversationWithCompression {
  id: string;
  workspace_id: string;
  room_id?: string;
  title: string;
  model_id?: string;
  status: "active" | "archived";
  // Compression fields
  compressed_at?: string;
  compression_count: number;
  summary?: string;
  key_topics?: string[];
  key_decisions?: string[];
  created_at: string;
  updated_at: string;
}


// ========== API Functions ==========

/**
 * Get compression snapshots for a conversation
 */
export async function getSnapshots(
  conversationId: string
): Promise<{ snapshots: ConversationSnapshot[]; count: number }> {
  const res = await fetch(
    `${baseUrl}/api/conversations/${conversationId}/snapshots`
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/**
 * Manually trigger compression for a conversation
 */
export async function compressConversation(
  conversationId: string
): Promise<{ message: string; snapshot: ConversationSnapshot | null }> {
  const res = await fetch(
    `${baseUrl}/api/conversations/${conversationId}/compress`,
    { method: "POST" }
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/**
 * Get messages with compression info
 */
export async function getMessagesWithCompressionInfo(
  conversationId: string
): Promise<{ messages: MessageWithCompression[] }> {
  const res = await fetch(
    `${baseUrl}/api/v1/conversations/${conversationId}/messages?include_compression_info=true`
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/**
 * Analyze a conversation (extract memories and topics)
 */
export async function analyzeConversation(
  conversationId: string,
  workspaceId: string
): Promise<{ message: string }> {
  const res = await fetch(
    `${baseUrl}/api/conversations/${conversationId}/analyze?workspace_id=${workspaceId}`,
    { method: "POST" }
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/**
 * Extract topics from a conversation
 */
export async function extractTopics(
  conversationId: string
): Promise<{ topics: string[] }> {
  const res = await fetch(
    `${baseUrl}/api/conversations/${conversationId}/extract-topics`,
    { method: "POST" }
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}


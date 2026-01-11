// WorkspaceChat - Main chat component for workspace using assistant-ui
"use client";

import { useCallback, useEffect, useState, useRef, useMemo } from "react";
import {
  AppendMessage,
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  ExternalStoreThreadListAdapter,
  ExportedMessageRepository,
  ThreadMessageLike,
} from "@assistant-ui/react";
import { Box, CircularProgress, IconButton, Tooltip, Typography } from "@mui/material";
import FormatListBulletedIcon from "@mui/icons-material/FormatListBulleted";
import AddIcon from "@mui/icons-material/Add";
import { v4 as uuidv4 } from "uuid";
import { WorkspaceChatThread, ModelConfig, AgentMode } from "./WorkspaceChatThread";
import { ThreadList } from "./chat/thread-list";
import "./chat/globals.css";
import { useWorkspaces } from "../../state/workspaces";
import {
  createConversation,
  listConversations,
  getMessages,
  updateConversation,
  deleteConversation,
  chatCompletionStream,
  cancelStream,
  getStreamState,
  continueStream,
  Message,
  MessagePart,
  ChatCompletionChunk,
} from "../../api/chat";
import { getApiUrl } from "../../api/base";

interface WorkspaceChatProps {
  workspaceId: string;
  onConversationChange?: (conversationId: string) => void;
}

// Extended thread data
interface ThreadData {
  id: string;
  title: string;
  status: "regular" | "archived";
  createdAt: Date;
  updatedAt: Date;
}

// Frontend message type - simplified for UI state management
// Compatible with both Message (from API) and streaming updates
type UIMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: any[];  // Structured content array for UI
  createdAt: Date;
  parentId: string | null;
  status?: "running" | "complete" | "error";
};

// Convert MessagePart to UI content format
function partToUIContent(part: MessagePart, toolResultsMap: Map<string, string>): any | null {
  switch (part.type) {
    case "text":
      return part.text ? { type: "text", text: part.text } : null;
    case "reasoning":
      return part.text ? { type: "reasoning", text: part.text } : null;
    case "tool_call":
      if (part.tool_call) {
        return {
          type: "tool-call",
          toolCallId: part.tool_call.id,
          toolName: part.tool_call.name,
          argsText: part.tool_call.arguments,
          result: toolResultsMap.get(part.tool_call.id),
        };
      }
      return null;
    case "tool_result":
      // Tool results are merged into tool-call parts, not displayed separately
      return null;
    case "image_url":
      return part.image_url ? { type: "image", url: part.image_url.url, detail: part.image_url.detail } : null;
    case "audio_url":
      return part.audio_url ? { type: "audio", url: part.audio_url.url } : null;
    case "video_url":
      return part.video_url ? { type: "video", url: part.video_url.url } : null;
    case "file_url":
      return part.file_url ? { type: "file", url: part.file_url.url, name: part.file_url.name } : null;
    default:
      return null;
  }
}

// Convert Message to UIMessage
function storedToUIMessage(msg: Message, toolResultsMap: Map<string, string>): UIMessage | null {
  const content: any[] = [];

  // Convert parts to UI content
  if (msg.parts && msg.parts.length > 0) {
    for (const part of msg.parts) {
      const uiContent = partToUIContent(part, toolResultsMap);
      if (uiContent) {
        content.push(uiContent);
      }
    }
  }

  // Ensure at least empty text content
  if (content.length === 0) {
    content.push({ type: "text", text: "" });
  }

  return {
    id: msg.id,
    role: msg.role,
    content,
    createdAt: new Date(msg.created_at),
    parentId: msg.parent_id ?? null,
    status: msg.status === "streaming" ? "running" : msg.status === "error" ? "error" : "complete",
  };
}

// Convert Message array to UIMessage array
function storedMessagesToUIMessages(apiMessages: Message[]): UIMessage[] {
  // Build tool results map from tool_result parts
  const toolResultsMap = new Map<string, string>();
  for (const msg of apiMessages) {
    if (msg.parts) {
      for (const part of msg.parts) {
        if (part.type === "tool_result" && part.tool_result) {
          toolResultsMap.set(part.tool_result.tool_call_id, part.tool_result.content);
        }
      }
    }
  }

  const result: UIMessage[] = [];
  for (const msg of apiMessages) {
    const converted = storedToUIMessage(msg, toolResultsMap);
    if (converted) result.push(converted);
  }


  return result;
}

export default function WorkspaceChat({ workspaceId, onConversationChange }: WorkspaceChatProps) {
  // Get room state for persisting conversation ID
  const { activeRoom, setCurrentConversationId: persistConversationId } = useWorkspaces();

  // State
  const [threads, setThreads] = useState<ThreadData[]>([]);
  // Initialize from room's persisted conversation ID
  const [currentThreadId, setCurrentThreadIdLocal] = useState<string>(activeRoom?.currentConversationId || "");
  const [allMessages, setAllMessages] = useState<UIMessage[]>([]);
  const [currentHeadId, setCurrentHeadId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isThreadLoading, setIsThreadLoading] = useState(false);
  // Initialize isNewChat based on whether we have a persisted conversation
  const [isNewChat, setIsNewChat] = useState(!activeRoom?.currentConversationId);

  // Wrapper to persist conversation ID to room state
  const setCurrentThreadId = useCallback((id: string) => {
    setCurrentThreadIdLocal(id);
    currentThreadIdRef.current = id;
    persistConversationId(id);
  }, [persistConversationId]);

  // Panel visibility and width state
  const [showThreadList, setShowThreadList] = useState(false); // Default: hide thread list
  const [threadListWidth, setThreadListWidth] = useState(220);

  // Model state
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [groupedModelOptions, setGroupedModelOptions] = useState<Record<string, ModelConfig[]>>({});

  // Agent mode state
  const [agentMode, setAgentMode] = useState<AgentMode>("tools");

  // Refs
  const abortControllerRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const currentThreadIdRef = useRef<string>(activeRoom?.currentConversationId || "");

  // Resize handlers
  const handleThreadListResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = threadListWidth;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const newWidth = Math.max(120, startWidth + delta);
      setThreadListWidth(newWidth);
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [threadListWidth]);


  // Compute effective headId - auto-detect if not explicitly set
  const effectiveHeadId = useMemo(() => {
    if (currentHeadId) return currentHeadId;
    if (allMessages.length === 0) return null;

    // Auto-detect: find the most recent leaf node
    // A leaf is a message that has no children
    const idsWithChildren = new Set<string>();
    for (const msg of allMessages) {
      if (msg.parentId) idsWithChildren.add(msg.parentId);
    }
    const leaves = allMessages.filter(m => !idsWithChildren.has(m.id));
    if (leaves.length === 0) return allMessages[allMessages.length - 1].id;

    // Prefer assistant messages as head (in a normal conversation, the last message should be from assistant)
    // But if there are only user leaves (e.g., user just sent a message), use those
    const assistantLeaves = leaves.filter(m => m.role === "assistant");
    const targetLeaves = assistantLeaves.length > 0 ? assistantLeaves : leaves;

    // Pick most recent leaf
    return targetLeaves.reduce((latest, msg) =>
      msg.createdAt > latest.createdAt ? msg : latest
    ).id;
  }, [allMessages, currentHeadId]);

  // Build message repository for branching support
  const messageRepository = useMemo(() => {
    if (allMessages.length === 0) {
      return { headId: null, messages: [] } as ExportedMessageRepository;
    }

    const repoMessages = allMessages.map(msg => ({
      message: {
        id: msg.id,
        role: msg.role,
        content: msg.content,
        createdAt: msg.createdAt,
        status: msg.status === "running"
          ? { type: "running" as const }
          : { type: "complete" as const, reason: "stop" as const },
        metadata: {
          unstable_state: undefined,
          unstable_annotations: undefined,
          unstable_data: undefined,
          steps: undefined,
          custom: {},
        },
      } as ThreadMessageLike,
      parentId: msg.parentId,
    }));

    return { headId: effectiveHeadId, messages: repoMessages } as ExportedMessageRepository;
  }, [allMessages, effectiveHeadId]);

  // Compute current branch path (for getting last message's parent)
  const currentBranchPath = useMemo(() => {
    if (allMessages.length === 0 || !effectiveHeadId) return [];

    const messageMap = new Map(allMessages.map(m => [m.id, m]));
    const path: UIMessage[] = [];
    let current = messageMap.get(effectiveHeadId);
    while (current) {
      path.unshift(current);
      current = current.parentId ? messageMap.get(current.parentId) : undefined;
    }
    return path;
  }, [allMessages, effectiveHeadId]);

  // Load model list
  const loadModels = useCallback(async () => {
    try {
      const resp = await fetch(getApiUrl("/api/models"));
      if (resp.ok) {
        const data = await resp.json();
        const models: ModelConfig[] = data.data || [];

        // Group by provider
        const grouped: Record<string, ModelConfig[]> = {};
        models.forEach((m) => {
          const provider = m.provider || "Other";
          if (!grouped[provider]) {
            grouped[provider] = [];
          }
          grouped[provider].push(m);
        });
        setGroupedModelOptions(grouped);

        // Set default model if not set
        if (!selectedModel && models.length > 0) {
          setSelectedModel(models[0].name);
        }
      }
    } catch (error) {
      console.error("Failed to load models:", error);
    }
  }, [selectedModel]);

  // Load conversations list
  // silent: if true, don't set isLoading state (used after creating new conversation)
  const loadThreads = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const response = await listConversations(workspaceId);
      const threadList: ThreadData[] = response.conversations.map((conv) => ({
        id: conv.id,
        title: conv.title,
        status: conv.status === "archived" ? "archived" : "regular",
        createdAt: new Date(conv.created_at),
        updatedAt: new Date(conv.updated_at),
      }));
      setThreads(threadList);
    } catch (error) {
      console.error("Failed to load threads:", error);
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [workspaceId]);

  // Process streaming chunks and update UI - same logic as streamChat
  const processStreamChunks = useCallback(async (
    messageId: string,
    stream: AsyncIterable<ChatCompletionChunk>
  ) => {
    const contentParts: any[] = [];

    try {
      for await (const chunk of stream) {
        if (abortControllerRef.current?.signal.aborted) break;

        for (const choice of chunk.choices) {
          // New assistant round marker - skip
          if (choice.delta.role === "assistant" && !choice.delta.content && !choice.delta.tool_calls && !choice.delta.reasoning_content) {
            continue;
          }

          // Tool results - find tool-call part by tool_call_id and update result
          if (choice.delta.role === "tool" && choice.delta.tool_call_id) {
            const toolCallId = choice.delta.tool_call_id;
            const toolCallPart = contentParts.find(
              p => p.type === "tool-call" && p.toolCallId === toolCallId
            );
            if (toolCallPart) {
              toolCallPart.result = choice.delta.content || "";
            }
            continue;
          }

          // Reasoning - append to last if also reasoning, otherwise create new
          if (choice.delta.reasoning_content) {
            const lastPart = contentParts[contentParts.length - 1];
            if (lastPart && lastPart.type === "reasoning") {
              lastPart.text += choice.delta.reasoning_content;
            } else {
              contentParts.push({ type: "reasoning", text: choice.delta.reasoning_content });
            }
          }

          // Content - append to last if also text, otherwise create new
          if (choice.delta.content && choice.delta.role !== "tool") {
            const lastPart = contentParts[contentParts.length - 1];
            if (lastPart && lastPart.type === "text") {
              lastPart.text += choice.delta.content;
            } else {
              contentParts.push({ type: "text", text: choice.delta.content });
            }
          }

          // Tool calls - always append new tool-call parts
          if (choice.delta.tool_calls) {
            for (const tc of choice.delta.tool_calls) {
              const toolCallId = tc.id || "";
              if (toolCallId) {
                // Check if this tool call already exists (streaming updates)
                let existingPart = contentParts.find(
                  p => p.type === "tool-call" && p.toolCallId === toolCallId
                );
                if (existingPart) {
                  // Update existing tool call (streaming arguments)
                  if (tc.function?.name) existingPart.toolName = tc.function.name;
                  if (tc.function?.arguments) existingPart.argsText += tc.function.arguments;
                } else {
                  // New tool call - append
                  contentParts.push({
                    type: "tool-call",
                    toolCallId,
                    toolName: tc.function?.name || "",
                    argsText: tc.function?.arguments || "",
                  });
                }
              }
            }
          }
        }

        // Update UI
        const newContent = contentParts.filter(p =>
          (p.type === "text" && p.text.length > 0) ||
          (p.type === "reasoning" && p.text.length > 0) ||
          (p.type === "tool-call" && p.toolName.length > 0)
        );
        if (newContent.length === 0) newContent.push({ type: "text", text: "" });

        setAllMessages((prev) =>
          prev.map((msg) => msg.id === messageId ? { ...msg, content: [...newContent] } : msg)
        );
      }

      // Mark complete
      setAllMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId
            ? { ...msg, status: "complete" as const }
            : msg
        )
      );
    } catch (error) {
      console.error("Error processing stream chunks:", error);
    } finally {
      setIsRunning(false);
    }
  }, []);

  // Load messages for a conversation - tries to resume from stream if active, otherwise loads from history
  const loadMessages = useCallback(async (conversationId: string) => {
    setIsThreadLoading(true);
    try {
      // First, check if there's an active stream for this conversation
      const streamState = await getStreamState(conversationId).catch(() => ({
        is_streaming: false,
        conversation_id: conversationId,
        last_event_id: 0,
        message_id: undefined,
      }));

      if (streamState.is_streaming) {
        // There's an active stream - load history first, then resume streaming
        console.log("[loadMessages] Active stream detected, resuming...");
        setIsRunning(true);

        // Load existing messages from history
        const response = await getMessages(conversationId);
        const msgs = response.messages;
        const uiMsgs = storedMessagesToUIMessages(msgs);
        setAllMessages(uiMsgs);
        setCurrentHeadId(null);

        // Resume streaming - use message_id from state or the last assistant message
        const messageId = streamState.message_id || uiMsgs.filter(m => m.role === "assistant").pop()?.id || uuidv4();
        const stream = continueStream(conversationId);
        processStreamChunks(messageId, stream);
      } else {
        // No active stream - just load from history
        const response = await getMessages(conversationId);
        setIsRunning(false);

        const msgs = response.messages;
        const uiMsgs = storedMessagesToUIMessages(msgs);

        // Debug logging
        console.log("[loadMessages] Raw messages from API:", msgs.map(m => ({
          id: m.id,
          role: m.role,
          parent_id: m.parent_id,
          parts: m.parts?.length,
        })));

        setAllMessages(uiMsgs);
        setCurrentHeadId(null);
      }
    } catch (error) {
      console.error("Failed to load messages:", error);
      setAllMessages([]);
      setCurrentHeadId(null);
      setIsRunning(false);
    } finally {
      setIsThreadLoading(false);
    }
  }, [processStreamChunks]);

  // Initial load - only run once on mount
  useEffect(() => {
    loadModels();
    loadThreads();
    // If there's a persisted conversation ID, load its messages
    if (activeRoom?.currentConversationId) {
      loadMessages(activeRoom.currentConversationId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  // Respond to room switching - load the room's conversation or reset to new chat
  useEffect(() => {
    if (!activeRoom) return;

    const roomConversationId = activeRoom.currentConversationId || "";

    // Only update if the conversation ID actually changed (use ref to avoid stale closure)
    if (roomConversationId !== currentThreadIdRef.current) {
      // Reset running state immediately when switching rooms
      setIsRunning(false);

      setCurrentThreadIdLocal(roomConversationId);
      currentThreadIdRef.current = roomConversationId;

      if (roomConversationId) {
        // Load the room's saved conversation (this will also fetch stream status from backend)
        setIsNewChat(false);
        loadMessages(roomConversationId);
      } else {
        // Reset to new chat state
        setAllMessages([]);
        setCurrentHeadId(null);
        setIsNewChat(true);
      }
    }
  }, [activeRoom?.id, activeRoom?.currentConversationId, loadMessages]);

  // Notify parent when conversation changes
  useEffect(() => {
    if (onConversationChange) {
      onConversationChange(currentThreadId);
    }
  }, [currentThreadId, onConversationChange]);

  // Shared streaming handler - used by onNew, onEdit, onReload
  const streamChat = useCallback(async (
    threadId: string,
    assistantMessageId: string,
    request: {
      messages: { role: "user" | "assistant" | "system" | "tool"; content: string }[];
      action?: "edit" | "regenerate";
      source_id?: string;
    }
  ) => {
    const stream = chatCompletionStream({
      workspace_id: workspaceId,
      conversation_id: threadId,
      model: selectedModel,
      messages: request.messages,
      stream: true,
      action: request.action,
      source_id: request.source_id,
    });

    const contentParts: any[] = [];

    for await (const chunk of stream) {
      if (abortControllerRef.current?.signal.aborted) break;

      for (const choice of chunk.choices) {
        // New assistant round marker - skip
        if (choice.delta.role === "assistant" && !choice.delta.content && !choice.delta.tool_calls && !choice.delta.reasoning_content) {
          continue;
        }

        // Tool results - find tool-call part by tool_call_id and update result
        if (choice.delta.role === "tool" && choice.delta.tool_call_id) {
          const toolCallId = choice.delta.tool_call_id;
          const toolCallPart = contentParts.find(
            p => p.type === "tool-call" && p.toolCallId === toolCallId
          );
          if (toolCallPart) {
            toolCallPart.result = choice.delta.content || "";
          }
          continue;
        }

        // Reasoning - append to last if also reasoning, otherwise create new
        if (choice.delta.reasoning_content) {
          const lastPart = contentParts[contentParts.length - 1];
          if (lastPart && lastPart.type === "reasoning") {
            lastPart.text += choice.delta.reasoning_content;
          } else {
            contentParts.push({ type: "reasoning", text: choice.delta.reasoning_content });
          }
        }

        // Content - append to last if also text, otherwise create new
        if (choice.delta.content && choice.delta.role !== "tool") {
          const lastPart = contentParts[contentParts.length - 1];
          if (lastPart && lastPart.type === "text") {
            lastPart.text += choice.delta.content;
          } else {
            contentParts.push({ type: "text", text: choice.delta.content });
          }
        }

        // Tool calls - always append new tool-call parts
        if (choice.delta.tool_calls) {
          for (const tc of choice.delta.tool_calls) {
            const toolCallId = tc.id || "";
            if (toolCallId) {
              // Check if this tool call already exists (streaming updates)
              let existingPart = contentParts.find(
                p => p.type === "tool-call" && p.toolCallId === toolCallId
              );
              if (existingPart) {
                // Update existing tool call (streaming arguments)
                if (tc.function?.name) existingPart.toolName = tc.function.name;
                if (tc.function?.arguments) existingPart.argsText += tc.function.arguments;
              } else {
                // New tool call - append
                contentParts.push({
                  type: "tool-call",
                  toolCallId,
                  toolName: tc.function?.name || "",
                  argsText: tc.function?.arguments || "",
                });
              }
            }
          }
        }
      }

      // Update UI
      const newContent = contentParts.filter(p =>
        (p.type === "text" && p.text.length > 0) ||
        (p.type === "reasoning" && p.text.length > 0) ||
        (p.type === "tool-call" && p.toolName.length > 0)
      );
      if (newContent.length === 0) newContent.push({ type: "text", text: "" });

      setAllMessages((prev) =>
        prev.map((msg) => msg.id === assistantMessageId ? { ...msg, content: [...newContent] } : msg)
      );
    }

    // Mark complete
    setAllMessages((prev) =>
      prev.map((msg) =>
        msg.id === assistantMessageId
          ? { ...msg, status: "complete" as const }
          : msg
      )
    );
  }, [workspaceId, selectedModel]);

  // Send message handler
  const onNew = useCallback(async (appendMessage: AppendMessage) => {
    const textContent = appendMessage.content
      .filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .join("\n");

    if (!textContent.trim()) return;

    let threadId = currentThreadId;

    // Only create conversation when sending the first message (isNewChat is true)
    if (isNewChat || !threadId) {
      try {
        const conv = await createConversation({
          workspace_id: workspaceId,
          title: "New Chat",
          model_id: selectedModel,
        });
        threadId = conv.id;
        setCurrentThreadId(threadId);
        setIsNewChat(false);
        // Load threads silently (don't trigger loading state)
        await loadThreads(true);
      } catch (error) {
        console.error("Failed to create conversation:", error);
        return;
      }
    }

    // Get the last message in current branch to set as parent
    const lastMessage = currentBranchPath[currentBranchPath.length - 1];
    const parentId = lastMessage?.id ?? null;

    const userMessage: UIMessage = {
      id: uuidv4(),
      role: "user",
      content: [{ type: "text", text: textContent }],
      createdAt: new Date(),
      parentId,
    };

    const assistantMessageId = uuidv4();
    const assistantMessage: UIMessage = {
      id: assistantMessageId,
      role: "assistant",
      content: [{ type: "text", text: "" }],
      createdAt: new Date(),
      parentId: userMessage.id,
      status: "running",
    };

    setAllMessages((prev) => [...prev, userMessage, assistantMessage]);
    setIsRunning(true);
    abortControllerRef.current = new AbortController();

    try {
      await streamChat(threadId, assistantMessageId, {
        messages: [{ role: "user", content: textContent }],
      });
      // Messages are already updated during streaming, no need to reload
    } catch (error) {
      console.error("Streaming error:", error);
      setAllMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessageId
            ? { ...msg, content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : "Unknown error"}` }], status: "error" as const }
            : msg
        )
      );
    } finally {
      setIsRunning(false);
      abortControllerRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentThreadId, workspaceId, selectedModel, streamChat, currentBranchPath, isNewChat]);

  // Cancel handler
  const onCancel = useCallback(async () => {
    abortControllerRef.current?.abort();
    if (currentThreadId) {
      try {
        await cancelStream(currentThreadId);
      } catch (error) {
        console.error("Failed to cancel stream:", error);
      }
    }
    setIsRunning(false);
  }, [currentThreadId]);

  // Reload handler - regenerate assistant response (creates a sibling branch)
  // parentId: the message before the assistant message (user message)
  // config.sourceId: the assistant message being regenerated
  const onReload = useCallback(async (parentId: string | null, config: { sourceId?: string | null }) => {
    if (!currentThreadId) return;

    const sourceId = config?.sourceId;
    if (!sourceId) {
      console.error("[onReload] No sourceId provided");
      return;
    }

    // Find the original assistant message to get its parent
    const originalMsg = allMessages.find(m => m.id === sourceId);
    const actualParentId = originalMsg?.parentId ?? parentId;

    // Create new assistant placeholder as sibling (same parent as original)
    const assistantMessageId = uuidv4();
    const assistantMessage: UIMessage = {
      id: assistantMessageId,
      role: "assistant",
      content: [{ type: "text", text: "" }],
      createdAt: new Date(),
      parentId: actualParentId,
      status: "running",
    };

    // Add new message to all messages (don't remove old branch)
    setAllMessages((prev) => [...prev, assistantMessage]);
    setIsRunning(true);
    abortControllerRef.current = new AbortController();

    try {
      await streamChat(currentThreadId, assistantMessageId, {
        messages: [],
        action: "regenerate",
        source_id: sourceId,
      });
      // Messages are already updated during streaming, no need to reload
    } catch (error) {
      console.error("Reload error:", error);
      setAllMessages((prev) => prev.map((msg) => msg.id === assistantMessageId ? { ...msg, content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : "Unknown error"}` }], status: "error" as const } : msg));
    } finally {
      setIsRunning(false);
      abortControllerRef.current = null;
    }
  }, [currentThreadId, allMessages, streamChat]);

  // Edit handler - user edits a previous message, creating a new branch
  const onEdit = useCallback(async (message: AppendMessage) => {
    const textContent = message.content
      .filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .join("\n");

    if (!textContent.trim() || !currentThreadId || !message.sourceId) return;

    // Find the original message to get its parent (for creating sibling branch)
    const originalMsg = allMessages.find(m => m.id === message.sourceId);
    const branchParentId = originalMsg?.parentId ?? null;

    // Create new user message as sibling to original (same parent)
    const userMessage: UIMessage = {
      id: uuidv4(),
      role: "user",
      content: [{ type: "text", text: textContent }],
      createdAt: new Date(),
      parentId: branchParentId,
    };

    const assistantMessageId = uuidv4();
    const assistantMessage: UIMessage = {
      id: assistantMessageId,
      role: "assistant",
      content: [{ type: "text", text: "" }],
      createdAt: new Date(),
      parentId: userMessage.id,
      status: "running",
    };

    // Add new messages to all messages (don't remove old branch)
    setAllMessages((prev) => [...prev, userMessage, assistantMessage]);
    setIsRunning(true);
    abortControllerRef.current = new AbortController();

    try {
      await streamChat(currentThreadId, assistantMessageId, {
        messages: [{ role: "user", content: textContent }],
        action: "edit",
        source_id: message.sourceId,
      });
      // Messages are already updated during streaming, no need to reload
    } catch (error) {
      console.error("Edit error:", error);
      setAllMessages((prev) => prev.map((msg) => msg.id === assistantMessageId ? { ...msg, content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : "Unknown error"}` }], status: "error" as const } : msg));
    } finally {
      setIsRunning(false);
      abortControllerRef.current = null;
    }
  }, [currentThreadId, allMessages, streamChat]);


  // Thread list adapter
  const threadList: ExternalStoreThreadListAdapter = {
    threadId: currentThreadId,
    threads: threads
      .filter((t) => t.status === "regular")
      .map((t) => ({
        id: t.id,
        title: t.title,
        status: "regular" as const,
      })),
    isLoading,
    onSwitchToNewThread: async () => {
      // Just reset state for new chat, don't create conversation yet
      setCurrentThreadId("");
      setAllMessages([]);
      setCurrentHeadId(null);
      setIsRunning(false);
      setIsNewChat(true);
    },
    onSwitchToThread: async (threadId: string) => {
      setCurrentThreadId(threadId);
      setIsNewChat(false); // Switching to existing thread
      setShowThreadList(false); // Auto close thread list after selection
      await loadMessages(threadId);
    },
    onRename: async (threadId: string, newTitle: string) => {
      try {
        await updateConversation(threadId, { title: newTitle });
        await loadThreads(true);
      } catch (error) {
        console.error("Failed to rename thread:", error);
      }
    },
    onDelete: async (threadId: string) => {
      try {
        await deleteConversation(threadId);
        const isCurrentThread = currentThreadId === threadId;
        // Load threads first (silently), then update local state
        await loadThreads(true);
        if (isCurrentThread) {
          setCurrentThreadId("");
          setAllMessages([]);
          setCurrentHeadId(null);
          setIsNewChat(true);
        }
      } catch (error) {
        console.error("Failed to delete thread:", error);
      }
    },
    onArchive: async () => {},
    onUnarchive: async () => {},
  };

  // Wrapper for setMessages to enable branch switching
  // When user switches to a different branch, this callback receives the new message path
  const handleSetMessages = useCallback((newMessages: readonly any[]) => {
    // When assistant-ui switches branches, it provides the new message path
    // We just need to update our head to point to the last message in this path
    if (newMessages.length > 0) {
      const newHeadId = newMessages[newMessages.length - 1].id;
      if (newHeadId) {
        setCurrentHeadId(newHeadId);
      }
    }
  }, []);

  // Create runtime with messageRepository for branching support
  const runtime = useExternalStoreRuntime({
    messageRepository,    // Use tree structure for branching support
    setMessages: handleSetMessages,  // Enable branch switching capability
    isRunning,
    isLoading: isThreadLoading,
    adapters: { threadList },
    onNew,
    onEdit,
    onCancel,
    onReload,
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Box
        ref={containerRef}
        className="aui-root"
        display="flex"
        height="100%"
        width="100%"
      >
        {/* Thread list sidebar */}
        {showThreadList && (
          <>
            <Box
              sx={{
                width: threadListWidth,
                minWidth: threadListWidth,
                maxWidth: threadListWidth,
                flexShrink: 0,
                flexGrow: 0,
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
              }}
            >
              <ThreadList />
            </Box>
            {/* Resizer for thread list */}
            <Box
              onMouseDown={handleThreadListResize}
              sx={{
                width: 5,
                cursor: "col-resize",
                flexShrink: 0,
                borderLeft: "1px solid",
                borderColor: "divider",
                "&:hover": {
                  borderColor: "primary.main",
                  borderLeftWidth: 2,
                },
              }}
            />
          </>
        )}

        {/* Main chat area - fills remaining space */}
        <Box
          sx={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            position: "relative",
          }}
        >
          {/* Top toolbar - replaces floating buttons */}
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.5,
              px: 1,
              height: 37,
              minHeight: 37,
              maxHeight: 37,
              borderBottom: "1px solid",
              borderColor: "divider",
              bgcolor: "background.paper",
              flexShrink: 0,
              boxSizing: "border-box",
            }}
          >
            {/* Left side: Thread list toggle + New chat */}
            <Box display="flex" alignItems="center" gap={0.5} sx={{ minWidth: 72 }}>
              <Tooltip title={showThreadList ? "Hide conversations" : "Show conversations"}>
                <IconButton
                  size="small"
                  onClick={() => setShowThreadList(!showThreadList)}
                  color={showThreadList ? "primary" : "default"}
                >
                  <FormatListBulletedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title={isNewChat ? "Already in new chat" : "New conversation"}>
                <span>
                  <IconButton
                    size="small"
                    disabled={isNewChat}
                    onClick={() => {
                      // Just reset state for new chat, don't create conversation yet
                      setCurrentThreadId("");
                      setAllMessages([]);
                      setCurrentHeadId(null);
                      setIsRunning(false);
                      setIsNewChat(true);
                    }}
                  >
                    <AddIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </Box>

            {/* Center: Current thread title */}
            <Box flex={1} display="flex" justifyContent="center" overflow="hidden" px={1}>
              <Typography
                variant="body2"
                noWrap
                sx={{
                  color: "text.secondary",
                  fontWeight: 500,
                  maxWidth: "100%",
                }}
              >
                {threads.find(t => t.id === currentThreadId)?.title || "New Chat"}
              </Typography>
            </Box>

            {/* Right side placeholder for symmetry */}
            <Box sx={{ minWidth: 72 }} />
          </Box>

          {/* Chat content */}
          <Box flex={1} display="flex" flexDirection="column" overflow="hidden">
            {isThreadLoading ? (
              <Box display="flex" alignItems="center" justifyContent="center" height="100%">
                <CircularProgress size={24} />
              </Box>
            ) : (
              <WorkspaceChatThread
                selectedModel={selectedModel}
                setSelectedModel={setSelectedModel}
                groupedModelOptions={groupedModelOptions}
                isLoading={isLoading}
                agentMode={agentMode}
                setAgentMode={setAgentMode}
              />
            )}
          </Box>
        </Box>
      </Box>
    </AssistantRuntimeProvider>
  );
}


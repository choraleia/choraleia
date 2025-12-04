"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import {
  AddToolResultOptions,
  AppendMessage,
  AssistantRuntimeProvider,
  ThreadMessageLike,
  useExternalStoreRuntime,
  ExternalStoreThreadListAdapter,
  ExternalStoreThreadData,
} from "@assistant-ui/react";
import { SSE } from "sse.js";
import { Thread } from "./thread.tsx";
import "./globals.css";
import { v4 as uuidv4 } from "uuid";
import { ChatMessage, RoleType } from "./chat-message.ts";
import { ThreadList } from "./thread-list.tsx";

// Tab pane data type (imported from App.tsx definitions)
interface TabPane {
  key: string;
  label: string;
  content: string;
  closable: boolean;
  hostInfo: {
    ip: string;
    port: number;
    name: string;
  };
  assetId?: string; // Asset ID field
}

// Added: AI assistant props type
interface AIAssistantProps {
  tabs: TabPane[];
  activeTabKey: string;
  visible: boolean; // Added visible
}

// Agent mode enum
type AgentMode = "tools" | "react";

// Terminal option type
interface TerminalOption {
  key: string;
  label: string;
  isActive: boolean;
}

// Added: model config type
export interface ModelConfig {
  id: string;
  provider: string;
  model: string;
  name: string;
  base_url: string;
  api_key: string;
  extra: Record<string, any>;
}

// Extended thread data including timestamps and asset session id
interface ExtendedThreadData extends ExternalStoreThreadData<"regular"> {
  createdAt: Date;
  updatedAt: Date;
  assetId?: string;
  assetSessionId?: string;
}

export default function AiAssistant({
  tabs,
  activeTabKey,
  visible,
}: AIAssistantProps) {
  // --- Per-tab chat state (conversation/messages/stream) ---
  interface TabChatState {
    conversationId: string;
    messages: ThreadMessageLike[];
    isRunning: boolean;
    sse: SSE | null;
    isLoading: boolean; // per-tab loading (initializing conversation / switching threads)
  }
  const [tabChatStates, setTabChatStates] = useState<
    Record<string, TabChatState>
  >({});
  // helper ensure state object exists for a tab
  const ensureTabState = (tabKey: string) => {
    setTabChatStates((prev) =>
      prev[tabKey]
        ? prev
        : {
            ...prev,
            [tabKey]: {
              conversationId: "",
              messages: [],
              isRunning: false,
              sse: null,
              isLoading: false,
            },
          },
    );
  };
  // derive current terminal from active tab
  const [currentTerminal, setCurrentTerminal] = useState<string>("welcome");
  // available terminals unchanged
  const [availableTerminals, setAvailableTerminals] = useState<
    TerminalOption[]
  >([]);
  // global threads list (unchanged)
  const [threads, setThreads] = useState<ExtendedThreadData[]>([]);
  // selected conversation id is per-tab; expose current active tab conversation id for runtime
  const activeState = tabChatStates[currentTerminal] || {
    conversationId: "",
    messages: [],
    isRunning: false,
    sse: null,
    isLoading: false,
  };
  const currentConversationId = activeState.conversationId; // for runtime
  const messages = activeState.messages; // runtime messages
  const isRunning = activeState.isRunning; // runtime running state
  // other existing states
  const [isLoading, setIsLoading] = useState(false);
  const [agentMode, setAgentMode] = useState<AgentMode>("tools");
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [selectedTerminals, setSelectedTerminals] = useState<string[]>([]);
  const [groupedModelOptions, setGroupedModelOptions] = useState<
    Record<string, ModelConfig[]>
  >({});
  const [titleGenerationStatus, setTitleGenerationStatus] = useState<
    Record<string, "pending" | "done">
  >({});
  // track previous running state per conversation to detect completion transitions
  const prevRunningRef = useRef<Record<string, boolean>>({});

  // Sync terminal state when props update
  useEffect(() => {
    const terminals: TerminalOption[] = tabs
      .filter((tab: any) => tab.key !== "welcome")
      .map((tab: any) => ({ key: tab.key, label: tab.label, isActive: true }));
    setAvailableTerminals(terminals);
    const newCurrentTerminal =
      activeTabKey === "welcome" ? "welcome" : activeTabKey;
    setCurrentTerminal(newCurrentTerminal);
    ensureTabState(newCurrentTerminal);
  }, [tabs, activeTabKey]);

  // Extract text helper unchanged
  const extractTextFromAppendMessage = (msg: AppendMessage): string => {
    if (Array.isArray(msg.content)) {
      return msg.content
        .filter((part) => part.type === "text")
        .map((part) =>
          part.text && typeof part.text === "string" ? part.text : "",
        )
        .join("");
    }
    return "";
  };

  // Load conversation list (threads) unchanged except using currentTerminal from state
  const loadThreads = useCallback(async () => {
    setIsLoading(true);
    try {
      let assetId = "";
      if (currentTerminal !== "welcome") {
        const currentTab = tabs.find((tab) => tab.key === currentTerminal);
        if (currentTab && currentTab.assetId) assetId = currentTab.assetId;
      }
      const url = assetId
        ? `http://wails.localhost:8088/api/conversations?asset_id=${encodeURIComponent(assetId)}`
        : "http://wails.localhost:8088/api/conversations";
      const resp = await fetch(url);
      if (resp.ok) {
        const data = await resp.json();
        const threadListData = (data || []).map((conv: any) => ({
          id: conv.id,
          title: conv.title,
          state: "regular",
          createdAt: new Date(conv.created_at),
          updatedAt: new Date(conv.updated_at),
          assetId: conv.asset_id,
          assetSessionId: conv.asset_session_id,
        }));
        setThreads(threadListData);
      }
    } catch (e) {
      console.error("Failed to load threads:", e);
    } finally {
      setIsLoading(false);
    }
  }, [currentTerminal, tabs]);

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  // Load messages for a conversation id (used when switching threads inside active tab)
  const loadMessages = useCallback(async (conversationId: string) => {
    try {
      const resp = await fetch(
        `http://wails.localhost:8088/api/conversations/${conversationId}/messages`,
      );
      if (resp.ok) {
        const data = await resp.json();
        return (data || []).map((msg: any) => {
          // Normalize content into ThreadMessageLike parts array
          let parts: any[] = [];
          if (Array.isArray(msg.content)) {
            parts = msg.content.map((part: any) => {
              if (part.type === "text") return { type: "text", text: part.text || "" };
              if (part.type === "reasoning") return { type: "reasoning", text: part.text || "" };
              if (part.type === "image_url") return { type: "image_url", imageURL: part.imageURL };
              if (part.type === "audio_url") return { type: "audio_url", audioURL: part.audioURL };
              if (part.type === "video_url") return { type: "video_url", videoURL: part.videoURL };
              if (part.type === "file_url") return { type: "file_url", fileURL: part.fileURL };
              if (part.type === "tool-call") {
                return {
                  type: "tool-call",
                  toolCallId: part.toolCallId || part.id,
                  toolName: part.toolName,
                  arguments: part.arguments,
                  result: part.result,
                };
              }
              return { type: part.type, ...part };
            });
          } else if (typeof msg.content === "string" && msg.content.length > 0) {
            parts = [{ type: "text", text: msg.content }];
          } else if (typeof msg.reasoning_content === "string" && msg.reasoning_content.length > 0) {
            parts = [{ type: "reasoning", text: msg.reasoning_content }];
          } else {
            parts = [];
          }
          return {
            id: msg.id || `msg_${Date.now()}_${Math.random()}`,
            role: (msg.role as "user" | "assistant") || "assistant",
            content: parts,
            createdAt: new Date(msg.created_at || Date.now()),
            metadata: { custom: {} },
          };
        });
      }
    } catch (e) {
      console.error("Failed to load messages:", e);
    }
    return [];
  }, []);

  // --- Send message for active tab ---
  const sendMessage = useCallback(
    async (msg: AppendMessage) => {
      const tabKey = currentTerminal;
      ensureTabState(tabKey);
      const textContent = extractTextFromAppendMessage(msg);
      let messageId = uuidv4();
      let conversationId = tabChatStates[tabKey]?.conversationId || "";
      // create conversation if needed for this tab
      if (!conversationId) {
        let assetId = "default";
        if (tabKey !== "welcome") {
          const currentTab = tabs.find((tab) => tab.key === tabKey);
          if (currentTab && currentTab.assetId) assetId = currentTab.assetId;
        }
        try {
          const createResponse = await fetch(
            "http://wails.localhost:8088/api/conversations",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                title: "New Conversation",
                asset_id: assetId,
                asset_session_id: tabKey,
              }),
            },
          );
          if (createResponse.ok) {
            const conversation = await createResponse.json();
            await loadThreads();
            conversationId = conversation.id;
            setTabChatStates((prev) => ({
              ...prev,
              [tabKey]: {
                ...(prev[tabKey] || {
                  messages: [],
                  isRunning: false,
                  sse: null,
                  conversationId: "",
                  isLoading: false,
                }),
                conversationId,
              },
            }));
          } else {
            return;
          }
        } catch (e) {
          return;
        }
      }
      const userMessage: ChatMessage = {
        conversationId,
        messageId,
        message: { role: RoleType.User, content: textContent },
      };
      const threadMessage = convertChatMessageToThreadMessageLike(userMessage);
      setTabChatStates((prev) => {
        const cur = prev[tabKey] || {
          conversationId,
          messages: [],
          isRunning: false,
          sse: null,
        };
        return {
          ...prev,
          [tabKey]: {
            ...cur,
            messages: [...cur.messages, threadMessage],
            isRunning: true,
            isLoading: false,
          },
        };
      });
      // close existing SSE only for this tab
      const existing = tabChatStates[tabKey]?.sse;
      if (existing) existing.close();
      try {
        const params = new URLSearchParams({
          agentMode,
          selectedModel,
          currentTerminal: tabKey,
          selectedTerminals: [
            tabKey,
            ...selectedTerminals.filter((t) => t !== tabKey),
          ].join(","),
        });
        const url = `http://wails.localhost:8088/api/chat?${params.toString()}`;
        const source = new SSE(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          payload: JSON.stringify(userMessage),
        });
        setTabChatStates((prev) => ({
          ...prev,
          [tabKey]: {
            ...(prev[tabKey] || {
              conversationId,
              messages: [threadMessage],
              isRunning: true,
              sse: null,
              isLoading: false,
            }),
            sse: source,
          },
        }));
        source.addEventListener("message", (event: any) => {
          try {
            const chatMessage: ChatMessage = JSON.parse(event.data);
            const tMsg = convertChatMessageToThreadMessageLike(chatMessage);
            setTabChatStates((prev) => {
              const cur = prev[tabKey];
              if (!cur) return prev;
              const idx = cur.messages.findIndex((m) => m.id === tMsg.id);
              let newMessages: ThreadMessageLike[];
              if (idx !== -1) {
                const oldContent = Array.isArray(cur.messages[idx].content)
                  ? cur.messages[idx].content
                  : [];
                const newContent = Array.isArray(tMsg.content)
                  ? tMsg.content
                  : [];
                const merged = {
                  ...cur.messages[idx],
                  content: [...oldContent, ...newContent],
                };
                newMessages = [...cur.messages];
                newMessages[idx] = merged;
              } else {
                newMessages = [...cur.messages, tMsg];
              }
              return { ...prev, [tabKey]: { ...cur, messages: newMessages } };
            });
          } catch (e) {
            console.error("Error parsing message data:", e);
          }
        });
        source.addEventListener("completed", () => {
          setTabChatStates((prev) => {
            const cur = prev[tabKey];
            if (!cur) return prev;
            return {
              ...prev,
              [tabKey]: {
                ...cur,
                isRunning: false,
                sse: null,
                isLoading: false,
              },
            };
          });
        });
        source.addEventListener("error", (event: any) => {
          console.error("SSE error:", event.data);
          let errorText =
            "❌ Sorry, an error occurred. Please try again later.";
          try {
            if (event.data) {
              const errorObj =
                typeof event.data === "string"
                  ? JSON.parse(event.data)
                  : event.data;
              if (errorObj.error && typeof errorObj.error === "string") {
                const match = errorObj.error.match(/Error code: 403 - ({.*})/);
                if (match && match[1]) {
                  const innerError = JSON.parse(match[1]);
                  if (innerError.code === "AccountOverdueError")
                    errorText =
                      "Your model account is overdue. Please recharge and retry.";
                }
              }
            }
          } catch (_) {}
          const errorMessage: ThreadMessageLike = {
            id: uuidv4(),
            role: "assistant",
            content: [{ type: "text", text: errorText }],
            createdAt: new Date(),
            metadata: { custom: {} },
          };
          setTabChatStates((prev) => {
            const cur = prev[tabKey];
            if (!cur) return prev;
            cur.sse?.close();
            return {
              ...prev,
              [tabKey]: {
                ...cur,
                messages: [...cur.messages, errorMessage],
                isRunning: false,
                sse: null,
                isLoading: false,
              },
            };
          });
        });
      } catch (e) {
        console.error("Error sending message:", e);
        const errorMessage: ThreadMessageLike = {
          id: uuidv4(),
          role: "assistant",
          content: [
            {
              type: "text",
              text: "Sorry, an error occurred. Please try again later. If you need to analyze terminal output, ensure the terminal connection is active.",
            },
          ],
          createdAt: new Date(),
          metadata: { custom: {} },
        };
        setTabChatStates((prev) => {
          const cur = prev[tabKey];
          if (!cur) return prev;
          return {
            ...prev,
            [tabKey]: {
              ...cur,
              messages: [...cur.messages, errorMessage],
              isRunning: false,
              isLoading: false,
            },
          };
        });
      }
    },
    [
      currentTerminal,
      tabChatStates,
      agentMode,
      selectedModel,
      selectedTerminals,
      tabs,
      loadThreads,
    ],
  );

  // Cancel only active tab stream
  const onCancel = useCallback(async () => {
    setTabChatStates((prev) => {
      const cur = prev[currentTerminal];
      if (!cur) return prev;
      cur.sse?.close();
      return {
        ...prev,
        [currentTerminal]: {
          ...cur,
          isRunning: false,
          sse: null,
          isLoading: false,
        },
      };
    });
  }, [currentTerminal]);

  // Tool result merge for active tab only
  const onAddToolResult = (options: AddToolResultOptions) => {
    const tabKey = currentTerminal;
    setTabChatStates((prev) => {
      const cur = prev[tabKey];
      if (!cur) return prev;
      return {
        ...prev,
        [tabKey]: {
          ...cur,
          messages: cur.messages.map((message) => {
            if (
              message.id === options.messageId &&
              Array.isArray(message.content)
            ) {
              return {
                ...message,
                content: message.content.map((part) => {
                  if (
                    part.type === "tool-call" &&
                    part.toolCallId === options.toolCallId
                  ) {
                    return { ...part, result: options.result };
                  }
                  return part;
                }),
              };
            }
            return message;
          }),
        },
      };
    });
  };

  // convertMessage optimized: single pass merging adjacent text/reasoning and consolidating tool-call results in O(n)
  const convertMessage = (message: ThreadMessageLike) => {
    const parts = message.content;
    if (!Array.isArray(parts) || parts.length < 2) return message;

    // Fast path: check if any merge/update work is needed
    let needsWork = false;
    for (let i = 1; i < parts.length; i++) {
      const prev = parts[i - 1];
      const curr = parts[i];
      if (
        (prev.type === curr.type && (curr.type === "text" || curr.type === "reasoning")) ||
        (curr.type === "tool-call" && curr.result !== undefined)
      ) {
        needsWork = true;
        break;
      }
    }
    if (!needsWork) return message;

    const out: typeof parts = [];
    const toolIndex: Record<string, number> = {};
    let last: any = null;

    for (const p of parts) {
      if (p.type === "tool-call" && p.toolCallId) {
        const idx = toolIndex[p.toolCallId];
        if (idx !== undefined) {
          if (p.result !== undefined && out[idx].result === undefined) {
            out[idx] = { ...out[idx], result: p.result };
          }
          continue;
        }
        toolIndex[p.toolCallId] = out.push(p) - 1;
        last = p;
        continue;
      }
      if (last && last.type === p.type && (p.type === "text" || p.type === "reasoning")) {
        last.text = (last.text || "") + (p.text || "");
        continue;
      }
      const normalized = (p.type === "text" || p.type === "reasoning")
        ? { type: p.type, text: p.text || "" }
        : p;
      out.push(normalized);
      last = normalized;
    }

    return { ...message, content: out };
  };

  // convertChatMessageToThreadMessageLike unchanged
  const convertChatMessageToThreadMessageLike = (
    chatMessage: ChatMessage,
  ): ThreadMessageLike => {
    const { messageId, message } = chatMessage;
    let content: any[] = [];
    if (message.tool_calls != null && message.tool_calls.length > 0) {
      content.push(
        ...message.tool_calls.map((toolCall) => ({
          type: "tool-call",
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          arguments: toolCall.function.arguments,
        })),
      );
    } else if (message.role === RoleType.Tool && message.tool_call_id) {
      message.role = RoleType.Assistant;
      content.push({
        type: "tool-call",
        toolCallId: message.tool_call_id,
        toolName: message.toolName,
        result: message.content,
      });
    } else if (
      Array.isArray(message.multiContent) &&
      message.multiContent.length > 0
    ) {
      content = message.multiContent.map((part: any) => {
        if (part.type === "text") return { type: "text", text: part.text };
        if (part.type === "image_url")
          return { type: "image_url", imageURL: part.imageURL };
        if (part.type === "audio_url")
          return { type: "audio_url", audioURL: part.audioURL };
        if (part.type === "video_url")
          return { type: "video_url", videoURL: part.videoURL };
        if (part.type === "file_url")
          return { type: "file_url", fileURL: part.fileURL };
        return { type: part.type, ...part };
      });
    } else if (message.content) {
      content.push({ type: "text", text: message.content });
    } else if (message.reasoning_content) {
      content.push({ type: "reasoning", text: message.reasoning_content });
    } else {
      console.log("Unsupported message format:", message);
    }
    return {
      id: messageId,
      role: message.role as any,
      content,
      createdAt: new Date(),
      metadata: { custom: message.extra || {} },
    };
  };

  // Thread list adapter referencing active tab state only
  const threadList: ExternalStoreThreadListAdapter = {
    threadId: currentConversationId,
    isLoading, // global thread list loading only
    threads,
    onSwitchToNewThread: async () => {
      let assetId = "default";
      if (currentTerminal !== "welcome") {
        const currentTab = tabs.find((t) => t.key === currentTerminal);
        if (currentTab && currentTab.assetId) assetId = currentTab.assetId;
      }
      // mark tab loading
      setTabChatStates((prev) => ({
        ...prev,
        [currentTerminal]: {
          ...(prev[currentTerminal] || {
            messages: [],
            isRunning: false,
            sse: null,
            conversationId: "",
            isLoading: false,
          }),
          isLoading: true,
        },
      }));
      const createResponse = await fetch(
        "http://wails.localhost:8088/api/conversations",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: "New Conversation",
            asset_id: assetId,
            asset_session_id: currentTerminal,
          }),
        },
      );
      if (createResponse.ok) {
        await loadThreads();
        const conversation = await createResponse.json();
        setTabChatStates((prev) => ({
          ...prev,
          [currentTerminal]: {
            ...(prev[currentTerminal] || {
              messages: [],
              isRunning: false,
              sse: null,
              conversationId: "",
              isLoading: true,
            }),
            conversationId: conversation.id,
            messages: [],
            isLoading: false,
          },
        }));
      } else {
        setTabChatStates((prev) => ({
          ...prev,
          [currentTerminal]: {
            ...(prev[currentTerminal] || {
              messages: [],
              isRunning: false,
              sse: null,
              conversationId: "",
              isLoading: true,
            }),
            isLoading: false,
          },
        }));
      }
    },
    onSwitchToThread: async (threadId: string) => {
      // set per-tab loading
      setTabChatStates((prev) => ({
        ...prev,
        [currentTerminal]: {
          ...(prev[currentTerminal] || {
            conversationId: threadId,
            messages: [],
            isRunning: false,
            sse: null,
            isLoading: false,
          }),
          isLoading: true,
        },
      }));
      setIsLoading(true);
      try {
        const msgs = await loadMessages(threadId);
        setTabChatStates((prev) => ({
          ...prev,
          [currentTerminal]: {
            ...(prev[currentTerminal] || {
              conversationId: threadId,
              messages: [],
              isRunning: false,
              sse: null,
              isLoading: false,
            }),
            conversationId: threadId,
            messages: msgs,
            isLoading: false,
          },
        }));
      } finally {
        setIsLoading(false);
      }
    },
    onRename: async (threadId: string, newTitle: string) => {
      await fetch(
        `http://wails.localhost:8088/api/conversations/${threadId}/title`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: newTitle }),
        },
      );
      await loadThreads();
    },
    onDelete: async (threadId: string) => {
      try {
        const resp = await fetch(
          `http://wails.localhost:8088/api/conversations/${threadId}`,
          { method: "DELETE" },
        );
        if (resp.ok) {
          await loadThreads();
          setTabChatStates((prev) => {
            const cur = prev[currentTerminal];
            if (!cur || cur.conversationId !== threadId) return prev;
            return {
              ...prev,
              [currentTerminal]: { ...cur, conversationId: "", messages: [] },
            };
          });
        }
      } catch (e) {
        console.error("Error deleting conversation:", e);
      }
    },
    onArchive: async () => {},
    onUnarchive: async () => {},
  };

  // Runtime uses active tab state
  const runtime = useExternalStoreRuntime({
    messages,
    isRunning,
    isLoading: activeState.isLoading,
    adapters: { threadList },
    onNew: async (message: AppendMessage) => {
      if (message) await sendMessage(message);
    },
    onEdit: async () => {},
    onReload: async () => {},
    onCancel,
    onAddToolResult,
    convertMessage,
  });

  // helper: request title generation safely (idempotent per conversation)
  const requestTitleGeneration = useCallback(
    async (convoId: string) => {
      if (!convoId) return;
      // already requested or finished
      if (
        titleGenerationStatus[convoId] === "pending" ||
        titleGenerationStatus[convoId] === "done"
      )
        return;
      // mark pending
      setTitleGenerationStatus((prev) => ({ ...prev, [convoId]: "pending" }));
      try {
        const resp = await fetch(
          `http://wails.localhost:8088/api/conversations/${convoId}/generateTitle?selectedModel=${encodeURIComponent(selectedModel)}`,
        );
        if (resp.ok) {
          const data = await resp.json();
          const newTitle = data.title;
          setThreads((prev) =>
            prev.map((t) => (t.id === convoId ? { ...t, title: newTitle } : t)),
          );
        }
      } catch (e) {
        console.error("Failed to auto-generate title:", e);
      } finally {
        setTitleGenerationStatus((prev) => ({ ...prev, [convoId]: "done" }));
      }
    },
    [selectedModel, titleGenerationStatus],
  );

  // Auto-generate title: only on (isRunning true -> false) transition or initial loaded state without prior tracking.
  useEffect(() => {
    // build quick lookup of thread titles (allow undefined safely)
    const titleById: Record<string, string | undefined> = {};
    threads.forEach((t) => (titleById[t.id] = t.title));

    Object.values(tabChatStates).forEach((state) => {
      const convoId = state.conversationId;
      if (!convoId) return;
      const title = titleById[convoId];
      // skip if title already non-default
      if (title && !/^New Conversation/.test(title)) {
        if (prevRunningRef.current[convoId] === undefined) {
          prevRunningRef.current[convoId] = state.isRunning;
        }
        return;
      }
      if (state.messages.length < 2) {
        if (prevRunningRef.current[convoId] === undefined) {
          prevRunningRef.current[convoId] = state.isRunning;
        }
        return;
      }
      const prevRunning = prevRunningRef.current[convoId];
      // detect transition from running -> stopped (stream finished). Keep explicit comparison to avoid incorrect lint simplification.
      const transitionedToStopped =
        prevRunning === true && state.isRunning === false; // prev true -> current false
      const initialLoadedStopped =
        prevRunning === undefined && !state.isRunning; // first observation already stopped
      if (transitionedToStopped || initialLoadedStopped) {
        requestTitleGeneration(convoId);
      }
      prevRunningRef.current[convoId] = state.isRunning;
    });
  }, [tabChatStates, threads, requestTitleGeneration]);

  // Fetch models only when visible (unchanged)
  useEffect(() => {
    if (!visible) return;
    (async () => {
      try {
        const resp = await fetch("http://wails.localhost:8088/api/models");
        if (resp.ok) {
          const data = await resp.json();
          if (Array.isArray(data.data)) {
            const groups: Record<string, ModelConfig[]> = {};
            data.data.forEach((m: ModelConfig) => {
              if (!groups[m.provider]) groups[m.provider] = [];
              groups[m.provider].push(m);
            });
            setGroupedModelOptions(groups);
            if (data.data.length > 0 && !selectedModel)
              setSelectedModel(data.data[0].name);
          }
        }
      } catch (e) {
        console.error("Failed to fetch model list:", e);
      }
    })();
  }, [visible, selectedModel]);

  // When active tab changes, auto-select latest matching conversation (if state empty)
  useEffect(() => {
    ensureTabState(currentTerminal);
    setTabChatStates((prev) => {
      const cur = prev[currentTerminal];
      if (!cur) return prev;
      if (cur.conversationId) return prev; // already has conversation
      // find latest thread for this session id
      const matched = threads
        .filter((t) => t.assetSessionId === currentTerminal)
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      if (matched.length === 0) return prev;
      return {
        ...prev,
        [currentTerminal]: {
          ...cur,
          conversationId: matched[0].id,
          isLoading: false,
        },
      };
    });
  }, [currentTerminal, threads]);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="h-full flex flex-col">
        <ThreadList />
        <div className="flex-1 overflow-hidden">
          <Thread
            agentMode={agentMode}
            setAgentMode={setAgentMode}
            selectedModel={selectedModel}
            setSelectedModel={setSelectedModel}
            groupedModelOptions={groupedModelOptions}
            isLoading={activeState.isLoading} // use per-tab loading here
            availableTerminals={availableTerminals}
            selectedTerminals={selectedTerminals}
            currentTerminal={currentTerminal}
            onTerminalSelectionChange={setSelectedTerminals}
          />
        </div>
      </div>
    </AssistantRuntimeProvider>
  );
}


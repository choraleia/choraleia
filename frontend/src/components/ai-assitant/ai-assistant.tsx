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

export default function AiAssistant({
  tabs,
  activeTabKey,
  visible,
}: AIAssistantProps) {
  const [messages, setMessages] = useState<ThreadMessageLike[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [agentMode, setAgentMode] = useState<AgentMode>("tools");
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [selectedTerminals, setSelectedTerminals] = useState<string[]>([]);

  // Conversations state
  const [threads, setThreads] = useState<ExternalStoreThreadData<"regular">[]>(
    [],
  );
  // Conversation state (only current conversation id)
  const [currentConversationId, setCurrentConversationId] =
    useState<string>("");

  // Terminal related state
  const [availableTerminals, setAvailableTerminals] = useState<
    TerminalOption[]
  >([]);
  const [currentTerminal, setCurrentTerminal] = useState<string>("welcome");

  // Model configuration state
  const [groupedModelOptions, setGroupedModelOptions] = useState<
    Record<string, ModelConfig[]>
  >({});
  const sseRef = useRef<SSE | null>(null); // define sseRef

  // Sync terminal state when props update
  useEffect(() => {
    const terminals: TerminalOption[] = tabs
      .filter((tab: any) => tab.key !== "welcome")
      .map((tab: any) => ({
        key: tab.key,
        label: tab.label,
        isActive: true,
      }));

    setAvailableTerminals(terminals);

    const newCurrentTerminal =
      activeTabKey === "welcome" ? "welcome" : activeTabKey;
    setCurrentTerminal(newCurrentTerminal);
  }, [tabs, activeTabKey]);

  // Extract text from AppendMessage parts
  const extractTextFromAppendMessage = (msg: AppendMessage): string => {
    if (Array.isArray(msg.content)) {
      // Extract all text content
      return msg.content
        .filter((part) => part.type === "text")
        .map((part) =>
          part.text && typeof part.text === "string" ? part.text : "",
        )
        .join("");
    }
    return "";
  };

  // Send message; create new conversation only on first send
  const sendMessage = useCallback(
    async (msg: AppendMessage) => {
      const textContent = extractTextFromAppendMessage(msg);
      let messageId = uuidv4();
      let conversationId = currentConversationId;
      // If no conversation yet, create a new one first
      if (!conversationId) {
        let assetId = "default";
        if (currentTerminal !== "welcome") {
          const currentTab = tabs.find((tab) => tab.key === currentTerminal);
          if (currentTab && currentTab.assetId) {
            assetId = currentTab.assetId;
          }
        }
        try {
          const createResponse = await fetch(
            "http://wails.localhost:8088/api/conversations",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                title: "New Conversation",
                asset_id: assetId,
              }),
            },
          );
          if (createResponse.ok) {
            const conversation = await createResponse.json();
            await loadThreads(); // Refresh thread list first to ensure threadItems pool has new conversation
            setCurrentConversationId(conversation.id); // Then set current conversation id
            conversationId = conversation.id;
          } else {
            return;
          }
        } catch (error) {
          return;
        }
      }
      const userMessage: ChatMessage = {
        conversationId: conversationId,
        messageId: messageId,
        message: {
          role: RoleType.User,
          content: textContent,
        },
      };
      const threadMessage = convertChatMessageToThreadMessageLike(userMessage);
      setMessages((prev) => [...prev, threadMessage]);
      setIsRunning(true);
      if (sseRef.current) {
        sseRef.current.close();
        sseRef.current = null;
      }
      try {
        const params = new URLSearchParams({
          agentMode,
          selectedModel,
          currentTerminal,
          // send union of current active terminal + manually selected terminals (dedup)
          selectedTerminals: [currentTerminal, ...selectedTerminals.filter(t => t !== currentTerminal)].join(","),
        });
        const url = `http://wails.localhost:8088/api/chat?${params.toString()}`;
        const source = new SSE(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          payload: JSON.stringify(userMessage),
        });
        sseRef.current = source;
        source.addEventListener("connected", (event: any) => {
          console.log("SSE connected:", event.data);
        });
        source.addEventListener("message", (event: any) => {
          try {
            const chatMessage: ChatMessage = JSON.parse(event.data);
            const threadMessage =
              convertChatMessageToThreadMessageLike(chatMessage);
            setMessages((prevMessages) => {
              const idx = prevMessages.findIndex(
                (m) => m.id === threadMessage.id,
              );
              if (idx !== -1) {
                const newArr = [...prevMessages];
                const oldContent = Array.isArray(newArr[idx].content)
                  ? newArr[idx].content
                  : [];
                const newContent = Array.isArray(threadMessage.content)
                  ? threadMessage.content
                  : [];
                newArr[idx] = {
                  ...newArr[idx],
                  content: [...oldContent, ...newContent] as typeof oldContent,
                };
                return newArr;
              } else {
                return [...prevMessages, threadMessage];
              }
            });
          } catch (error) {
            console.error("Error parsing message data:", error);
          }
        });
        source.addEventListener("completed", (_event: any) => {
          setIsRunning(false);
          sseRef.current = null;
        });
        source.addEventListener("error", (event: any) => {
          console.error("SSE error:", event.data);
          let errorText = "❌ Sorry, an error occurred. Please try again later.";
          try {
            // Check model overdue error
            if (event.data) {
              const errorObj = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
              if (errorObj.error && typeof errorObj.error === "string") {
                // Extract nested JSON error
                const match = errorObj.error.match(/Error code: 403 - ({.*})/); // simplified regex
                if (match && match[1]) {
                  const innerError = JSON.parse(match[1]);
                  if (innerError.code === "AccountOverdueError") {
                    errorText = "Your model account is overdue. Please recharge and retry.";
                  }
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
          setMessages((prev) => [...prev, errorMessage]);
          source.close();
          sseRef.current = null;
          setIsRunning(false);
        });
      } catch (error) {
        console.error("Error sending message:", error);
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
        setMessages((prev) => [...prev, errorMessage]);
        setIsRunning(false);
      }
    },
    [
      currentConversationId,
      agentMode,
      selectedModel,
      selectedTerminals,
      currentTerminal,
      tabs,
    ],
  );

  // Ensure onCancel returns Promise<void>
  const onCancel = useCallback(async () => {
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }
    setIsRunning(false);
    console.log("Message generation stopped");
  }, []);

  // Tool invocation result merge handler
  const onAddToolResult = (options: AddToolResultOptions) => {
    console.log("Add tool result:", options);
    setMessages((prev) =>
      prev.map((message) => {
        if (message.id === options.messageId) {
          // Handle when message.content may be string
          if (Array.isArray(message.content)) {
            return {
              ...message,
              content: message.content.map((part) => {
                if (
                  part.type === "tool-call" &&
                  part.toolCallId === options.toolCallId
                ) {
                  return {
                    ...part,
                    result: options.result,
                  };
                }
                return part;
              }),
            };
          } else {
            return message;
          }
        }
        return message;
      }),
    );
  };

  const convertMessage = (message: ThreadMessageLike) => {
    // Merge adjacent same-type (reasoning or text) content
    if (!Array.isArray(message.content) || message.content.length === 0)
      return message;
    const mergedContent: typeof message.content = [];
    for (let i = 0; i < message.content.length; i++) {
      const curr = message.content[i];
      // If tool-call with result, merge into previous same toolCallId part
      if (
        curr.type === "tool-call" &&
        curr.result !== undefined &&
        curr.toolCallId
      ) {
        // Find previous part with same toolCallId
        const prevIdx = mergedContent.findIndex(
          (p) => p.type === "tool-call" && p.toolCallId === curr.toolCallId,
        );
        if (prevIdx !== -1) {
          // Update result field
          mergedContent[prevIdx] = {
            ...mergedContent[prevIdx],
            result: curr.result,
          };
          // Skip adding current part
          continue;
        }
      }
      // Merge adjacent same-type text/reasoning parts
      const prev =
        mergedContent.length > 0
          ? mergedContent[mergedContent.length - 1]
          : null;
      if (
        prev &&
        prev.type === curr.type &&
        (curr.type === "text" || curr.type === "reasoning")
      ) {
        mergedContent[mergedContent.length - 1] = {
          type: curr.type,
          text: (prev.text || "") + (curr.text || ""),
        };
      } else {
        mergedContent.push(curr);
      }
    }
    return { ...message, content: mergedContent };
  };

  // ChatMessage -> ThreadMessageLike converter
  const convertChatMessageToThreadMessageLike = (
    chatMessage: ChatMessage,
  ): ThreadMessageLike => {
    const { messageId, message } = chatMessage;
    let content: any[] = [];
    if (message.tool_calls != null && message.tool_calls!.length > 0) {
      content.push(
        ...message.tool_calls.map((toolCall) => {
          return {
            type: "tool-call",
            toolCallId: toolCall.id,
            toolName: toolCall.function.name,
            arguments: toolCall.function.arguments,
          };
        }),
      );
    } else if (
      message.role === RoleType.Tool &&
      message.tool_call_id != null &&
      message.tool_call_id !== ""
    ) {
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
        if (part.type === "text") {
          return { type: "text", text: part.text };
        } else if (part.type === "image_url") {
          return { type: "image_url", imageURL: part.imageURL };
        } else if (part.type === "audio_url") {
          return { type: "audio_url", audioURL: part.audioURL };
        } else if (part.type === "video_url") {
          return { type: "video_url", videoURL: part.videoURL };
        } else if (part.type === "file_url") {
          return { type: "file_url", fileURL: part.fileURL };
        } else {
          return { type: part.type, ...part };
        }
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
      role: message.role as "user" | "assistant" | "system",
      content,
      createdAt: new Date(),
      metadata: { custom: message.extra || {} },
    };
  };

  // Load conversation list
  const loadThreads = useCallback(async () => {
    setIsLoading(true);
    try {
      let assetId = "";
      if (currentTerminal !== "welcome") {
        const currentTab = tabs.find((tab) => tab.key === currentTerminal);
        if (currentTab && currentTab.assetId) {
          assetId = currentTab.assetId;
        }
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
        }));
        setThreads(threadListData);
      }
    } catch (e) {
      console.error("Failed to load threads:", e);
    } finally {
      setIsLoading(false);
    }
  }, [currentTerminal, tabs]);

  // Auto load conversation list on mount
  useEffect(() => {
    loadThreads().then(() => {
      console.log("Loaded threads on mount.");
    });
  }, [loadThreads]);

  // Load conversation messages
  const loadMessages = useCallback(async (conversationId: string) => {
    try {
      const resp = await fetch(
        `http://wails.localhost:8088/api/conversations/${conversationId}/messages`,
      );
      if (resp.ok) {
        const data = await resp.json();
        return (data || []).map((msg: any) => ({
          id: msg.id || `msg_${Date.now()}_${Math.random()}`,
          role: msg.role as "user" | "assistant",
          content: msg.content,
          createdAt: new Date(msg.created_at || Date.now()),
          metadata: { custom: {} },
        }));
      }
    } catch (e) {
      console.error("Failed to load messages:", e);
    }
    return [];
  }, []);

  const threadList: ExternalStoreThreadListAdapter = {
    threadId: currentConversationId,
    isLoading: isLoading,
    threads: threads,
    onSwitchToNewThread: async () => {
      console.log("onSwitchToNewThread");
      let assetId = "default";
      if (currentTerminal !== "welcome") {
        const currentTab = tabs.find((tab) => tab.key === currentTerminal);
        if (currentTab && currentTab.assetId) {
          assetId = currentTab.assetId;
        }
      }
      const createResponse = await fetch(
        "http://wails.localhost:8088/api/conversations",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title: "New Conversation",
            asset_id: assetId,
          }),
        },
      );
      if (createResponse.ok) {
        await loadThreads();
        const conversation = await createResponse.json();
        setCurrentConversationId(conversation.id);
        setMessages([]);
      }
    },
    onSwitchToThread: async (threadId: string) => {
      console.log("onSwitchToThread");
      setIsLoading(true);
      try {
        setCurrentConversationId(threadId);
        const msgs = await loadMessages(threadId);
        setMessages(msgs);
      } finally {
        setIsLoading(false);
      }
    },
    onRename: async (threadId: string, newTitle: string) => {
      console.log("onRename");
      await fetch(
        `http://wails.localhost:8088/api/conversations/${threadId}/title`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ title: newTitle }),
        },
      );
      await loadThreads();
    },
    onDelete: async (threadId: string) => {
      console.log("onDelete");
      try {
        const resp = await fetch(
          `http://wails.localhost:8088/api/conversations/${threadId}`,
          {
            method: "DELETE",
          },
        );
        if (resp.ok) {
          await loadThreads();
          if (threadId === currentConversationId) {
            setMessages([]);
            setCurrentConversationId("");
          }
        }
      } catch (err) {
        console.error("Error deleting conversation:", err);
      }
    },
    onArchive: async (threadId: string) => {
      console.log("Archive", threadId);
    },
    onUnarchive: async (threadId: string) => {
      console.log("Unarchive", threadId);
    },
  };

  // Create AssistantUI runtime using ThreadMessageLike
  const runtime = useExternalStoreRuntime({
    messages: messages,
    isRunning,
    isLoading,
    adapters: {
      threadList,
    },
    onNew: async (message: AppendMessage) => {
      if (message) {
        await sendMessage(message);
      }
    },
    onEdit: async (message: AppendMessage) => {
      console.log("Edit message:", message);
    },
    onReload: async (parentId: string | null) => {
      console.log("Reload from parent:", parentId);
    },
    onCancel, // type matched
    onAddToolResult,
    convertMessage,
  });

  // Auto-generate title and refresh thread list and current thread title
  const autoGenerateTitle = useCallback(
    async (conversationId: string) => {
      if (!conversationId) return;
      try {
        const resp = await fetch(
          `http://wails.localhost:8088/api/conversations/${conversationId}/generateTitle?selectedModel=${encodeURIComponent(selectedModel)}`,
        );
        if (resp.ok) {
          const data = await resp.json();
          const newTitle = data.title;
          // Immediately update current thread title
          setThreads((prevThreads) =>
            prevThreads.map((t) =>
              t.id === conversationId ? { ...t, title: newTitle } : t,
            ),
          );
        }
      } catch (e) {
        console.error("Failed to auto-generate title:", e);
      }
    },
    [loadThreads, selectedModel],
  );

  // Listen for SSE completion; after first reply auto-generate title
  useEffect(() => {
    if (!isRunning && currentConversationId && messages.length > 1) {
      const currentThread = threads.find((t) => t.id === currentConversationId);
      if (
        currentThread &&
        (currentThread.title === "New Conversation" ||
          !currentThread.title ||
          /^New Conversation/.test(currentThread.title))
      ) {
        autoGenerateTitle(currentConversationId);
      }
    }
  }, [isRunning, currentConversationId, threads, autoGenerateTitle, messages]);

  // Fetch model list only when visible
  useEffect(() => {
    if (!visible) return;
    async function fetchModels() {
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
            if (data.data.length > 0) setSelectedModel(data.data[0].name);
          }
        }
      } catch (e) {
        console.error("Failed to fetch model list:", e);
      }
    }
    fetchModels();
  }, [visible]);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="h-full flex flex-col">
        {/* Conversation management area */}
        <ThreadList />

        {/* Chat interface */}
        <div className="flex-1 overflow-hidden">
          <Thread
            agentMode={agentMode}
            setAgentMode={setAgentMode}
            selectedModel={selectedModel}
            setSelectedModel={setSelectedModel}
            groupedModelOptions={groupedModelOptions}
            isLoading={isLoading}
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



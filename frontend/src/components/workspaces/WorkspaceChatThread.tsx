// WorkspaceChatThread - Thread component for workspace chat using MUI
import * as React from "react";
import { FC } from "react";
import {
  ActionBarPrimitive,
  BranchPickerPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
} from "@assistant-ui/react";
import {
  Box,
  Paper,
  Select,
  MenuItem,
  FormControl,
  Stack,
  IconButton,
  Typography,
  Tooltip,
  CircularProgress,
} from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import StopIcon from "@mui/icons-material/Stop";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import CheckIcon from "@mui/icons-material/Check";
import EditIcon from "@mui/icons-material/Edit";
import RefreshIcon from "@mui/icons-material/Refresh";
import KeyboardArrowLeftIcon from "@mui/icons-material/KeyboardArrowLeft";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import BuildIcon from "@mui/icons-material/Build";
import { MarkdownText } from "../ai-assitant/markdown-text";
import { ReasoningContent } from "../ai-assitant/reasoning-content";
import { ToolFallback } from "../ai-assitant/tool-fallback";

// Model config type
export interface ModelConfig {
  id: string;
  provider: string;
  model_type: string;
  model: string;
  name: string;
  base_url: string;
  api_key: string;
  extra: Record<string, any>;
}

// Agent mode type
export type AgentMode = "tools" | "react";

interface WorkspaceChatThreadProps {
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  groupedModelOptions: Record<string, ModelConfig[]>;
  isLoading: boolean;
  agentMode: AgentMode;
  setAgentMode: (mode: AgentMode) => void;
}

export const WorkspaceChatThread: FC<WorkspaceChatThreadProps> = ({
  selectedModel,
  setSelectedModel,
  groupedModelOptions,
  isLoading,
  agentMode,
  setAgentMode,
}) => {
  const isDisabled = isLoading;

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        alignItems: "center",
      }}
    >
      {/* Single centered container for all chat content */}
      <Box
        sx={{
          width: "100%",
          maxWidth: 960,
          height: "100%",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <ThreadPrimitive.Root
          style={{
            display: "flex",
            flexDirection: "column",
            height: "100%",
            overflow: "hidden",
          }}
        >
          {/* Chat messages area */}
          <ThreadPrimitive.Viewport
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "16px",
            }}
          >
            <ThreadPrimitive.Messages
              components={{
                UserMessage: UserMessage,
                EditComposer: EditComposer,
                AssistantMessage: AssistantMessage,
              }}
            />

            <ThreadPrimitive.If empty={false}>
              <Box sx={{ minHeight: 32, flexGrow: 1 }} />
            </ThreadPrimitive.If>
          </ThreadPrimitive.Viewport>

          {/* Bottom control bar */}
          <Box
            sx={{
              flexShrink: 0,
            }}
          >
            {isLoading && (
              <Box sx={{ px: 2, py: 1, textAlign: "center" }}>
                <Stack direction="row" spacing={1} alignItems="center" justifyContent="center">
                  <CircularProgress size={14} />
                  <Typography variant="caption" color="text.secondary">
                    Initializing...
                  </Typography>
                </Stack>
              </Box>
            )}

            {/* Composer */}
            <Composer disabled={isDisabled} />

            {/* Bottom toolbar: Model selector + Agent mode + Send button */}
            <BottomToolbar
              selectedModel={selectedModel}
              setSelectedModel={setSelectedModel}
              groupedModelOptions={groupedModelOptions}
              agentMode={agentMode}
              setAgentMode={setAgentMode}
              isLoading={isLoading}
              disabled={isDisabled}
            />
          </Box>
        </ThreadPrimitive.Root>
      </Box>
    </Box>
  );
};

// Bottom toolbar component
const BottomToolbar: FC<{
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  groupedModelOptions: Record<string, ModelConfig[]>;
  agentMode: AgentMode;
  setAgentMode: (mode: AgentMode) => void;
  isLoading: boolean;
  disabled: boolean;
}> = ({
  selectedModel,
  setSelectedModel,
  groupedModelOptions,
  agentMode,
  setAgentMode,
  isLoading,
  disabled,
}) => {
  // Build model menu items
  const modelMenuItems: React.ReactNode[] = [];
  Object.entries(groupedModelOptions).forEach(([provider, models]) => {
    modelMenuItems.push(
      <MenuItem key={`provider-${provider}`} disabled divider sx={{ fontSize: 12, fontWeight: 600 }}>
        {provider}
      </MenuItem>,
    );
    models.forEach((m) => {
      const modelTypeLabel = m.model_type ? ` (${m.model_type})` : "";
      modelMenuItems.push(
        <MenuItem key={m.name} value={m.name} sx={{ fontSize: 13 }}>
          {m.name}
          {modelTypeLabel}
        </MenuItem>,
      );
    });
  });

  return (
    <Box sx={{ px: 2, py: 1 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          {/* Agent mode selector (first) */}
          <FormControl size="small" disabled={isLoading || disabled} sx={{ minWidth: 100 }}>
            <Select
              value={agentMode}
              onChange={(e) => setAgentMode(e.target.value as AgentMode)}
              displayEmpty
              sx={{ fontSize: 13 }}
              renderValue={(value) => (
                <Stack direction="row" alignItems="center" spacing={0.5}>
                  {value === "tools" ? (
                    <BuildIcon sx={{ fontSize: 16 }} />
                  ) : (
                    <SmartToyIcon sx={{ fontSize: 16 }} />
                  )}
                  <span>{value === "tools" ? "Tools" : "ReAct"}</span>
                </Stack>
              )}
            >
              <MenuItem value="tools">
                <Stack direction="row" alignItems="center" spacing={1}>
                  <BuildIcon sx={{ fontSize: 16 }} />
                  <span>Tools</span>
                </Stack>
              </MenuItem>
              <MenuItem value="react">
                <Stack direction="row" alignItems="center" spacing={1}>
                  <SmartToyIcon sx={{ fontSize: 16 }} />
                  <span>ReAct</span>
                </Stack>
              </MenuItem>
            </Select>
          </FormControl>

          {/* Model selector (second) */}
          <FormControl size="small" disabled={isLoading || disabled} sx={{ minWidth: 150 }}>
            <Select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              displayEmpty
              sx={{ fontSize: 13 }}
              MenuProps={{
                PaperProps: { sx: { maxHeight: 300 } },
              }}
              renderValue={(value) => value || "Select Model"}
            >
              {modelMenuItems.length === 0 && (
                <MenuItem value="" disabled>
                  No models available
                </MenuItem>
              )}
              {modelMenuItems}
            </Select>
          </FormControl>
        </Stack>

        {/* Send/Cancel button */}
        <ComposerAction disabled={disabled} />
      </Stack>
    </Box>
  );
};

// Composer component
const Composer: FC<{ disabled?: boolean }> = ({ disabled }) => {
  return (
    <Box sx={{ px: 2, pt: 2 }}>
      <ComposerPrimitive.Root>
        <Paper
          variant="outlined"
          sx={{
            p: 1,
            display: "flex",
            alignItems: "flex-end",
            "&:focus-within": {
              borderColor: "primary.main",
            },
          }}
        >
          <Box sx={{ flex: 1, maxHeight: 160, overflow: "auto" }}>
            <ComposerPrimitive.Input
              placeholder="Write a message..."
              disabled={disabled}
              style={{
                width: "100%",
                border: "none",
                outline: "none",
                resize: "none",
                background: "transparent",
                fontSize: 14,
                lineHeight: 1.5,
                padding: "8px",
              }}
            />
          </Box>
        </Paper>
      </ComposerPrimitive.Root>
    </Box>
  );
};

// Composer action (send/cancel button)
const ComposerAction: FC<{ disabled?: boolean }> = ({ disabled }) => {
  return (
    <>
      <ThreadPrimitive.If running={false}>
        <ComposerPrimitive.Send asChild>
          <Tooltip title="Send">
            <span>
              <IconButton
                color="primary"
                disabled={disabled}
                sx={{
                  bgcolor: "primary.main",
                  color: "primary.contrastText",
                  "&:hover": { bgcolor: "primary.dark" },
                  "&:disabled": { bgcolor: "action.disabledBackground" },
                }}
              >
                <SendIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </ComposerPrimitive.Send>
      </ThreadPrimitive.If>
      <ThreadPrimitive.If running>
        <ComposerPrimitive.Cancel asChild>
          <Tooltip title="Cancel">
            <IconButton
              color="error"
              disabled={disabled}
              sx={{
                bgcolor: "error.main",
                color: "error.contrastText",
                "&:hover": { bgcolor: "error.dark" },
              }}
            >
              <StopIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </ComposerPrimitive.Cancel>
      </ThreadPrimitive.If>
    </>
  );
};

// User message component
const UserMessage: FC = () => {
  return (
    <MessagePrimitive.Root>
      <Box
        sx={{
          display: "flex",
          justifyContent: "flex-end",
          mb: 2,
        }}
      >
        <Box sx={{ maxWidth: "80%" }}>
          {/* Action bar */}
          <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 0.5, opacity: 0.6, "&:hover": { opacity: 1 } }}>
            <ActionBarPrimitive.Root>
              <ActionBarPrimitive.Edit asChild>
                <Tooltip title="Edit">
                  <IconButton size="small">
                    <EditIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
              </ActionBarPrimitive.Edit>
            </ActionBarPrimitive.Root>
          </Box>

          {/* Message content */}
          <Paper
            elevation={0}
            sx={{
              p: 1.5,
              bgcolor: "primary.main",
              color: "primary.contrastText",
              borderRadius: 2,
              borderTopRightRadius: 4,
            }}
          >
            <MessagePrimitive.Parts components={{ Text: UserMessageText }} />
          </Paper>

          {/* Branch picker */}
          <BranchPicker />
        </Box>
      </Box>
    </MessagePrimitive.Root>
  );
};

// User message text
const UserMessageText: FC<{ text: string }> = ({ text }) => {
  return (
    <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
      {text}
    </Typography>
  );
};

// Edit composer
const EditComposer: FC = () => {
  return (
    <ComposerPrimitive.Root>
      <Paper variant="outlined" sx={{ p: 2, my: 2 }}>
        <ComposerPrimitive.Input
          style={{
            width: "100%",
            border: "none",
            outline: "none",
            resize: "none",
            background: "transparent",
            fontSize: 14,
          }}
        />
        <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 2 }}>
          <ComposerPrimitive.Cancel asChild>
            <IconButton size="small">Cancel</IconButton>
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send asChild>
            <IconButton size="small" color="primary">Send</IconButton>
          </ComposerPrimitive.Send>
        </Stack>
      </Paper>
    </ComposerPrimitive.Root>
  );
};

// Assistant message component
const AssistantMessage: FC = () => {
  return (
    <MessagePrimitive.Root>
      <Box
        sx={{
          display: "flex",
          justifyContent: "flex-start",
          mb: 2,
        }}
      >
        <Box sx={{ maxWidth: "80%" }}>
          {/* Message content */}
          <Paper
            elevation={0}
            sx={{
              p: 1.5,
              bgcolor: "action.hover",
              borderRadius: 2,
              borderTopLeftRadius: 4,
            }}
          >
            <MessagePrimitive.Parts
              components={{
                Text: MarkdownText,
                Reasoning: ReasoningContent,
                tools: {
                  Fallback: ToolFallback,
                },
              }}
            />
          </Paper>

          {/* Action bar */}
          <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, opacity: 0.6, "&:hover": { opacity: 1 } }}>
            <ActionBarPrimitive.Root>
              <ActionBarPrimitive.Copy asChild>
                <Tooltip title="Copy">
                  <IconButton size="small">
                    <MessagePrimitive.If copied>
                      <CheckIcon sx={{ fontSize: 16 }} color="success" />
                    </MessagePrimitive.If>
                    <MessagePrimitive.If copied={false}>
                      <ContentCopyIcon sx={{ fontSize: 16 }} />
                    </MessagePrimitive.If>
                  </IconButton>
                </Tooltip>
              </ActionBarPrimitive.Copy>
              <ActionBarPrimitive.Reload asChild>
                <Tooltip title="Regenerate">
                  <IconButton size="small">
                    <RefreshIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
              </ActionBarPrimitive.Reload>
            </ActionBarPrimitive.Root>
          </Stack>

          {/* Branch picker */}
          <BranchPicker />
        </Box>
      </Box>
    </MessagePrimitive.Root>
  );
};

// Branch picker component
const BranchPicker: FC = () => {
  return (
    <BranchPickerPrimitive.Root hideWhenSingleBranch>
      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mt: 0.5 }}>
        <BranchPickerPrimitive.Previous asChild>
          <IconButton size="small">
            <KeyboardArrowLeftIcon fontSize="small" />
          </IconButton>
        </BranchPickerPrimitive.Previous>
        <Typography variant="caption" color="text.secondary">
          <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
        </Typography>
        <BranchPickerPrimitive.Next asChild>
          <IconButton size="small">
            <KeyboardArrowRightIcon fontSize="small" />
          </IconButton>
        </BranchPickerPrimitive.Next>
      </Stack>
    </BranchPickerPrimitive.Root>
  );
};

export default WorkspaceChatThread;


// WorkspaceChatThread - Thread component for workspace chat using MUI
import * as React from "react";
import { FC } from "react";
import {
  ActionBarPrimitive,
  BranchPickerPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useMessage,
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
import { MarkdownText } from "./chat/markdown-text";
import { ReasoningContent } from "./chat/reasoning-content";
import { ToolFallback } from "./chat/tool-fallback";

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

// WorkspaceAgent for agent selection
export interface WorkspaceAgentOption {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
}

interface WorkspaceChatThreadProps {
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  groupedModelOptions: Record<string, ModelConfig[]>;
  isLoading: boolean;
  selectedAgentId: string;
  setSelectedAgentId: (id: string) => void;
  workspaceAgents: WorkspaceAgentOption[];
}

export const WorkspaceChatThread: FC<WorkspaceChatThreadProps> = ({
  selectedModel,
  setSelectedModel,
  groupedModelOptions,
  isLoading,
  selectedAgentId,
  setSelectedAgentId,
  workspaceAgents,
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
          {/* Chat messages area - wrapped with padding so scrollbar aligns with input box */}
          <Box sx={{ flex: 1, minHeight: 0, px: "10px" }}>
            <ThreadPrimitive.Viewport
              style={{
                height: "100%",
                overflowY: "auto",
              }}
            >
              <Box sx={{ py: 2 }}>
                <ThreadPrimitive.Messages
                  components={{
                    UserMessage: UserMessage,
                    EditComposer: EditComposer,
                    AssistantMessage: AssistantMessage,
                  }}
                />
              </Box>

              <ThreadPrimitive.If empty={false}>
                <Box sx={{ minHeight: 0, flexGrow: 1 }} />
              </ThreadPrimitive.If>
            </ThreadPrimitive.Viewport>
          </Box>

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

            {/* Composer with embedded toolbar */}
            <ComposerWithToolbar
              selectedModel={selectedModel}
              setSelectedModel={setSelectedModel}
              groupedModelOptions={groupedModelOptions}
              selectedAgentId={selectedAgentId}
              setSelectedAgentId={setSelectedAgentId}
              workspaceAgents={workspaceAgents}
              isLoading={isLoading}
              disabled={isDisabled}
            />
          </Box>
        </ThreadPrimitive.Root>
      </Box>
    </Box>
  );
};

// Bottom toolbar component - now embedded in composer
interface ComposerWithToolbarProps {
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  groupedModelOptions: Record<string, ModelConfig[]>;
  selectedAgentId: string;
  setSelectedAgentId: (id: string) => void;
  workspaceAgents: WorkspaceAgentOption[];
  isLoading: boolean;
  disabled: boolean;
}

const ComposerWithToolbar: FC<ComposerWithToolbarProps> = ({
  selectedModel,
  setSelectedModel,
  groupedModelOptions,
  selectedAgentId,
  setSelectedAgentId,
  workspaceAgents,
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
    <Box sx={{ px: "10px", py: 1.5 }}>
      <ComposerPrimitive.Root>
        <Paper
          variant="outlined"
          sx={{
            display: "flex",
            flexDirection: "column",
            "&:focus-within": {
              borderColor: "primary.main",
            },
          }}
        >
          {/* Input area */}
          <Box
            sx={{
              overflow: "auto",
              px: 1.5,
              pt: 1.5,
              pb: 0.5,
            }}
          >
            <ComposerPrimitive.Input
              placeholder="Write a message..."
              disabled={disabled}
              maxRows={5}
              style={{
                width: "100%",
                border: "none",
                outline: "none",
                resize: "none",
                background: "transparent",
                fontSize: 14,
                lineHeight: 1.5,
              }}
            />
          </Box>

          {/* Embedded toolbar */}
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              px: 1,
              py: 0.5,
              borderTop: 1,
              borderColor: "divider",
            }}
          >
            <Stack direction="row" spacing={0.5} alignItems="center">
              {/* Agent selector */}
              <Select
                size="small"
                value={selectedAgentId}
                onChange={(e) => setSelectedAgentId(e.target.value)}
                disabled={isLoading || disabled}
                variant="standard"
                disableUnderline
                displayEmpty
                sx={{
                  fontSize: 12,
                  minWidth: 80,
                  "& .MuiSelect-select": {
                    py: 0.25,
                    px: 0.5,
                    display: "flex",
                    alignItems: "center",
                    gap: 0.5,
                    fontSize: 12,
                  },
                }}
                renderValue={(value) => {
                  const agent = workspaceAgents.find(a => a.id === value);
                  return (
                    <Stack direction="row" alignItems="center" spacing={0.5}>
                      <SmartToyIcon sx={{ fontSize: 14 }} />
                      <Typography sx={{ fontSize: 12 }}>{agent?.name || "default"}</Typography>
                    </Stack>
                  );
                }}
              >
                <MenuItem value="" sx={{ fontSize: 12 }}>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <SmartToyIcon sx={{ fontSize: 14 }} />
                    <span>default</span>
                  </Stack>
                </MenuItem>
                {workspaceAgents.filter(a => a.enabled).map((agent) => (
                  <MenuItem key={agent.id} value={agent.id} sx={{ fontSize: 12 }}>
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <SmartToyIcon sx={{ fontSize: 14 }} />
                      <Box>
                        <Typography sx={{ fontSize: 12 }}>{agent.name}</Typography>
                        {agent.description && (
                          <Typography sx={{ fontSize: 10, color: "text.secondary" }}>{agent.description}</Typography>
                        )}
                      </Box>
                    </Stack>
                  </MenuItem>
                ))}
              </Select>

              {/* Model selector */}
              <Select
                size="small"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                disabled={isLoading || disabled}
                displayEmpty
                variant="standard"
                disableUnderline
                sx={{
                  fontSize: 12,
                  minWidth: 80,
                  maxWidth: 180,
                  "& .MuiSelect-select": {
                    py: 0.25,
                    px: 0.5,
                    fontSize: 12,
                  },
                }}
                MenuProps={{
                  PaperProps: { sx: { maxHeight: 300 } },
                }}
                renderValue={(value) => (
                  <Typography sx={{ fontSize: 12 }} noWrap>
                    {value || "Select Model"}
                  </Typography>
                )}
              >
                {modelMenuItems.length === 0 && (
                  <MenuItem value="" disabled sx={{ fontSize: 12 }}>
                    No models available
                  </MenuItem>
                )}
                {modelMenuItems}
              </Select>
            </Stack>

            {/* Send/Cancel button - smaller */}
            <Box>
              <ThreadPrimitive.If running={false}>
                <ComposerPrimitive.Send asChild>
                  <Tooltip title="Send">
                    <span>
                      <IconButton
                        size="small"
                        color="primary"
                        disabled={disabled}
                        sx={{
                          p: 0.5,
                          bgcolor: "primary.main",
                          color: "primary.contrastText",
                          "&:hover": { bgcolor: "primary.dark" },
                          "&:disabled": { bgcolor: "action.disabledBackground" },
                        }}
                      >
                        <SendIcon sx={{ fontSize: 14 }} />
                      </IconButton>
                    </span>
                  </Tooltip>
                </ComposerPrimitive.Send>
              </ThreadPrimitive.If>
              <ThreadPrimitive.If running>
                <ComposerPrimitive.Cancel asChild>
                  <Tooltip title="Cancel">
                    <IconButton
                      size="small"
                      color="error"
                      disabled={disabled}
                      sx={{
                        p: 0.5,
                        bgcolor: "error.main",
                        color: "error.contrastText",
                        "&:hover": { bgcolor: "error.dark" },
                      }}
                    >
                      <StopIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                  </Tooltip>
                </ComposerPrimitive.Cancel>
              </ThreadPrimitive.If>
            </Box>
          </Box>
        </Paper>
      </ComposerPrimitive.Root>
    </Box>
  );
};

// Composer component - deprecated, kept for reference
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

// Composer action (send/cancel button) - deprecated, kept for reference
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
          width: "100%",
          mb: 2,
        }}
      >
        <Box sx={{ maxWidth: "100%" }}>
          {/* Message content */}
          <Paper
            elevation={0}
            sx={{
              p: 1.5,
              bgcolor: "primary.main",
              color: "primary.contrastText",
              borderRadius: 2,
              width: "fit-content",
              maxWidth: "100%",
              ml: "auto",
            }}
          >
            <MessagePrimitive.Parts components={{ Text: UserMessageText }} />
          </Paper>

          {/* Action bar */}
          <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, justifyContent: "flex-end", opacity: 0.6, "&:hover": { opacity: 1 } }}>
            <ActionBarPrimitive.Root>
              <ActionBarPrimitive.Edit asChild>
                <Tooltip title="Edit">
                  <IconButton size="small">
                    <EditIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
              </ActionBarPrimitive.Edit>
            </ActionBarPrimitive.Root>
          </Stack>

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
  const message = useMessage();
  const agentName = (message?.metadata?.custom as any)?.agentName;

  return (
    <MessagePrimitive.Root>
      <Box
        sx={{
          display: "flex",
          justifyContent: "flex-start",
          width: "100%",
          mb: 2,
        }}
      >
        <Box sx={{ maxWidth: "100%", minWidth: 0, overflow: "hidden" }}>
          {/* Agent name badge */}
          {agentName && (
            <Typography
              variant="caption"
              sx={{
                display: "inline-flex",
                alignItems: "center",
                gap: 0.5,
                mb: 0.5,
                px: 1,
                py: 0.25,
                bgcolor: "primary.main",
                color: "primary.contrastText",
                borderRadius: 1,
                fontSize: 11,
                fontWeight: 500,
              }}
            >
              <SmartToyIcon sx={{ fontSize: 12 }} />
              {agentName}
            </Typography>
          )}
          {/* Message content */}
          <Paper
            elevation={0}
            sx={{
              p: 1.5,
              bgcolor: (theme) => theme.palette.mode === "light" ? "#f5f5f5" : "rgba(255,255,255,0.08)",
              borderRadius: 2,
              width: "fit-content",
              maxWidth: "100%",
              overflow: "hidden",
              wordBreak: "break-word",
              overflowWrap: "anywhere",
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


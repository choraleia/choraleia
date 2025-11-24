import * as React from "react";
import {
  ActionBarPrimitive,
  BranchPickerPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
} from "@assistant-ui/react";
import type { FC, PropsWithChildren } from "react";
import { useState } from "react";
import {
  ArrowDownIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  CopyIcon,
  PencilIcon,
  RefreshCwIcon,
  SendHorizontalIcon,
  AddIcon,
  ComputerIcon,
  CloseIcon,
} from "./assistant-icons.tsx";
import { cn } from "./lib/utils.ts";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import FormControl from "@mui/material/FormControl";
import Chip from "@mui/material/Chip";
import Menu from "@mui/material/Menu";
import Stack from "@mui/material/Stack";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import { Button as ShadButton } from "./ui/button.tsx"; // custom button for ghost variant

// import { Button } from "./ui/button.tsx";
import { TooltipIconButton } from "./tooltip-icon-button.tsx";
import { ToolFallback } from "./tool-fallback.tsx";
import { ReasoningContent } from "./reasoning-content.tsx";
import { MarkdownText } from "./markdown-text.tsx";
import type { ModelConfig } from "./ai-assistant.tsx";

// Agent mode type
type AgentMode = "tools" | "react";

// Terminal option type
interface TerminalOption {
  key: string;
  label: string;
  isActive: boolean;
}

interface ThreadProps {
  agentMode: AgentMode;
  setAgentMode: (mode: AgentMode) => void;
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  groupedModelOptions: Record<string, ModelConfig[]>; // grouped model options by provider
  isLoading: boolean;
  availableTerminals: TerminalOption[];
  selectedTerminals: string[];
  currentTerminal: string;
  onTerminalSelectionChange: (selectedTerminals: string[]) => void;
}

export const Thread: FC<ThreadProps> = ({
  agentMode,
  setAgentMode,
  selectedModel,
  setSelectedModel,
  groupedModelOptions,
  isLoading,
  availableTerminals,
  selectedTerminals,
  currentTerminal,
  onTerminalSelectionChange,
}) => {
  // Compute disabled state: loading or conversation not ready
  const isDisabled = isLoading;

  return (
    <ThreadPrimitive.Root
      className="text-foreground bg-background box-border flex h-full flex-col overflow-hidden"
      style={{
        height: "100%",
        minHeight: "100%",
      }}
    >
      {/* Chat messages area - takes main space */}
      <ThreadPrimitive.Viewport className="flex-1 flex flex-col items-center overflow-y-scroll scroll-smooth bg-inherit px-4 pt-8">
        {/*<ThreadWelcome />*/}

        <ThreadPrimitive.Messages
          components={{
            UserMessage: UserMessage,
            EditComposer: EditComposer,
            AssistantMessage: AssistantMessage,
          }}
        />

        <ThreadPrimitive.If empty={false}>
          <div className="min-h-8 flex-grow" />
        </ThreadPrimitive.If>

        <ThreadScrollToBottom />
      </ThreadPrimitive.Viewport>

      {/* Bottom control bar - fixed at bottom */}
      <div className="flex-shrink-0 w-full bg-background border-t border-gray-200 dark:border-gray-700 relative z-50">
        {/* Loading hint while conversation initializing */}
        {isLoading && (
          <div className="px-3 py-2 text-center">
            <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center justify-center gap-2">
              <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                <circle
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                  fill="none"
                  opacity="0.25"
                />
                <path
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  opacity="0.75"
                />
              </svg>
              Initializing conversation...
            </div>
          </div>
        )}

        <div className="w-full mx-auto">
          {/* Terminal selector - only shown when terminals available */}
          {availableTerminals.length > 0 && (
            <TerminalSelector
              availableTerminals={availableTerminals}
              selectedTerminals={selectedTerminals}
              currentTerminal={currentTerminal}
              onSelectionChange={onTerminalSelectionChange}
              disabled={isDisabled}
            />
          )}

          {/* Chat input composer */}
          <Composer disabled={isDisabled} />

          {/* Agent mode & model selector */}
          <AgentModeSelector
            agentMode={agentMode}
            setAgentMode={setAgentMode}
            selectedModel={selectedModel}
            setSelectedModel={setSelectedModel}
            groupedModelOptions={groupedModelOptions}
            isLoading={isLoading}
            disabled={isDisabled}
          />
        </div>
      </div>
    </ThreadPrimitive.Root>
  );
};

// Agent mode & model selector component
const AgentModeSelector: FC<{
  agentMode: AgentMode;
  setAgentMode: (mode: AgentMode) => void;
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  groupedModelOptions: Record<string, ModelConfig[]>;
  isLoading: boolean;
  disabled: boolean;
}> = ({
  agentMode,
  setAgentMode,
  selectedModel,
  setSelectedModel,
  groupedModelOptions,
  isLoading,
  disabled,
}) => {
  const modelMenuItems: React.ReactElement[] = [];
  Object.entries(groupedModelOptions).forEach(([provider, models]) => {
    modelMenuItems.push(
      <MenuItem key={`provider-${provider}`} disabled divider>
        {provider}
      </MenuItem>,
    );
    models.forEach((m) => {
      modelMenuItems.push(
        <MenuItem key={m.name} value={m.name}>
          {m.name}
        </MenuItem>,
      );
    });
  });
  return (
    <Box px={2} py={1} width="100%">
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        width="100%"
      >
        <Stack direction="row" spacing={2} alignItems="center">
          <FormControl
            size="small"
            disabled={isLoading || disabled}
            sx={{ width: "auto", minWidth: 0, flexShrink: 0 }}
          >
            {/*<InputLabel id="agent-mode-label">Mode</InputLabel>*/}
            <Select
              labelId="agent-mode-label"
              id="agent-mode"
              value={agentMode}
              placeholder="Mode"
              onChange={(e) => setAgentMode(e.target.value as AgentMode)}
              size="small"
              autoWidth
              sx={{ width: "auto" }}
              MenuProps={{
                MenuListProps: { dense: true },
                sx: {
                  "& .MuiMenuItem-root": {
                    minHeight: 16,
                  },
                },
              }}
            >
              <MenuItem value="tools">Tool</MenuItem>
              <MenuItem value="react">ReAct</MenuItem>
            </Select>
          </FormControl>
          <FormControl
            size="small"
            disabled={isLoading || disabled}
            sx={{ width: "auto", minWidth: 0, flexShrink: 0 }}
          >
            {/*<InputLabel id="model-select-label">Model</InputLabel>*/}
            <Select
              labelId="model-select-label"
              id="model-select"
              value={selectedModel}
              placeholder="Model"
              onChange={(e) => setSelectedModel(e.target.value)}
              size="small"
              autoWidth
              sx={{ width: "auto" }}
              MenuProps={{
                MenuListProps: { dense: true },
                sx: {
                  "& .MuiMenuItem-root": {
                    minHeight: 16,
                  },
                },
              }}
            >
              {modelMenuItems.length === 0 && (
                <MenuItem value="" disabled>
                  No models
                </MenuItem>
              )}
              {modelMenuItems}
            </Select>
          </FormControl>
        </Stack>
        <ComposerAction disabled={disabled} />
      </Stack>
    </Box>
  );
};

const ThreadScrollToBottom: FC = () => {
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <TooltipIconButton
        tooltip="Scroll to bottom"
        variant="outline"
        className="absolute -top-8 rounded-full disabled:invisible"
      >
        <ArrowDownIcon />
      </TooltipIconButton>
    </ThreadPrimitive.ScrollToBottom>
  );
};

// const ThreadWelcome: FC = () => {
//   return (
//     <ThreadPrimitive.Empty>
//       <div className="flex w-full max-w-[var(--thread-max-width)] flex-grow flex-col">
//         <div className="flex w-full flex-grow flex-col items-center justify-center">
//           <p className="mt-4 font-medium">How can I help you today?</p>
//         </div>
//         <ThreadWelcomeSuggestions />
//       </div>
//     </ThreadPrimitive.Empty>
//   );
// };
//
// const ThreadWelcomeSuggestions: FC = () => {
//   return (
//     <div className="mt-3 flex w-full items-stretch justify-center gap-4">
//       <ThreadPrimitive.Suggestion
//         className="hover:bg-muted/80 flex max-w-sm grow basis-0 flex-col items-center justify-center rounded-lg border p-3 transition-colors ease-in"
//         prompt="What is the weather in Tokyo?"
//         method="replace"
//         autoSend
//       >
//         <span className="line-clamp-2 text-ellipsis text-sm font-semibold">
//           What is the weather in Tokyo?
//         </span>
//       </ThreadPrimitive.Suggestion>
//       <ThreadPrimitive.Suggestion
//         className="hover:bg-muted/80 flex max-w-sm grow basis-0 flex-col items-center justify-center rounded-lg border p-3 transition-colors ease-in"
//         prompt="What is assistant-ui?"
//         method="replace"
//         autoSend
//       >
//         <span className="line-clamp-2 text-ellipsis text-sm font-semibold">
//           What is assistant-ui?
//         </span>
//       </ThreadPrimitive.Suggestion>
//     </div>
//   );
// };

const Composer: FC<{ disabled?: boolean }> = ({ disabled }) => {
  return (
    <div className="px-3 pt-2">
      <ComposerPrimitive.Root className="focus-within:border-ring/20 flex w-full flex-wrap items-end rounded-lg border bg-inherit px-2.5 shadow-sm transition-colors ease-in">
        <ComposerPrimitive.Input
          rows={1}
          autoFocus
          placeholder="Write a message..."
          className="placeholder:text-muted-foreground max-h-40 flex-grow resize-none border-none bg-transparent px-2 py-4 text-sm outline-none focus:ring-0 disabled:cursor-not-allowed"
          disabled={disabled}
        />
        {/* Send button moved outside */}
      </ComposerPrimitive.Root>
    </div>
  );
};

const ComposerAction: FC<{ disabled?: boolean }> = ({ disabled }) => {
  return (
    <>
      <ThreadPrimitive.If running={false}>
        <ComposerPrimitive.Send asChild>
          <TooltipIconButton
            tooltip="Send"
            variant="default"
            className="my-2.5 size-8 p-2 transition-opacity ease-in"
            disabled={disabled}
          >
            <SendHorizontalIcon />
          </TooltipIconButton>
        </ComposerPrimitive.Send>
      </ThreadPrimitive.If>
      <ThreadPrimitive.If running>
        <ComposerPrimitive.Cancel asChild>
          <TooltipIconButton
            tooltip="Cancel"
            variant="default"
            className="my-2.5 size-8 p-2 transition-opacity ease-in"
            disabled={disabled}
          >
            <CircleStopIcon />
          </TooltipIconButton>
        </ComposerPrimitive.Cancel>
      </ThreadPrimitive.If>
    </>
  );
};

const UserMessage: FC = () => {
  return (
    <MessagePrimitive.Root className="grid w-full auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] gap-y-2 py-4 [&:where(>*)]:col-start-2">
      <UserActionBar />

      <Paper
        elevation={0}
        className="col-start-2 row-start-2 break-words"
        sx={(theme) => ({
          backgroundColor:
            theme.palette.mode === "light"
              ? "#fafafa"
              : theme.palette.background.paper,
          padding: "4px 12px",
          boxShadow: "none",
          border: `1px solid ${theme.palette.divider}`,
          borderRadius: 2,
        })}
      >
        <MessagePrimitive.Parts components={{ Text: MarkdownText }} />
      </Paper>

      <BranchPicker className="col-span-full col-start-1 row-start-3 -mr-1 justify-end" />
    </MessagePrimitive.Root>
  );
};

const UserActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="col-start-1 row-start-2 mr-3 mt-2.5 flex flex-col items-end"
    >
      <ActionBarPrimitive.Edit asChild>
        <TooltipIconButton tooltip="Edit">
          <PencilIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  );
};

const EditComposer: FC = () => {
  return (
    <ComposerPrimitive.Root className="bg-muted my-4 flex w-full flex-col gap-2 rounded-xl">
      <ComposerPrimitive.Input className="text-foreground flex h-8 w-full resize-none bg-transparent p-4 pb-0 outline-none" />

      <div className="mx-3 mb-3 flex items-center justify-center gap-2 self-end">
        <ComposerPrimitive.Cancel asChild>
          <ShadButton variant="ghost">Cancel</ShadButton>
        </ComposerPrimitive.Cancel>
        <ComposerPrimitive.Send asChild>
          <ShadButton>Send</ShadButton>
        </ComposerPrimitive.Send>
      </div>
    </ComposerPrimitive.Root>
  );
};

// Custom Group component for parent ID grouping
const ParentIdGroup: FC<
  PropsWithChildren<{ groupKey: string | undefined; indices: number[] }>
> = ({ groupKey, indices, children }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);

  if (!groupKey) {
    // Ungrouped parts - just render them directly
    return <>{children}</>;
  }

  return (
    <div className="border-border/50 bg-muted/20 my-2 overflow-hidden rounded-lg border">
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="hover:bg-muted/40 flex w-full items-center justify-between px-4 py-2 text-sm font-medium transition-colors"
      >
        <span className="flex items-center gap-2">
          <span className="text-muted-foreground">Research Group:</span>
          <span className="text-foreground">
            {groupKey === "research-climate-causes" && "Climate Change Causes"}
            {groupKey === "research-climate-effects" &&
              "Climate Change Effects"}
            {groupKey === "new-research" && "Recent Research"}
            {![
              "research-climate-causes",
              "research-climate-effects",
              "new-research",
            ].includes(groupKey) && groupKey}
          </span>
          <span className="text-muted-foreground text-xs">
            ({indices.length} parts)
          </span>
        </span>
        {isCollapsed ? (
          <ChevronDownIcon className="h-4 w-4" />
        ) : (
          <ChevronUpIcon className="h-4 w-4" />
        )}
      </button>
      {!isCollapsed && <div className="space-y-2 px-4 py-2">{children}</div>}
    </div>
  );
};

const AssistantMessage: FC = () => {
  return (
    <MessagePrimitive.Root className="relative grid w-full max-w-[var(--thread-max-width)] grid-cols-[auto_auto_1fr] grid-rows-[auto_1fr] py-4">
      <Paper
        className="col-span-2 col-start-2 row-start-1 my-1.5 max-w-[calc(var(--thread-max-width)*0.8)] break-words"
        elevation={0}
        sx={(theme) => ({
          backgroundColor:
            theme.palette.mode === "light"
              ? "#fafafa"
              : theme.palette.background.paper,
          padding: "4px 12px",
          boxShadow: "none",
          border: `1px solid ${theme.palette.divider}`,
          borderRadius: 2,
        })}
      >
        <MessagePrimitive.Unstable_PartsGroupedByParentId
          components={{
            Text: MarkdownText,
            Group: ParentIdGroup,
            Reasoning: ReasoningContent,
            Source: ({ url, title }) => (
              <div className="text-muted-foreground text-sm">
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline"
                >
                  📄 {title || url}
                </a>
              </div>
            ),
            tools: {
              Fallback: ToolFallback,
            },
          }}
        />
      </Paper>

      <AssistantActionBar />

      <BranchPicker className="col-start-2 row-start-2 -ml-2 mr-2" />
    </MessagePrimitive.Root>
  );
};

const AssistantActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      autohideFloat="single-branch"
      className="text-muted-foreground data-[floating]:bg-background col-start-3 row-start-2 -ml-1 flex gap-1 data-[floating]:absolute data-[floating]:rounded-md data-[floating]:border data-[floating]:p-1 data-[floating]:shadow-sm"
    >
      <ActionBarPrimitive.Copy asChild>
        <TooltipIconButton tooltip="Copy">
          <MessagePrimitive.If copied>
            <CheckIcon />
          </MessagePrimitive.If>
          <MessagePrimitive.If copied={false}>
            <CopyIcon />
          </MessagePrimitive.If>
        </TooltipIconButton>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Reload asChild>
        <TooltipIconButton tooltip="Refresh">
          <RefreshCwIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Reload>
    </ActionBarPrimitive.Root>
  );
};

const BranchPicker: FC<BranchPickerPrimitive.Root.Props> = ({
  className,
  ...rest
}) => {
  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className={cn(
        "text-muted-foreground inline-flex items-center text-xs",
        className,
      )}
      {...rest}
    >
      <BranchPickerPrimitive.Previous asChild>
        <TooltipIconButton tooltip="Previous">
          <ChevronLeftIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Previous>
      <span className="font-medium">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next asChild>
        <TooltipIconButton tooltip="Next">
          <ChevronRightIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
};

const CircleStopIcon = () => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      width="16"
      height="16"
    >
      <rect width="10" height="10" x="3" y="3" rx="2" />
    </svg>
  );
};

// Terminal selector component
const TerminalSelector: FC<{
  availableTerminals: TerminalOption[];
  selectedTerminals: string[]; // NOTE: now represents ONLY manually added terminals (does NOT auto-include currentTerminal)
  currentTerminal: string;
  onSelectionChange: (selectedTerminals: string[]) => void;
  disabled: boolean;
}> = ({
  availableTerminals,
  selectedTerminals,
  currentTerminal,
  onSelectionChange,
  disabled,
}) => {
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const open = Boolean(menuAnchor);

  // Removed previous auto-add effect. We now derive display list = currentTerminal + manual selections.
  // This matches requirement: selectedTerminals only hold manually added terminals; current active always shown separately.

  const currentTerminalInfo = availableTerminals.find(
    (t) => t.key === currentTerminal,
  );
  // Manual selections excluding current (avoid duplicate chip when manually added same as current)
  const otherSelectedTerminals = selectedTerminals.filter(
    (key) => key !== currentTerminal,
  );
  // Available terminals that can still be added (exclude current and already manually selected)
  const otherAvailableTerminals = availableTerminals.filter(
    (t) => t.key !== currentTerminal && !selectedTerminals.includes(t.key),
  );

  const addTerminal = (terminalKey: string) => {
    // Add only if not already manually selected
    const next = selectedTerminals.includes(terminalKey)
      ? selectedTerminals
      : [...selectedTerminals, terminalKey];
    onSelectionChange(next);
    setMenuAnchor(null);
  };
  const removeTerminal = (terminalKey: string) => {
    // Can't remove current implicit terminal; only manual selections
    if (terminalKey === currentTerminal) return;
    onSelectionChange(selectedTerminals.filter((k) => k !== terminalKey));
  };

  return (
    <Box px={2} pt={1}>
      <Stack
        direction="row"
        flexWrap="wrap"
        gap={1}
        alignItems="center"
        minHeight={24}
      >
        {currentTerminalInfo && (
          <Chip
            size="small"
            icon={<ComputerIcon />}
            label={`${currentTerminalInfo.label} (current)`}
            color="default"
            variant="outlined"
            disabled={disabled}
            sx={(theme) => ({
              borderRadius: 1,
              backgroundColor: "transparent",
              borderColor: theme.palette.divider,
              color: theme.palette.text.primary,
              fontWeight: 600,
            })}
          />
        )}
        {otherSelectedTerminals.map((terminalKey) => {
          const terminal = availableTerminals.find(
            (t) => t.key === terminalKey,
          );
          if (!terminal) return null;
          return (
            <Chip
              key={terminalKey}
              size="small"
              icon={<ComputerIcon />}
              label={terminal.label}
              color="default"
              variant="outlined"
              onDelete={() => removeTerminal(terminalKey)}
              disabled={disabled}
              deleteIcon={<CloseIcon />}
              sx={(theme) => ({
                borderRadius: 1,
                backgroundColor: "transparent",
                borderColor: theme.palette.divider,
                color: theme.palette.text.primary,
                fontWeight: 600,
              })}
            />
          );
        })}
        {otherAvailableTerminals.length > 0 && (
          <IconButton
            size="small"
            aria-label="Add Terminal"
            disabled={disabled}
            onClick={(e) => setMenuAnchor(e.currentTarget)}
            sx={(theme) => ({
              border: `1px solid ${theme.palette.divider}`,
              width: 26,
              height: 26,
              borderRadius: 1,
              p: 0,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            })}
          >
            <AddIcon />
          </IconButton>
        )}
      </Stack>
      <Menu
        anchorEl={menuAnchor}
        open={open}
        onClose={() => setMenuAnchor(null)}
        MenuListProps={{ dense: true }}
      >
        {otherAvailableTerminals.map((terminal) => (
          <MenuItem
            key={terminal.key}
            onClick={() => addTerminal(terminal.key)}
            disabled={disabled}
          >
            {terminal.label}
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
};

import React, { useState, useCallback, useEffect, useRef } from "react";
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  MarkerType,
  NodeProps,
  Handle,
  Position,
  BackgroundVariant,
  Viewport,
  updateEdge,
} from "reactflow";
import "reactflow/dist/style.css";
import {
  Box,
  Paper,
  Typography,
  IconButton,
  Tooltip,
  Chip,
  Button,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  TextField,
  FormControl,
  Select,
  Switch,
  FormControlLabel,
  CircularProgress,
  List,
  ListItemButton,
  Divider,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import CloseIcon from "@mui/icons-material/Close";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import LinearScaleIcon from "@mui/icons-material/LinearScale";
import CallSplitIcon from "@mui/icons-material/CallSplit";
import LoopIcon from "@mui/icons-material/Loop";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import BuildIcon from "@mui/icons-material/Build";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import EditIcon from "@mui/icons-material/Edit";
import SaveIcon from "@mui/icons-material/Save";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import MarkdownEditDialog from "./MarkdownEditDialog";
import {
  ToolConfig,
} from "../../state/workspaces";
import { getApiBase } from "../../api/base";
import {
  Agent,
  AgentType,
  AGENT_TYPE_INFO,
  DeepAgentTypeConfig,
  PlanExecuteAgentTypeConfig,
  PlanExecuteSubAgentConfig,
  LoopAgentTypeConfig,
  WorkspaceAgent,
  WorkspaceAgentNode,
  WorkspaceAgentEdge,
  listWorkspaceAgents,
  createWorkspaceAgent,
  updateWorkspaceAgent,
  deleteWorkspaceAgent,
} from "../../api/workspaces";

// =====================================
// Constants
// =====================================

const AGENT_TYPE_ICONS: Record<AgentType, React.ReactNode> = {
  chat_model: <SmartToyIcon fontSize="small" />,
  supervisor: <AccountTreeIcon fontSize="small" />,
  deep: <AccountTreeIcon fontSize="small" />,
  plan_execute: <LinearScaleIcon fontSize="small" />,
  sequential: <LinearScaleIcon fontSize="small" />,
  loop: <LoopIcon fontSize="small" />,
  parallel: <CallSplitIcon fontSize="small" />,
};

const AGENT_TYPE_COLORS: Record<AgentType, string> = {
  chat_model: "#4f46e5",
  supervisor: "#0ea5e9",
  deep: "#8b5cf6",
  plan_execute: "#f59e0b",
  sequential: "#10b981",
  loop: "#ec4899",
  parallel: "#06b6d4",
};

// =====================================
// Connection Rules (based on ADK SetSubAgents)
// =====================================

// Which agent types can have sub-agents (call SetSubAgents or transfer_to_agent)
// - PlanExecute has fixed internal structure (Planner→Executor→Replanner), cannot have external sub-agents
const canHaveSubAgents = (type: AgentType): boolean => type !== "plan_execute";

// All agent types can be nested as sub-agents of other agents
// Even Supervisor can be nested (e.g., Sequential can contain a Supervisor step)
const canBeNestedSubAgent = (_type: AgentType): boolean => true;

// All agent types can receive input (from Start node or from parent agents)
const canReceiveInput = (_type: AgentType): boolean => true;

// Which agent types require sub-agents to function
const requiresSubAgents = (type: AgentType): boolean =>
  ["supervisor", "sequential", "parallel", "loop"].includes(type);

// Get edge style based on source agent type (reflects ADK behavior)
const getEdgeStyle = (sourceType: AgentType): { stroke: string; animated: boolean; label: string } => {
  switch (sourceType) {
    case "supervisor":
    case "chat_model":
      // transfer_to_agent: one-way transfer, control moves to target agent and doesn't return
      return { stroke: "#0ea5e9", animated: false, label: "transfer" };
    case "deep":
      // task tool: calls sub-agent as a tool, returns result to Deep agent
      return { stroke: "#8b5cf6", animated: true, label: "task" };
    case "sequential":
      // workflow: sequential execution
      return { stroke: "#10b981", animated: false, label: "sequence" };
    case "parallel":
      // workflow: parallel execution
      return { stroke: "#06b6d4", animated: false, label: "parallel" };
    case "loop":
      // workflow: loop execution
      return { stroke: "#ec4899", animated: false, label: "loop" };
    default:
      return { stroke: "#8b5cf6", animated: false, label: "" };
  }
};

// =====================================
// Custom Node Component
// =====================================

interface AgentNodeData {
  agent: Agent;
  tools: ToolConfig[];
  allAgents: Agent[];
  edges?: Edge[]; // Canvas edges to compute sub-agents
  allNodes?: Node[]; // All nodes to map edge targets to agents
  models?: Array<{ id: string; name: string; model: string; provider: string }>; // Available models
}

const AgentNode: React.FC<NodeProps<AgentNodeData>> = ({ id, data, selected }) => {
  const { agent, tools, edges = [], allNodes = [], models = [] } = data;

  // Handle case when agent is undefined
  if (!agent) {
    return (
      <Box sx={{
        p: 1,
        border: "1px dashed #ccc",
        borderRadius: 1,
        bgcolor: "#f5f5f5",
        minWidth: 150
      }}>
        <Typography variant="caption" color="text.secondary">
          Agent not configured
        </Typography>
        <Handle type="target" position={Position.Left} style={{ background: "#ccc" }} />
        <Handle type="source" position={Position.Right} style={{ background: "#ccc" }} />
      </Box>
    );
  }

  const typeInfo = AGENT_TYPE_INFO[agent.type];
  const color = AGENT_TYPE_COLORS[agent.type];
  const connectedTools = tools.filter((t) => agent.toolIds?.includes(t.name));
  const needsSubAgents = requiresSubAgents(agent.type);

  // Get configured model name
  const configuredModel = agent.modelName ? models.find(m => m.model === agent.modelName && (!agent.modelProvider || m.provider === agent.modelProvider)) : null;

  // Compute sub-agents from canvas edges (edges where this node is the source)
  const connectedSubAgents = edges
    .filter(e => e.source === id && e.target !== "start")
    .map(e => {
      const targetNode = allNodes.find(n => n.id === e.target);
      if (targetNode?.type === "agent") {
        const targetAgentData = targetNode.data as AgentNodeData;
        return targetAgentData?.agent;
      }
      return null;
    })
    .filter(Boolean) as Agent[];

  const hasSubAgents = connectedSubAgents.length > 0;
  const showWarning = needsSubAgents && !hasSubAgents;

  // Get sub-agent names (use connected sub-agents from edges)
  const subAgentNames = connectedSubAgents.map(a => a.name);

  return (
    <Paper
      elevation={selected ? 8 : 2}
      sx={{
        minWidth: 180,
        borderRadius: 2,
        border: "2px solid",
        borderColor: selected ? color : showWarning ? "warning.main" : "divider",
        bgcolor: "background.paper",
        opacity: agent.enabled === false ? 0.6 : 1,
        position: "relative",
      }}
    >
      {/* Warning indicator */}
      {showWarning && (
        <Tooltip title={`${typeInfo.label} requires at least one sub-agent`}>
          <Box
            sx={{
              position: "absolute",
              top: -8,
              left: -8,
              width: 18,
              height: 18,
              borderRadius: "50%",
              bgcolor: "warning.main",
              color: "white",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12,
              fontWeight: "bold",
              zIndex: 10,
            }}
          >
            !
          </Box>
        </Tooltip>
      )}

      {/* Input Handle (left) - Circle shape, blue color */}
      {canReceiveInput(agent.type) && (
        <Handle
          type="target"
          position={Position.Left}
          id="left"
          style={{
            width: 12,
            height: 12,
            background: "#3b82f6",
            border: "2px solid white",
            borderRadius: "50%",
          }}
        />
      )}

      {/* Input Handle (top) - Circle shape, blue color */}
      {canReceiveInput(agent.type) && (
        <Handle
          type="target"
          position={Position.Top}
          id="top"
          style={{
            width: 12,
            height: 12,
            background: "#3b82f6",
            border: "2px solid white",
            borderRadius: "50%",
          }}
        />
      )}

      {/* Output Handle (right) - Diamond shape, orange color */}
      {canHaveSubAgents(agent.type) && (
        <Handle
          type="source"
          position={Position.Right}
          id="right"
          style={{
            width: 12,
            height: 12,
            background: "#f97316",
            border: "2px solid white",
            borderRadius: "2px",
            transform: "rotate(45deg)",
          }}
        />
      )}

      {/* Output Handle (bottom) - Diamond shape, orange color */}
      {canHaveSubAgents(agent.type) && (
        <Handle
          type="source"
          position={Position.Bottom}
          id="bottom"
          style={{
            width: 12,
            height: 12,
            background: "#f97316",
            border: "2px solid white",
            borderRadius: "2px",
            transform: "rotate(45deg)",
          }}
        />
      )}

      {/* Header */}
      <Box
        sx={{
          px: 1.5,
          py: 0.75,
          bgcolor: color,
          color: "white",
          borderRadius: "6px 6px 0 0",
          display: "flex",
          alignItems: "center",
          gap: 0.5,
        }}
      >
        {AGENT_TYPE_ICONS[agent.type]}
        <Typography variant="body2" fontWeight={600} noWrap sx={{ flex: 1 }}>
          {agent.name}
        </Typography>
        {agent.enabled === false && (
          <Chip label="OFF" size="small" sx={{ height: 16, fontSize: "0.6rem", bgcolor: "rgba(255,255,255,0.3)" }} />
        )}
      </Box>

      {/* Body */}
      <Box sx={{ p: 1, minHeight: 40 }}>
        <Typography variant="caption" color="text.secondary" display="block">
          {typeInfo?.label}
        </Typography>
        {agent.description && (
          <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: 160, display: "block" }}>
            {agent.description}
          </Typography>
        )}

        {/* Configured Model - only for model-based agents */}
        {!["sequential", "parallel", "loop"].includes(agent.type) && configuredModel && (
          <Box sx={{ mt: 0.5, display: "flex", alignItems: "center", gap: 0.5 }}>
            <SmartToyIcon sx={{ fontSize: 12, color: "text.secondary" }} />
            <Typography
              variant="caption"
              noWrap
              sx={{
                fontSize: "0.65rem",
                color: "text.secondary",
                maxWidth: 140,
              }}
            >
              {configuredModel.name}
            </Typography>
          </Box>
        )}

        {/* Connected Tools */}
        {connectedTools.length > 0 && (
          <Box sx={{ mt: 0.5, display: "flex", flexWrap: "wrap", gap: 0.25 }}>
            {connectedTools.slice(0, 2).map((tool) => (
              <Chip
                key={tool.id}
                label={tool.name}
                size="small"
                icon={<BuildIcon sx={{ fontSize: 10 }} />}
                sx={{ height: 18, fontSize: "0.6rem" }}
              />
            ))}
            {connectedTools.length > 2 && (
              <Chip label={`+${connectedTools.length - 2}`} size="small" sx={{ height: 18, fontSize: "0.6rem" }} />
            )}
          </Box>
        )}

        {/* Sub-agents - show full list with order for sequential/loop */}
        {subAgentNames.length > 0 && (
          <Box sx={{ mt: 0.5 }}>
            <Typography variant="caption" color="text.disabled" sx={{ fontSize: "0.6rem" }}>
              Sub-agents ({subAgentNames.length})
              {["sequential", "loop"].includes(agent.type) && " • ordered"}
            </Typography>
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                gap: 0.25,
                mt: 0.25,
                maxHeight: 80,
                overflowY: "auto",
                "&::-webkit-scrollbar": { width: 4 },
                "&::-webkit-scrollbar-thumb": { bgcolor: "divider", borderRadius: 2 },
              }}
            >
              {subAgentNames.map((name, idx) => (
                <Box
                  key={idx}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 0.5,
                    px: 0.5,
                    py: 0.25,
                    bgcolor: "action.hover",
                    borderRadius: 0.5,
                    fontSize: "0.65rem",
                  }}
                >
                  {["sequential", "loop"].includes(agent.type) ? (
                    <Box
                      sx={{
                        width: 14,
                        height: 14,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        bgcolor: AGENT_TYPE_COLORS[agent.type],
                        color: "white",
                        borderRadius: "50%",
                        fontSize: "0.55rem",
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {idx + 1}
                    </Box>
                  ) : (
                    <AccountTreeIcon sx={{ fontSize: 10, color: "text.secondary", flexShrink: 0 }} />
                  )}
                  <Typography
                    variant="caption"
                    noWrap
                    sx={{ fontSize: "0.65rem", flex: 1, minWidth: 0 }}
                  >
                    {name}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Box>
        )}
      </Box>
    </Paper>
  );
};

// Start Node Component
const StartNode: React.FC<NodeProps> = () => (
  <Box
    sx={{
      width: 60,
      height: 36,
      borderRadius: "18px",
      bgcolor: "#22c55e",
      color: "white",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontWeight: 600,
      fontSize: 11,
      boxShadow: 2,
    }}
  >
    <PlayArrowIcon sx={{ fontSize: 16, mr: 0.25 }} />
    Start
    {/* Output Handle - Diamond shape, matches other output handles */}
    <Handle
      type="source"
      position={Position.Right}
      style={{
        width: 10,
        height: 10,
        background: "#f97316",
        border: "2px solid white",
        borderRadius: "2px",
        transform: "rotate(45deg)",
      }}
    />
  </Box>
);

// Legend Component - explains connection types based on ADK semantics
const Legend: React.FC = () => (
  <Paper
    sx={{
      position: "absolute",
      bottom: 10,
      right: 10,
      p: 1,
      zIndex: 10,
      fontSize: 11,
      bgcolor: "rgba(255,255,255,0.95)",
    }}
    elevation={2}
  >
    {/* Handle Types */}
    <Typography variant="caption" fontWeight={600} display="block" mb={0.5}>
      Handle Types
    </Typography>
    <Box display="flex" gap={2} mb={1}>
      <Box display="flex" alignItems="center" gap={0.5}>
        <Box sx={{
          width: 10,
          height: 10,
          bgcolor: "#3b82f6",
          borderRadius: "50%",
          border: "1px solid white",
          boxShadow: "0 0 0 1px #3b82f6",
        }} />
        <Typography variant="caption">Input</Typography>
      </Box>
      <Box display="flex" alignItems="center" gap={0.5}>
        <Box sx={{
          width: 10,
          height: 10,
          bgcolor: "#f97316",
          borderRadius: "2px",
          transform: "rotate(45deg)",
          border: "1px solid white",
          boxShadow: "0 0 0 1px #f97316",
        }} />
        <Typography variant="caption">Output</Typography>
      </Box>
    </Box>

    {/* Connection Types */}
    <Typography variant="caption" fontWeight={600} display="block" mb={0.5}>
      Connection Types
    </Typography>
    <Box display="flex" flexDirection="column" gap={0.25}>
      <Box display="flex" alignItems="center" gap={0.5}>
        <Box sx={{ width: 20, height: 2, bgcolor: "#22c55e", borderStyle: "dashed", borderWidth: 1 }} />
        <Typography variant="caption">Entry point</Typography>
      </Box>
      <Box display="flex" alignItems="center" gap={0.5}>
        <Box sx={{ width: 20, height: 2, bgcolor: "#0ea5e9" }} />
        <Typography variant="caption">Transfer (one-way)</Typography>
      </Box>
      <Box display="flex" alignItems="center" gap={0.5}>
        <Box sx={{ width: 20, height: 2, bgcolor: "#8b5cf6" }} />
        <Typography variant="caption">Task (Deep agent)</Typography>
      </Box>
      <Box display="flex" alignItems="center" gap={0.5}>
        <Box sx={{ width: 20, height: 2, bgcolor: "#10b981" }} />
        <Typography variant="caption">Sequential</Typography>
      </Box>
      <Box display="flex" alignItems="center" gap={0.5}>
        <Box sx={{ width: 20, height: 2, bgcolor: "#06b6d4" }} />
        <Typography variant="caption">Parallel</Typography>
      </Box>
      <Box display="flex" alignItems="center" gap={0.5}>
        <Box sx={{ width: 20, height: 2, bgcolor: "#ec4899" }} />
        <Typography variant="caption">Loop</Typography>
      </Box>
    </Box>
  </Paper>
);

// Node types registration
const nodeTypes = {
  agent: AgentNode,
  start: StartNode,
};

// =====================================
// Edit Dialog
// =====================================

// =====================================
// Agent Config Panel (Right Sidebar)
// =====================================

interface AgentPanelProps {
  agent: Agent | null;
  nodeId: string | null; // The node ID of the agent being edited
  allAgents: Agent[];
  tools: ToolConfig[];
  models: Array<{ id: string; name: string; model: string; provider: string }>;
  loadingModels: boolean;
  edges: Edge[];
  nodes: Node[];
  onClose: () => void;
  onSave: (agent: Agent) => void;
  onDelete: (id: string) => void;
  onReorderEdges: (nodeId: string, newEdgeOrder: string[]) => void; // Callback to reorder edges
}

const AgentPanel: React.FC<AgentPanelProps> = ({
  agent,
  nodeId,
  allAgents,
  tools,
  models,
  loadingModels,
  edges,
  nodes,
  onClose,
  onSave,
  onDelete,
  onReorderEdges,
}) => {
  const [editedAgent, setEditedAgent] = useState<Agent | null>(null);
  const [panelWidth, setPanelWidth] = useState(380);
  const [isResizing, setIsResizing] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(380);

  // Markdown edit dialog state
  const [descriptionDialogOpen, setDescriptionDialogOpen] = useState(false);
  const [instructionDialogOpen, setInstructionDialogOpen] = useState(false);

  useEffect(() => {
    if (agent) setEditedAgent({ ...agent });
    else setEditedAgent(null);
  }, [agent]);

  // Handle resize - fixed to prevent jump
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    startXRef.current = e.clientX;
    startWidthRef.current = panelWidth;
    setIsResizing(true);
  }, [panelWidth]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const deltaX = startXRef.current - e.clientX;
      const newWidth = startWidthRef.current + deltaX;
      setPanelWidth(Math.max(300, Math.min(600, newWidth)));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing]);

  // Return null when no agent is selected - canvas will take full space
  if (!editedAgent || !nodeId) {
    return null;
  }

  // Get sub-agent info from canvas edges (edges where this node is the source)
  const outgoingEdges = edges.filter(e => e.source === nodeId && e.target !== "start");
  const subAgentInfos = outgoingEdges
    .map(edge => {
      const targetNode = nodes.find(n => n.id === edge.target);
      if (targetNode?.type === "agent") {
        const targetAgentData = targetNode.data as AgentNodeData;
        const a = targetAgentData?.agent;
        if (a) {
          return { id: a.id, name: a.name, type: a.type, edgeId: edge.id, nodeId: targetNode.id };
        }
      }
      return null;
    })
    .filter(Boolean) as Array<{ id: string; name: string; type: AgentType; edgeId: string; nodeId: string }>;

  // Check if order matters for this agent type
  const orderMatters = ["sequential", "loop"].includes(editedAgent.type);

  const handleChange = (field: keyof Agent, value: any) => {
    const updated = { ...editedAgent, [field]: value };
    setEditedAgent(updated);
    // Auto-save on change
    onSave(updated);
  };

  const handleToolToggle = (toolName: string) => {
    const current = editedAgent.toolIds || [];
    const newTools = current.includes(toolName)
      ? current.filter((name) => name !== toolName)
      : [...current, toolName];
    handleChange("toolIds", newTools);
  };

  // Handle type-specific config changes
  const handleTypeConfigChange = (field: string, value: any) => {
    const currentTypeConfig = editedAgent.typeConfig || { type: editedAgent.type };
    const updatedTypeConfig = { ...currentTypeConfig, [field]: value };
    handleChange("typeConfig", updatedTypeConfig);
  };

  // Handle sub-agent reordering by reordering edges
  const handleMoveSubAgent = (index: number, direction: "up" | "down") => {
    if (!nodeId) return;
    const edgeIds = subAgentInfos.map(info => info.edgeId);
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= edgeIds.length) return;
    // Swap edge positions
    [edgeIds[index], edgeIds[newIndex]] = [edgeIds[newIndex], edgeIds[index]];
    onReorderEdges(nodeId, edgeIds);
  };

  const typeInfo = AGENT_TYPE_INFO[editedAgent.type];
  const color = AGENT_TYPE_COLORS[editedAgent.type];

  return (
    <Box
      sx={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        width: panelWidth,
        bgcolor: "background.paper",
        boxShadow: "-4px 0 12px rgba(0,0,0,0.1)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        zIndex: 10,
      }}
    >
      {/* Resize Handle */}
      <Box
        onMouseDown={handleMouseDown}
        sx={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 4,
          cursor: "ew-resize",
          bgcolor: isResizing ? "primary.main" : "transparent",
          "&:hover": { bgcolor: "primary.light" },
          zIndex: 20,
        }}
      />
      {/* Header */}
      <Box
        sx={{
          p: 1.5,
          bgcolor: color,
          color: "white",
          display: "flex",
          alignItems: "center",
          gap: 1,
        }}
      >
        {AGENT_TYPE_ICONS[editedAgent.type]}
        <Typography variant="subtitle2" fontWeight={600} flex={1} noWrap>
          {editedAgent.name}
        </Typography>
        <IconButton size="small" sx={{ color: "white" }} onClick={onClose}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>

      {/* Content */}
      <Box sx={{ flex: 1, overflow: "auto", p: 2 }}>
        <Box display="flex" flexDirection="column" gap={2}>
          {/* Basic Info */}
          <TextField
            placeholder="Name"
            size="small"
            fullWidth
            value={editedAgent.name}
            onChange={(e) => handleChange("name", e.target.value)}
          />

          <Box>
            <Typography variant="caption" color="text.secondary" mb={0.5} display="block">
              Type
            </Typography>
            <Chip
              icon={AGENT_TYPE_ICONS[editedAgent.type] as React.ReactElement}
              label={typeInfo?.label}
              size="small"
              sx={{ bgcolor: `${color}20`, color: color, fontWeight: 500 }}
            />
          </Box>

          <Box sx={{ position: "relative" }}>
            <TextField
              placeholder="Description"
              size="small"
              fullWidth
              multiline
              minRows={2}
              value={editedAgent.description || ""}
              onChange={(e) => handleChange("description", e.target.value)}
              InputProps={{
                endAdornment: (
                  <IconButton
                    size="small"
                    onClick={() => setDescriptionDialogOpen(true)}
                    sx={{ position: "absolute", right: 8, top: 8 }}
                  >
                    <OpenInNewIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                ),
              }}
            />
          </Box>

          {/* Model Selection - Not for workflow types */}
          {!["sequential", "parallel", "loop"].includes(editedAgent.type) && (
            <FormControl size="small" fullWidth>
              <Typography variant="caption" color="text.secondary" mb={0.5}>
                Model
              </Typography>
              <Select
                value={editedAgent.modelName ? `${editedAgent.modelName}|${editedAgent.modelProvider || ""}` : ""}
                onChange={(e) => {
                  const value = e.target.value;
                  let updated: Agent;
                  if (!value) {
                    updated = { ...editedAgent, modelName: undefined, modelProvider: undefined };
                  } else {
                    const [model, provider] = value.split("|");
                    updated = { ...editedAgent, modelName: model, modelProvider: provider || undefined };
                  }
                  setEditedAgent(updated);
                  onSave(updated);
                }}
                displayEmpty
              >
                {loadingModels ? (
                  <MenuItem disabled>
                    <CircularProgress size={16} sx={{ mr: 1 }} />
                    Loading...
                  </MenuItem>
                ) : models.length === 0 ? (
                  <MenuItem disabled>
                    <em>No models available</em>
                  </MenuItem>
                ) : (
                  // Group models by provider
                  Object.entries(
                    models.reduce((acc, m) => {
                      const provider = m.provider || "Other";
                      if (!acc[provider]) acc[provider] = [];
                      acc[provider].push(m);
                      return acc;
                    }, {} as Record<string, typeof models>)
                  ).flatMap(([provider, providerModels]) => [
                    <ListSubheader key={`header-${provider}`} sx={{ bgcolor: "background.paper", lineHeight: "32px", fontSize: "0.75rem" }}>
                      {provider}
                    </ListSubheader>,
                    ...providerModels.map((m) => (
                      <MenuItem key={m.id} value={`${m.model}|${m.provider}`} sx={{ pl: 3, fontSize: 12 }}>
                        {m.name}
                      </MenuItem>
                    ))
                  ])
                )}
              </Select>
            </FormControl>
          )}

          {/* System Instruction - Only for model-based agents */}
          {["chat_model", "supervisor", "deep"].includes(editedAgent.type) && (
            <Box sx={{ position: "relative" }}>
              <TextField
                placeholder="System Instruction"
                size="small"
                fullWidth
                multiline
                minRows={3}
                maxRows={6}
                value={editedAgent.instruction || ""}
                onChange={(e) => handleChange("instruction", e.target.value)}
                InputProps={{
                  endAdornment: (
                    <IconButton
                      size="small"
                      onClick={() => setInstructionDialogOpen(true)}
                      sx={{ position: "absolute", right: 8, top: 8 }}
                    >
                      <OpenInNewIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  ),
                }}
              />
            </Box>
          )}

          {/* Tools - Only for agents that can use tools */}
          {["chat_model", "supervisor", "deep"].includes(editedAgent.type) && (
            <Box>
              <Typography variant="caption" color="text.secondary" mb={0.5} display="block">
                Tools ({(editedAgent.toolIds || []).length} selected)
              </Typography>
              <Box
                sx={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 0.5,
                  maxHeight: 120,
                  overflow: "auto",
                  p: 1,
                  bgcolor: "action.hover",
                  borderRadius: 1,
                }}
              >
                {tools.length === 0 ? (
                  <Typography variant="caption" color="text.disabled">
                    No tools available
                  </Typography>
                ) : (
                  tools.map((tool) => (
                    <Chip
                      key={tool.id}
                      label={tool.name}
                      size="small"
                      color={(editedAgent.toolIds || []).includes(tool.name) ? "primary" : "default"}
                      onClick={() => handleToolToggle(tool.name)}
                      sx={{ cursor: "pointer" }}
                    />
                  ))
                )}
              </Box>
            </Box>
          )}

          {/* ========== Type-Specific Configuration ========== */}

          {/* Deep Agent Config */}
          {editedAgent.type === "deep" && (
            <Box sx={{ p: 1.5, bgcolor: "action.hover", borderRadius: 1 }}>
              <Typography variant="caption" color="text.secondary" fontWeight={600} display="block" mb={1}>
                Deep Agent Options
              </Typography>
              <FormControlLabel
                control={
                  <Switch
                    size="small"
                    checked={!(editedAgent.typeConfig as DeepAgentTypeConfig)?.withoutWriteTodos}
                    onChange={(e) => handleTypeConfigChange("withoutWriteTodos", !e.target.checked)}
                  />
                }
                label={<Typography variant="body2">Enable write_todos tool</Typography>}
              />
              <FormControlLabel
                control={
                  <Switch
                    size="small"
                    checked={!(editedAgent.typeConfig as DeepAgentTypeConfig)?.withoutGeneralSubAgent}
                    onChange={(e) => handleTypeConfigChange("withoutGeneralSubAgent", !e.target.checked)}
                  />
                }
                label={<Typography variant="body2">Enable general sub-agent</Typography>}
              />
            </Box>
          )}

          {/* Plan-Execute Agent Config */}
          {editedAgent.type === "plan_execute" && (
            <Box sx={{ bgcolor: "action.hover", borderRadius: 1, overflow: "hidden" }}>
              <Typography variant="caption" color="text.secondary" fontWeight={600} display="block" p={1.5} pb={0.5}>
                Plan-Execute Sub-Agents
              </Typography>

              {/* Planner Config */}
              <Accordion disableGutters elevation={0} sx={{ bgcolor: "transparent", "&:before": { display: "none" } }}>
                <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ minHeight: 36, px: 1.5, "& .MuiAccordionSummary-content": { my: 0.5 } }}>
                  <Typography variant="body2" fontWeight={500}>Planner</Typography>
                </AccordionSummary>
                <AccordionDetails sx={{ px: 1.5, pt: 0, pb: 1 }}>
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                    <FormControl size="small" fullWidth>
                      <Typography variant="caption" color="text.secondary" mb={0.5}>Model</Typography>
                      <Select
                        value={(() => {
                          const cfg = (editedAgent.typeConfig as PlanExecuteAgentTypeConfig)?.planner;
                          return cfg?.modelName ? `${cfg.modelName}|${cfg.modelProvider || ""}` : "";
                        })()}
                        onChange={(e) => {
                          const current = (editedAgent.typeConfig as PlanExecuteAgentTypeConfig)?.planner || {};
                          const value = e.target.value;
                          if (!value) {
                            handleTypeConfigChange("planner", { ...current, modelName: undefined, modelProvider: undefined });
                          } else {
                            const [model, provider] = value.split("|");
                            handleTypeConfigChange("planner", { ...current, modelName: model, modelProvider: provider || undefined });
                          }
                        }}
                        displayEmpty
                      >
                        <MenuItem value=""><em>Same as primary</em></MenuItem>
                        {models.map((m) => <MenuItem key={m.id} value={`${m.model}|${m.provider}`}>{m.name} ({m.provider})</MenuItem>)}
                      </Select>
                    </FormControl>
                    <TextField
                      placeholder="Planner Instruction"
                      size="small"
                      fullWidth
                      multiline
                      minRows={2}
                      value={(editedAgent.typeConfig as PlanExecuteAgentTypeConfig)?.planner?.instruction || ""}
                      onChange={(e) => {
                        const current = (editedAgent.typeConfig as PlanExecuteAgentTypeConfig)?.planner || {};
                        handleTypeConfigChange("planner", { ...current, instruction: e.target.value || undefined });
                      }}
                    />
                  </Box>
                </AccordionDetails>
              </Accordion>

              {/* Executor Config */}
              <Accordion disableGutters elevation={0} sx={{ bgcolor: "transparent", "&:before": { display: "none" } }}>
                <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ minHeight: 36, px: 1.5, "& .MuiAccordionSummary-content": { my: 0.5 } }}>
                  <Typography variant="body2" fontWeight={500}>Executor</Typography>
                </AccordionSummary>
                <AccordionDetails sx={{ px: 1.5, pt: 0, pb: 1 }}>
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                    <FormControl size="small" fullWidth>
                      <Typography variant="caption" color="text.secondary" mb={0.5}>Model</Typography>
                      <Select
                        value={(() => {
                          const cfg = (editedAgent.typeConfig as PlanExecuteAgentTypeConfig)?.executor;
                          return cfg?.modelName ? `${cfg.modelName}|${cfg.modelProvider || ""}` : "";
                        })()}
                        onChange={(e) => {
                          const current = (editedAgent.typeConfig as PlanExecuteAgentTypeConfig)?.executor || {};
                          const value = e.target.value;
                          if (!value) {
                            handleTypeConfigChange("executor", { ...current, modelName: undefined, modelProvider: undefined });
                          } else {
                            const [model, provider] = value.split("|");
                            handleTypeConfigChange("executor", { ...current, modelName: model, modelProvider: provider || undefined });
                          }
                        }}
                        displayEmpty
                      >
                        <MenuItem value=""><em>Same as primary</em></MenuItem>
                        {models.map((m) => <MenuItem key={m.id} value={`${m.model}|${m.provider}`}>{m.name} ({m.provider})</MenuItem>)}
                      </Select>
                    </FormControl>
                    <TextField
                      placeholder="Executor Instruction"
                      size="small"
                      fullWidth
                      multiline
                      minRows={2}
                      value={(editedAgent.typeConfig as PlanExecuteAgentTypeConfig)?.executor?.instruction || ""}
                      onChange={(e) => {
                        const current = (editedAgent.typeConfig as PlanExecuteAgentTypeConfig)?.executor || {};
                        handleTypeConfigChange("executor", { ...current, instruction: e.target.value || undefined });
                      }}
                    />
                    <Box>
                      <Typography variant="caption" color="text.secondary" mb={0.5} display="block">Tools</Typography>
                      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                        {tools.map((tool) => {
                          const executorTools = (editedAgent.typeConfig as PlanExecuteAgentTypeConfig)?.executor?.toolIds || [];
                          const isSelected = executorTools.includes(tool.name);
                          return (
                            <Chip
                              key={tool.id}
                              label={tool.name}
                              size="small"
                              color={isSelected ? "primary" : "default"}
                              onClick={() => {
                                const current = (editedAgent.typeConfig as PlanExecuteAgentTypeConfig)?.executor || {};
                                const currentTools = current.toolIds || [];
                                const newTools = isSelected
                                  ? currentTools.filter(name => name !== tool.name)
                                  : [...currentTools, tool.name];
                                handleTypeConfigChange("executor", { ...current, toolIds: newTools });
                              }}
                              sx={{ cursor: "pointer", height: 24, fontSize: "0.7rem" }}
                            />
                          );
                        })}
                      </Box>
                    </Box>
                  </Box>
                </AccordionDetails>
              </Accordion>

              {/* Replanner Config */}
              <Accordion disableGutters elevation={0} sx={{ bgcolor: "transparent", "&:before": { display: "none" } }}>
                <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ minHeight: 36, px: 1.5, "& .MuiAccordionSummary-content": { my: 0.5 } }}>
                  <Typography variant="body2" fontWeight={500}>Replanner</Typography>
                </AccordionSummary>
                <AccordionDetails sx={{ px: 1.5, pt: 0, pb: 1 }}>
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                    <FormControl size="small" fullWidth>
                      <Typography variant="caption" color="text.secondary" mb={0.5}>Model</Typography>
                      <Select
                        value={(() => {
                          const cfg = (editedAgent.typeConfig as PlanExecuteAgentTypeConfig)?.replanner;
                          return cfg?.modelName ? `${cfg.modelName}|${cfg.modelProvider || ""}` : "";
                        })()}
                        onChange={(e) => {
                          const current = (editedAgent.typeConfig as PlanExecuteAgentTypeConfig)?.replanner || {};
                          const value = e.target.value;
                          if (!value) {
                            handleTypeConfigChange("replanner", { ...current, modelName: undefined, modelProvider: undefined });
                          } else {
                            const [model, provider] = value.split("|");
                            handleTypeConfigChange("replanner", { ...current, modelName: model, modelProvider: provider || undefined });
                          }
                        }}
                        displayEmpty
                      >
                        <MenuItem value=""><em>Same as primary</em></MenuItem>
                        {models.map((m) => <MenuItem key={m.id} value={`${m.model}|${m.provider}`}>{m.name} ({m.provider})</MenuItem>)}
                      </Select>
                    </FormControl>
                    <TextField
                      placeholder="Replanner Instruction"
                      size="small"
                      fullWidth
                      multiline
                      minRows={2}
                      value={(editedAgent.typeConfig as PlanExecuteAgentTypeConfig)?.replanner?.instruction || ""}
                      onChange={(e) => {
                        const current = (editedAgent.typeConfig as PlanExecuteAgentTypeConfig)?.replanner || {};
                        handleTypeConfigChange("replanner", { ...current, instruction: e.target.value || undefined });
                      }}
                    />
                  </Box>
                </AccordionDetails>
              </Accordion>
            </Box>
          )}

          {/* Loop Agent Config */}
          {editedAgent.type === "loop" && (
            <Box sx={{ p: 1.5, bgcolor: "action.hover", borderRadius: 1 }}>
              <Typography variant="caption" color="text.secondary" fontWeight={600} display="block" mb={1}>
                Loop Options
              </Typography>
              <TextField
                placeholder="Max Loop Iterations"
                size="small"
                fullWidth
                type="number"
                value={(editedAgent.typeConfig as LoopAgentTypeConfig)?.maxIterations ?? 10}
                onChange={(e) => handleTypeConfigChange("maxIterations", e.target.value ? parseInt(e.target.value) : 10)}
                inputProps={{ min: 1, max: 100 }}
                helperText="Maximum number of loop iterations"
              />
            </Box>
          )}

          {/* Sub-Agents indicator for composite types */}
          {["supervisor", "sequential", "parallel", "loop"].includes(editedAgent.type) && (
            <Box sx={{ p: 1.5, bgcolor: "action.hover", borderRadius: 1 }}>
              <Typography variant="caption" color="text.secondary" fontWeight={600} display="block" mb={0.5}>
                Sub-Agents ({subAgentInfos.length})
                {orderMatters && subAgentInfos.length > 0 && (
                  <Chip label="Order matters" size="small" sx={{ ml: 1, height: 16, fontSize: "0.6rem" }} color="info" />
                )}
              </Typography>
              {subAgentInfos.length > 0 ? (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, mb: 1 }}>
                  {subAgentInfos.map((info, idx) => (
                    <Box
                      key={info.id}
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 0.5,
                        p: 0.5,
                        bgcolor: "background.paper",
                        borderRadius: 1,
                        border: "1px solid",
                        borderColor: "divider",
                      }}
                    >
                      {orderMatters && (
                        <Typography
                          variant="caption"
                          sx={{
                            width: 20,
                            height: 20,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            bgcolor: "primary.main",
                            color: "white",
                            borderRadius: "50%",
                            fontWeight: 600,
                            fontSize: "0.7rem",
                          }}
                        >
                          {idx + 1}
                        </Typography>
                      )}
                      <Box sx={{ display: "flex", alignItems: "center", flex: 1, minWidth: 0 }}>
                        {AGENT_TYPE_ICONS[info.type]}
                        <Typography variant="body2" noWrap sx={{ ml: 0.5 }}>
                          {info.name}
                        </Typography>
                      </Box>
                      {orderMatters && subAgentInfos.length > 1 && (
                        <Box sx={{ display: "flex" }}>
                          <IconButton
                            size="small"
                            disabled={idx === 0}
                            onClick={() => handleMoveSubAgent(idx, "up")}
                            sx={{ p: 0.25 }}
                          >
                            <ArrowUpwardIcon sx={{ fontSize: 14 }} />
                          </IconButton>
                          <IconButton
                            size="small"
                            disabled={idx === subAgentInfos.length - 1}
                            onClick={() => handleMoveSubAgent(idx, "down")}
                            sx={{ p: 0.25 }}
                          >
                            <ArrowDownwardIcon sx={{ fontSize: 14 }} />
                          </IconButton>
                        </Box>
                      )}
                    </Box>
                  ))}
                </Box>
              ) : (
                <Typography variant="body2" color="text.disabled" mb={1}>
                  No sub-agents connected
                </Typography>
              )}
              <Typography variant="caption" color="text.disabled">
                Connect sub-agents by dragging from this node to others on the canvas
              </Typography>
            </Box>
          )}

          {/* Max Iterations - for all types */}
          <TextField
            placeholder="Max Iterations"
            size="small"
            type="number"
            value={editedAgent.maxIterations ?? 20}
            onChange={(e) =>
              handleChange("maxIterations", e.target.value ? parseInt(e.target.value) : 20)
            }
            inputProps={{ min: 1, max: 100 }}
            helperText="Maximum execution cycles"
          />
        </Box>
      </Box>

      {/* Footer */}
      <Box sx={{ p: 1.5, borderTop: 1, borderColor: "divider" }}>
        <Button
          fullWidth
          color="error"
          variant="outlined"
          size="small"
          startIcon={<DeleteIcon />}
          onClick={() => {
            onDelete(editedAgent.id);
            onClose();
          }}
        >
          Delete Agent
        </Button>
      </Box>

      {/* Markdown Edit Dialogs */}
      <MarkdownEditDialog
        open={descriptionDialogOpen}
        title="Edit Description"
        value={editedAgent.description || ""}
        onClose={() => setDescriptionDialogOpen(false)}
        onSave={(value) => handleChange("description", value)}
        placeholder="Enter agent description using Markdown..."
      />
      <MarkdownEditDialog
        open={instructionDialogOpen}
        title="Edit System Instruction"
        value={editedAgent.instruction || ""}
        onClose={() => setInstructionDialogOpen(false)}
        onSave={(value) => handleChange("instruction", value)}
        placeholder="Enter system instruction using Markdown..."
      />
    </Box>
  );
};

// =====================================
// Main Component
// =====================================

interface AgentDesignerProps {
  workspaceId: string;
  tools: ToolConfig[];
}

const AgentDesigner: React.FC<AgentDesignerProps> = ({ workspaceId, tools }) => {
  // Agent Compositions (left sidebar)
  const [compositions, setCompositions] = useState<WorkspaceAgent[]>([]);
  const [loadingCompositions, setLoadingCompositions] = useState(true);
  const [selectedCompositionId, setSelectedCompositionId] = useState<string | null>(null);

  // Get the selected composition
  const selectedComposition = selectedCompositionId
    ? compositions.find(c => c.id === selectedCompositionId)
    : null;

  // Canvas nodes and edges
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  // Track if we should skip the next rebuild (after adding a node)
  const skipNextRebuild = useRef(false);

  // UI state
  const [canvasAddMenuAnchor, setCanvasAddMenuAnchor] = useState<HTMLElement | null>(null);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [models, setModels] = useState<Array<{ id: string; name: string; model: string; provider: string }>>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [compositionNameInput, setCompositionNameInput] = useState("");
  const [isEditingName, setIsEditingName] = useState(false);

  // Load compositions on mount
  useEffect(() => {
    if (!workspaceId) {
      setLoadingCompositions(false);
      return;
    }

    setLoadingCompositions(true);
    listWorkspaceAgents(workspaceId)
      .then(data => {
        setCompositions(data);
        // Auto-select first composition
        if (data.length > 0 && !selectedCompositionId) {
          setSelectedCompositionId(data[0].id);
        }
      })
      .catch(err => {
        console.warn("Backend API not available, starting with empty compositions:", err);
        setCompositions([]);
      })
      .finally(() => setLoadingCompositions(false));
  }, [workspaceId]);

  // Build canvas nodes/edges when selected composition changes
  useEffect(() => {
    // Skip rebuild if we just added a node
    if (skipNextRebuild.current) {
      skipNextRebuild.current = false;
      return;
    }

    if (!selectedComposition) {
      // No composition selected - show empty canvas
      setNodes([]);
      setEdges([]);
      setEditingAgent(null);
      setEditingNodeId(null);
      return;
    }

    // Convert composition nodes to ReactFlow nodes
    const flowNodes: Node[] = selectedComposition.nodes.map(node => {
      if (node.type === "start") {
        return {
          id: node.id,
          type: "start",
          position: node.position,
          data: {},
        };
      }
      return {
        id: node.id,
        type: "agent",
        position: node.position,
        data: { agent: node.agent, tools, allAgents: compositions.flatMap(c => c.nodes.filter(n => n.agent).map(n => n.agent!)) },
      };
    });

    // Ensure start node exists for selected composition
    if (!flowNodes.some(n => n.type === "start")) {
      flowNodes.unshift({ id: "start", type: "start", position: { x: 20, y: 150 }, data: {} });
    }

    // Convert composition edges to ReactFlow edges
    const flowEdges: Edge[] = selectedComposition.edges.map(edge => {
      const sourceNode = selectedComposition.nodes.find(n => n.id === edge.source);
      const sourceAgent = sourceNode?.agent;
      const edgeStyle = sourceAgent ? getEdgeStyle(sourceAgent.type) : { stroke: "#8b5cf6", animated: false, label: "" };

      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.source_handle,
        targetHandle: edge.target_handle,
        style: { stroke: edgeStyle.stroke, strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: edgeStyle.stroke },
        animated: edgeStyle.animated,
        label: edge.label || edgeStyle.label,
        labelStyle: { fontSize: 10, fill: edgeStyle.stroke },
        labelBgStyle: { fill: "white", fillOpacity: 0.8 },
      };
    });

    setNodes(flowNodes);
    setEdges(flowEdges);
  }, [selectedComposition]); // Only rebuild when composition changes

  // Update node data when tools or edges change (without rebuilding entire canvas)
  useEffect(() => {
    if (!selectedComposition) return;

    // Get all agents from current composition
    const allAgents = selectedComposition.nodes.filter(n => n.agent).map(n => n.agent!);

    setNodes(nds => {
      const updatedNodes = nds.map(node => {
        if (node.type === "agent") {
          const nodeData = node.data as AgentNodeData;
          if (nodeData?.agent) {
            return {
              ...node,
              data: { ...nodeData, tools, allAgents, edges, allNodes: nds, models },
            };
          }
        }
        return node;
      });
      return updatedNodes;
    });
  }, [selectedComposition, tools, edges, models]);

  // Fetch models
  useEffect(() => {
    setLoadingModels(true);
    fetch(`${getApiBase()}/api/models`)
      .then((res) => res.json())
      .then((data) => {
        if (data.code === 200 && Array.isArray(data.data)) {
          setModels(data.data.map((m: any) => ({ id: m.id, name: m.name || m.model, model: m.model, provider: m.provider })));
        }
      })
      .catch(console.error)
      .finally(() => setLoadingModels(false));
  }, []);

  // Save composition to backend
  const saveComposition = useCallback(async () => {
    if (!selectedComposition) return;

    // Convert ReactFlow nodes/edges back to composition format
    // Include full agent config in nodes, not just agent_id
    const compositionNodes: WorkspaceAgentNode[] = nodes.map(node => {
      if (node.type === "start") {
        return {
          id: node.id,
          type: "start" as const,
          position: node.position,
        };
      }
      const agentData = node.data as AgentNodeData;
      return {
        id: node.id,
        type: "agent" as const,
        agent: agentData?.agent,  // Include full agent config
        position: node.position,
      };
    });

    const compositionEdges: WorkspaceAgentEdge[] = edges.map((edge, index) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      source_handle: edge.sourceHandle || undefined,
      target_handle: edge.targetHandle || undefined,
      label: edge.label as string | undefined,
      order: index,
    }));

    // Skip the next rebuild since we're just saving current state
    skipNextRebuild.current = true;

    // Update local state first
    const updatedComposition: WorkspaceAgent = {
      ...selectedComposition,
      nodes: compositionNodes,
      edges: compositionEdges,
      updated_at: new Date().toISOString(),
    };
    setCompositions(prev => prev.map(c => c.id === updatedComposition.id ? updatedComposition : c));

    // Try to save to backend
    if (workspaceId) {
      try {
        await updateWorkspaceAgent(workspaceId, selectedComposition.id, {
          nodes: compositionNodes,
          edges: compositionEdges,
        });
      } catch (err) {
        console.warn("Failed to save composition to backend:", err);
      }
    }
  }, [workspaceId, selectedComposition, nodes, edges]);

  // Add agent to canvas
  const handleAddAgentToCanvas = (agent: Agent) => {
    // Check if already on canvas
    const existingNode = nodes.find(n =>
      n.type === "agent" && (n.data as AgentNodeData)?.agent?.id === agent.id
    );
    if (existingNode || !selectedComposition) {
      setCanvasAddMenuAnchor(null);
      return;
    }

    const allAgents = [...selectedComposition.nodes.filter(n => n.agent).map(n => n.agent!), agent];
    const newNode: Node = {
      id: `node_${crypto.randomUUID()}`,
      type: "agent",
      position: { x: 400 + Math.random() * 100, y: 100 + Math.random() * 100 },
      data: { agent, tools, allAgents },
    };
    setNodes((nds) => [...nds, newNode]);
    setCanvasAddMenuAnchor(null);

    // Auto-save
    setTimeout(saveComposition, 100);
  };

  // Add new agent node by type (creates a new agent and adds to canvas)
  const handleAddNewAgentNode = (type: AgentType) => {
    if (!selectedComposition) {
      setCanvasAddMenuAnchor(null);
      return;
    }

    // Create a new agent configuration
    const newAgent: Agent = {
      id: crypto.randomUUID(),
      name: `New ${AGENT_TYPE_INFO[type].label}`,
      type,
      enabled: true,
      toolIds: [],
      subAgentIds: [],
    };

    // Add node to canvas with embedded agent
    const nodeId = `node_${crypto.randomUUID()}`;
    const allAgents = [...selectedComposition.nodes.filter(n => n.agent).map(n => n.agent!), newAgent];
    const newNode: Node = {
      id: nodeId,
      type: "agent",
      position: { x: 300 + Math.random() * 100, y: 100 + Math.random() * 100 },
      data: { agent: newAgent, tools, allAgents },
    };

    setNodes((nds) => {
      const updated = [...nds, newNode];
      console.log("[handleAddNewAgentNode] Added node:", nodeId, "Total nodes:", updated.length);
      return updated;
    });

    setCanvasAddMenuAnchor(null);

    // Auto-save composition
    setTimeout(saveComposition, 100);
  };

  // Create new composition
  const handleCreateComposition = async () => {
    const newComposition: WorkspaceAgent = {
      id: crypto.randomUUID(),
      workspace_id: workspaceId,
      name: `Composition ${compositions.length + 1}`,
      nodes: [{ id: "start", type: "start", position: { x: 20, y: 150 } }],
      edges: [],
      enabled: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Try to save to backend, but continue even if it fails
    if (workspaceId) {
      try {
        const savedComposition = await createWorkspaceAgent(workspaceId, {
          name: newComposition.name,
          nodes: newComposition.nodes,
          edges: newComposition.edges,
          enabled: true,
        });
        // Use the saved composition with server-generated ID
        setCompositions(prev => [...prev, savedComposition]);
        setSelectedCompositionId(savedComposition.id);
        return;
      } catch (err) {
        console.warn("Backend API not available, using local state:", err);
      }
    }

    // Fallback: use local state
    setCompositions(prev => [...prev, newComposition]);
    setSelectedCompositionId(newComposition.id);
  };

  // Delete composition
  const handleDeleteComposition = async (compositionId: string) => {
    // Try to delete from backend
    if (workspaceId) {
      try {
        await deleteWorkspaceAgent(workspaceId, compositionId);
      } catch (err) {
        console.warn("Backend API not available, using local state:", err);
      }
    }

    // Update local state regardless
    setCompositions(prev => prev.filter(c => c.id !== compositionId));
    if (selectedCompositionId === compositionId) {
      const remaining = compositions.filter(c => c.id !== compositionId);
      setSelectedCompositionId(remaining.length > 0 ? remaining[0].id : null);
    }
  };

  // Update composition name
  const handleUpdateCompositionName = async (name: string) => {
    if (!selectedComposition || !name.trim()) return;

    try {
      const updated = await updateWorkspaceAgent(workspaceId, selectedComposition.id, { name });
      setCompositions(prev => prev.map(c => c.id === updated.id ? updated : c));
    } catch (err) {
      console.error("Failed to update composition name:", err);
    }
    setIsEditingName(false);
  };


  // Handle new connection
  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;

      // Prevent self-connections
      if (connection.source === connection.target) return;

      // Check for duplicate connections
      const existingEdge = edges.find(
        (e) => e.source === connection.source && e.target === connection.target
      );
      if (existingEdge) return;

      // Handle connection from start node (marks entry point)
      // Start can connect to ANY agent type (including Supervisor)
      if (connection.source === "start") {
        const targetNode = nodes.find((n) => n.id === connection.target);
        if (!targetNode || targetNode.type !== "agent") return;

        // All agent types can receive input from Start
        setEdges((eds) =>
          addEdge(
            {
              ...connection,
              style: { stroke: "#22c55e", strokeWidth: 2, strokeDasharray: "5,5" },
              markerEnd: { type: MarkerType.ArrowClosed, color: "#22c55e" },
              label: "entry",
              labelStyle: { fontSize: 10, fill: "#22c55e" },
              labelBgStyle: { fill: "white", fillOpacity: 0.8 },
            },
            eds
          )
        );
        return;
      }

      // Validate agent-to-agent connection
      const sourceNode = nodes.find((n) => n.id === connection.source);
      const targetNode = nodes.find((n) => n.id === connection.target);
      if (!sourceNode || !targetNode || sourceNode.type !== "agent" || targetNode.type !== "agent") return;

      const sourceAgent = (sourceNode.data as AgentNodeData).agent;
      const targetAgent = (targetNode.data as AgentNodeData).agent;

      // Validation based on ADK rules
      if (!canHaveSubAgents(sourceAgent.type)) {
        console.warn(`${sourceAgent.type} cannot have sub-agents`);
        return;
      }
      if (!canBeNestedSubAgent(targetAgent.type)) {
        console.warn(`${targetAgent.type} cannot be nested as a sub-agent (Supervisor is top-level coordinator)`);
        return;
      }

      // Get edge style based on source agent type
      const edgeStyle = getEdgeStyle(sourceAgent.type);

      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            style: { stroke: edgeStyle.stroke, strokeWidth: 2 },
            markerEnd: { type: MarkerType.ArrowClosed, color: edgeStyle.stroke },
            animated: edgeStyle.animated,
            label: edgeStyle.label,
            labelStyle: { fontSize: 10, fill: edgeStyle.stroke },
            labelBgStyle: { fill: "white", fillOpacity: 0.8 },
          },
          eds
        )
      );

      // Auto-save after connection
      setTimeout(saveComposition, 100);
    },
    [nodes, edges, setEdges, saveComposition]
  );

  // Handle edge update (drag edge endpoint to new node) - for reactflow 11.x
  const onEdgeUpdate = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      // Validate new connection
      if (!newConnection.source || !newConnection.target) return;
      if (newConnection.source === newConnection.target) return;

      // Check for duplicate
      const existingEdge = edges.find(
        (e) => e.id !== oldEdge.id && e.source === newConnection.source && e.target === newConnection.target
      );
      if (existingEdge) return;

      setEdges((els) => updateEdge(oldEdge, newConnection, els));
      setTimeout(saveComposition, 100);
    },
    [edges, setEdges, saveComposition]
  );

  // Handle node position change
  const handleNodesChange = useCallback(
    (changes: any) => {
      onNodesChange(changes);
      // Auto-save on position change (when drag ends)
      const positionChanges = changes.filter((c: any) => c.type === "position" && c.dragging === false);
      if (positionChanges.length > 0) {
        setTimeout(saveComposition, 100);
      }
    },
    [onNodesChange, saveComposition]
  );

  // Handle edge deletion
  const handleEdgesChange = useCallback(
    (changes: any) => {
      onEdgesChange(changes);
      const removeChanges = changes.filter((c: any) => c.type === "remove");
      if (removeChanges.length > 0) {
        setTimeout(saveComposition, 100);
      }
    },
    [onEdgesChange, saveComposition]
  );

  // Delete agent from canvas
  const handleDeleteFromCanvas = (nodeId: string) => {
    setNodes((nds) => nds.filter((n) => n.id !== nodeId));
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
    if (editingAgent) {
      const node = nodes.find(n => n.id === nodeId);
      if (node && (node.data as AgentNodeData)?.agent?.id === editingAgent.id) {
        setEditingAgent(null);
        setEditingNodeId(null);
      }
    }
    setTimeout(saveComposition, 100);
  };

  // Save edited agent (update in node data)
  const handleSaveAgent = (updatedAgent: Agent) => {
    // Update node data with new agent
    setNodes((nds) => {
      const allAgents = nds
        .filter(n => n.type === "agent")
        .map(n => {
          const nodeAgent = (n.data as AgentNodeData)?.agent;
          return nodeAgent?.id === updatedAgent.id ? updatedAgent : nodeAgent;
        })
        .filter(Boolean) as Agent[];

      return nds.map((n) => {
        if (n.type === "agent" && (n.data as AgentNodeData)?.agent?.id === updatedAgent.id) {
          return { ...n, data: { agent: updatedAgent, tools, allAgents } };
        }
        return n;
      });
    });

    // Auto-save composition
    setTimeout(saveComposition, 100);
  };

  // Handle edge reordering for sub-agent order
  const handleReorderEdges = useCallback((sourceNodeId: string, newEdgeOrder: string[]) => {
    setEdges(currentEdges => {
      // Separate edges from this source and other edges
      const sourceEdges = currentEdges.filter(e => e.source === sourceNodeId && e.target !== "start");
      const otherEdges = currentEdges.filter(e => e.source !== sourceNodeId || e.target === "start");

      // Reorder source edges according to newEdgeOrder
      const reorderedSourceEdges = newEdgeOrder
        .map(edgeId => sourceEdges.find(e => e.id === edgeId))
        .filter(Boolean) as Edge[];

      return [...otherEdges, ...reorderedSourceEdges];
    });

    // Auto-save after reordering
    setTimeout(saveComposition, 100);
  }, [setEdges, saveComposition]);

  // Handle node selection to show config panel
  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.type === "agent") {
      const agent = (node.data as AgentNodeData).agent;
      setEditingAgent(agent);
      setEditingNodeId(node.id);
    }
  }, []);

  return (
    <Box sx={{ height: "100%", display: "flex", overflow: "hidden" }}>
      {/* Left Composition List */}
      <Box
        sx={{
          width: 200,
          borderRight: 1,
          borderColor: "divider",
          display: "flex",
          flexDirection: "column",
          bgcolor: "background.paper",
        }}
      >
        {/* Header with Add Button */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            px: 1,
            py: 0.5,
            borderBottom: 1,
            borderColor: "divider",
          }}
        >
          <Typography variant="caption" color="text.secondary" fontWeight={600}>
            Compositions ({compositions.length})
          </Typography>
          <Tooltip title="Create new composition">
            <IconButton
              size="small"
              onClick={handleCreateComposition}
              sx={{ p: 0.25 }}
            >
              <AddIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
        <List dense sx={{ flex: 1, overflow: "auto", p: 0 }}>
          {loadingCompositions ? (
            <Box sx={{ p: 2, textAlign: "center" }}>
              <CircularProgress size={20} />
            </Box>
          ) : compositions.length === 0 ? (
            <Box sx={{ p: 2, textAlign: "center" }}>
              <Typography variant="caption" color="text.disabled">
                No compositions yet
              </Typography>
              <Typography variant="caption" color="text.disabled" display="block" mt={0.5}>
                Click + to create
              </Typography>
            </Box>
          ) : (
            compositions.map((comp) => (
              <ListItemButton
                key={comp.id}
                selected={selectedCompositionId === comp.id}
                onClick={() => setSelectedCompositionId(comp.id)}
                sx={{
                  py: 0.5,
                  px: 1,
                  borderLeft: "3px solid",
                  borderLeftColor: selectedCompositionId === comp.id
                    ? "primary.main"
                    : "transparent",
                  opacity: !comp.enabled ? 0.5 : 1,
                }}
              >
                <ListItemIcon sx={{ minWidth: 24, color: "primary.main" }}>
                  <AccountTreeIcon fontSize="small" />
                </ListItemIcon>
                {/* Inline editing for name */}
                {isEditingName && selectedCompositionId === comp.id ? (
                  <TextField
                    size="small"
                    value={compositionNameInput}
                    onChange={(e) => setCompositionNameInput(e.target.value)}
                    onBlur={() => {
                      if (compositionNameInput.trim()) {
                        handleUpdateCompositionName(compositionNameInput);
                      } else {
                        setIsEditingName(false);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        if (compositionNameInput.trim()) {
                          handleUpdateCompositionName(compositionNameInput);
                        }
                      } else if (e.key === "Escape") {
                        setIsEditingName(false);
                      }
                    }}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                    sx={{
                      flex: 1,
                      "& .MuiInputBase-input": {
                        fontSize: "0.8rem",
                        py: 0.25,
                        px: 0.5
                      }
                    }}
                  />
                ) : (
                  <ListItemText
                    primary={comp.name}
                    secondary={`${comp.nodes.filter(n => n.type === "agent").length} agents`}
                    primaryTypographyProps={{ variant: "body2", noWrap: true, fontSize: "0.8rem" }}
                    secondaryTypographyProps={{ variant: "caption", fontSize: "0.65rem" }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setCompositionNameInput(comp.name);
                      setIsEditingName(true);
                    }}
                    sx={{ cursor: "text" }}
                  />
                )}
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteComposition(comp.id);
                  }}
                  sx={{ p: 0.25, opacity: 0.5, "&:hover": { opacity: 1 } }}
                >
                  <DeleteIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </ListItemButton>
            ))
          )}
        </List>
      </Box>

      {/* Canvas Container */}
      <Box
        sx={{
          flex: 1,
          position: "relative",
          overflow: "hidden",
          // Style for selected edges
          "& .react-flow__edge.selected .react-flow__edge-path": {
            stroke: "#f59e0b !important",
            strokeWidth: "3px !important",
          },
          "& .react-flow__edge.selected marker": {
            fill: "#f59e0b !important",
          },
          // Make edges easier to click
          "& .react-flow__edge-interaction": {
            strokeWidth: 20,
          },
        }}
      >
        {/* No composition selected hint */}
        {!selectedComposition && (
          <Box
            sx={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              textAlign: "center",
              color: "text.disabled",
              zIndex: 5,
            }}
          >
            <AccountTreeIcon sx={{ fontSize: 48, mb: 1, opacity: 0.3 }} />
            <Typography variant="body2">
              Select a composition from the list to edit
            </Typography>
            <Typography variant="caption">
              Or create a new composition using the + button
            </Typography>
          </Box>
        )}

        {/* Canvas Add Button - Top Left (only when composition selected) */}
        {selectedComposition && (
          <Box
            sx={{
              position: "absolute",
              top: 10,
              left: 10,
              zIndex: 10,
              display: "flex",
              gap: 1,
            }}
          >
            <Button
              size="small"
              variant="outlined"
              startIcon={<AddIcon />}
              onClick={(e) => setCanvasAddMenuAnchor(e.currentTarget)}
              sx={{
                bgcolor: "background.paper",
                borderColor: "divider",
                "&:hover": { bgcolor: "action.hover", borderColor: "divider" },
              }}
            >
              Add
            </Button>
            <Button
              size="small"
              variant="outlined"
              startIcon={<SaveIcon />}
              onClick={() => saveComposition()}
              sx={{
                bgcolor: "background.paper",
                borderColor: "divider",
                "&:hover": { bgcolor: "action.hover", borderColor: "divider" },
              }}
            >
              Save
            </Button>
            <Menu
              anchorEl={canvasAddMenuAnchor}
              open={Boolean(canvasAddMenuAnchor)}
              onClose={() => setCanvasAddMenuAnchor(null)}
            >
              {/* ADK Agent Types */}
              <Typography variant="caption" color="text.secondary" sx={{ px: 2, py: 0.5, display: "block", fontWeight: 600 }}>
                Agent Types
              </Typography>
              {Object.entries(AGENT_TYPE_INFO).map(([type, info]) => (
                <MenuItem
                  key={type}
                  onClick={() => handleAddNewAgentNode(type as AgentType)}
                >
                  <ListItemIcon sx={{ color: AGENT_TYPE_COLORS[type as AgentType] }}>
                    {AGENT_TYPE_ICONS[type as AgentType]}
                  </ListItemIcon>
                  <ListItemText
                    primary={info.label}
                    secondary={info.description}
                    secondaryTypographyProps={{ variant: "caption", sx: { fontSize: "0.7rem" } }}
                  />
                </MenuItem>
              ))}
            </Menu>
          </Box>
        )}

        {/* React Flow Canvas - takes full space */}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={onConnect}
          onEdgeUpdate={onEdgeUpdate}
          onNodeClick={handleNodeClick}
          nodeTypes={nodeTypes}
          defaultViewport={{ x: 0, y: 0, zoom: 1 }}
          minZoom={0.5}
          maxZoom={2}
          snapToGrid
          snapGrid={[20, 20]}
          elementsSelectable
          selectNodesOnDrag={false}
          edgeUpdaterRadius={10}
          deleteKeyCode={["Backspace", "Delete"]}
          defaultEdgeOptions={{
            style: { stroke: "#8b5cf6", strokeWidth: 2 },
            markerEnd: { type: MarkerType.ArrowClosed, color: "#8b5cf6" },
          }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
          <Controls />
        </ReactFlow>
        <Legend />

        {/* Right Config Panel - floats over canvas */}
        <AgentPanel
          agent={editingAgent}
          nodeId={editingNodeId}
          allAgents={selectedComposition?.nodes.filter(n => n.agent).map(n => n.agent!) || []}
          tools={tools}
          models={models}
          loadingModels={loadingModels}
          edges={edges}
          nodes={nodes}
          onClose={() => {
            setEditingAgent(null);
            setEditingNodeId(null);
          }}
          onSave={handleSaveAgent}
          onDelete={(agentId) => {
            // Find the node with this agent and delete it from canvas
            const node = nodes.find(n =>
              n.type === "agent" && (n.data as AgentNodeData)?.agent?.id === agentId
            );
            if (node) {
              handleDeleteFromCanvas(node.id);
            }
          }}
          onReorderEdges={handleReorderEdges}
        />
      </Box>
    </Box>
  );
};

export default AgentDesigner;

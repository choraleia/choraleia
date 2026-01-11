import React, { useEffect, useState, useMemo, useCallback } from "react";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Tab,
  Tabs,
  TextField,
  Typography,
  FormControl,
  Select,
  MenuItem,
  Chip,
  FormHelperText,
  Alert,
  RadioGroup,
  FormControlLabel,
  Radio,
  Autocomplete,
  InputAdornment,
  CircularProgress,
  Collapse,
  Switch,
  Divider,
  Checkbox,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import AddIcon from "@mui/icons-material/Add";
import ComputerIcon from "@mui/icons-material/Computer";
import ViewInArIcon from "@mui/icons-material/ViewInAr";
import CloudIcon from "@mui/icons-material/Cloud";
import RefreshIcon from "@mui/icons-material/Refresh";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import TerminalIcon from "@mui/icons-material/Terminal";
import StorageIcon from "@mui/icons-material/Storage";
import SettingsIcon from "@mui/icons-material/Settings";
import {
  SpaceConfigInput,
  RuntimeType,
  WorkspaceRuntime,
  HostAssetConfig,
  K8sAssetConfig,
  ToolConfig,
  ToolType,
  MCPStdioConfig,
  MCPSSEConfig,
  MCPHTTPConfig,
  MCPAuthConfig,
  RuntimeEnv,
  OpenAPIConfig,
  ScriptConfig,
  BrowserServiceConfig,
  BuiltinConfig,
  PRESET_MCP_SERVERS,
  BROWSER_SERVICE_PROVIDERS,
  ContainerMode,
  WorkspaceAssetRef,
  AssetRestrictions,
  SSHRestrictions,
  LocalRestrictions,
  DockerRestrictions,
  PRESET_DOCKER_IMAGES,
  isValidWorkspaceName,
  sanitizeWorkspaceName,
} from "../../state/workspaces";
import { listAssets, AssetLike, AssetType } from "../assets/api/assets";
import { listBuiltinTools, BuiltinToolDefinition } from "../../api/builtin-tools";
import { getApiBase } from "../../api/base";

// Vision model info for selection
interface VisionModel {
  id: string;
  name: string;
  model: string;
  provider: string;
}

interface SpaceConfigDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (config: SpaceConfigInput) => void;
  initialConfig: SpaceConfigInput;
  existingNames?: string[];  // List of existing workspace names for uniqueness check
  editingName?: string;      // Current name if editing (to allow keeping same name)
}

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

// Form field label component
function FieldLabel({ label, required }: { label: string; required?: boolean }) {
  return (
    <Typography
      variant="body2"
      sx={{ mb: 0.5, color: "text.secondary", fontSize: 12 }}
    >
      {label}
      {required && <span style={{ color: "#f44336", marginLeft: 2 }}>*</span>}
    </Typography>
  );
}

// Form section component
function FormSection({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <Box
      sx={{
        p: 1.5,
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1,
      }}
    >
      {title && (
        <Typography
          variant="subtitle2"
          sx={{ mb: 1.5, color: "text.primary", fontWeight: 500 }}
        >
          {title}
        </Typography>
      )}
      {children}
    </Box>
  );
}

// Chip list input component for restrictions
function ChipListInput({
  label,
  items,
  onAdd,
  onRemove,
  placeholder,
  chipColor = "default",
}: {
  label: string;
  items: string[];
  onAdd: (item: string) => void;
  onRemove: (item: string) => void;
  placeholder: string;
  chipColor?: "default" | "error" | "primary" | "secondary" | "info" | "success" | "warning";
}) {
  return (
    <Box>
      <FieldLabel label={label} />
      <Box display="flex" flexWrap="wrap" gap={0.5} mb={1}>
        {items.map((item) => (
          <Chip
            key={item}
            label={item}
            size="small"
            color={chipColor}
            onDelete={() => onRemove(item)}
          />
        ))}
      </Box>
      <TextField
        size="small"
        fullWidth
        placeholder={placeholder}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const input = e.target as HTMLInputElement;
            const value = input.value.trim();
            if (value && !items.includes(value)) {
              onAdd(value);
              input.value = "";
            }
          }
        }}
      />
    </Box>
  );
}

// Environment Variables Editor component
function EnvVarsEditor({
  env,
  onChange,
}: {
  env?: Record<string, string>;
  onChange: (env: Record<string, string> | undefined) => void;
}) {
  const entries = Object.entries(env || {});
  const [newKey, setNewKey] = React.useState("");
  const [newValue, setNewValue] = React.useState("");

  const addEntry = () => {
    if (newKey.trim()) {
      onChange({ ...env, [newKey.trim()]: newValue });
      setNewKey("");
      setNewValue("");
    }
  };

  const removeEntry = (key: string) => {
    const newEnv = { ...env };
    delete newEnv[key];
    onChange(Object.keys(newEnv).length > 0 ? newEnv : undefined);
  };

  const updateEntry = (oldKey: string, newKey: string, value: string) => {
    const newEnv = { ...env };
    if (oldKey !== newKey) {
      delete newEnv[oldKey];
    }
    newEnv[newKey] = value;
    onChange(newEnv);
  };

  return (
    <Box>
      <FieldLabel label="Environment Variables" />
      <Box display="flex" flexDirection="column" gap={0.5}>
        {entries.map(([key, value], idx) => (
          <Box key={idx} display="flex" gap={1} alignItems="center">
            <TextField
              size="small"
              placeholder="KEY"
              value={key}
              onChange={(e) => updateEntry(key, e.target.value, value)}
              sx={{ width: 140 }}
            />
            <Typography color="text.secondary">=</Typography>
            <TextField
              size="small"
              placeholder="value"
              value={value}
              onChange={(e) => updateEntry(key, key, e.target.value)}
              sx={{ flex: 1 }}
            />
            <IconButton size="small" onClick={() => removeEntry(key)}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Box>
        ))}
        <Box display="flex" gap={1} alignItems="center">
          <TextField
            size="small"
            placeholder="NEW_KEY"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            sx={{ width: 140 }}
          />
          <Typography color="text.secondary">=</Typography>
          <TextField
            size="small"
            placeholder="value"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addEntry()}
            sx={{ flex: 1 }}
          />
          <IconButton size="small" onClick={addEntry} disabled={!newKey.trim()}>
            <AddIcon fontSize="small" />
          </IconButton>
        </Box>
      </Box>
    </Box>
  );
}

// Headers Editor component (similar to EnvVarsEditor but for HTTP headers)
function HeadersEditor({
  headers,
  onChange,
}: {
  headers?: Record<string, string>;
  onChange: (headers: Record<string, string> | undefined) => void;
}) {
  const entries = Object.entries(headers || {});
  const [newKey, setNewKey] = React.useState("");
  const [newValue, setNewValue] = React.useState("");

  const addEntry = () => {
    if (newKey.trim()) {
      onChange({ ...headers, [newKey.trim()]: newValue });
      setNewKey("");
      setNewValue("");
    }
  };

  const removeEntry = (key: string) => {
    const newHeaders = { ...headers };
    delete newHeaders[key];
    onChange(Object.keys(newHeaders).length > 0 ? newHeaders : undefined);
  };

  return (
    <Box>
      <FieldLabel label="Custom Headers" />
      <Box display="flex" flexDirection="column" gap={0.5}>
        {entries.map(([key, value], idx) => (
          <Box key={idx} display="flex" gap={1} alignItems="center">
            <TextField
              size="small"
              placeholder="Header-Name"
              value={key}
              sx={{ width: 160 }}
              InputProps={{ readOnly: true }}
            />
            <TextField
              size="small"
              placeholder="value"
              value={value}
              onChange={(e) => {
                const newHeaders = { ...headers, [key]: e.target.value };
                onChange(newHeaders);
              }}
              sx={{ flex: 1 }}
            />
            <IconButton size="small" onClick={() => removeEntry(key)}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Box>
        ))}
        <Box display="flex" gap={1} alignItems="center">
          <TextField
            size="small"
            placeholder="Header-Name"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            sx={{ width: 160 }}
          />
          <TextField
            size="small"
            placeholder="value"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addEntry()}
            sx={{ flex: 1 }}
          />
          <IconButton size="small" onClick={addEntry} disabled={!newKey.trim()}>
            <AddIcon fontSize="small" />
          </IconButton>
        </Box>
      </Box>
    </Box>
  );
}

// Authentication Config Editor
function AuthConfigEditor({
  auth,
  onChange,
}: {
  auth?: MCPAuthConfig;
  onChange: (auth: MCPAuthConfig | undefined) => void;
}) {
  const authType = auth?.type || "none";

  return (
    <Box>
      <FieldLabel label="Authentication" />
      <FormControl size="small" fullWidth sx={{ mb: 1 }}>
        <Select
          value={authType}
          onChange={(e) => {
            const type = e.target.value as MCPAuthConfig["type"];
            if (type === "none") {
              onChange(undefined);
            } else {
              onChange({ type });
            }
          }}
        >
          <MenuItem value="none">None</MenuItem>
          <MenuItem value="bearer">Bearer Token</MenuItem>
          <MenuItem value="basic">Basic Auth</MenuItem>
          <MenuItem value="apiKey">API Key</MenuItem>
        </Select>
      </FormControl>

      {authType === "bearer" && (
        <TextField
          size="small"
          fullWidth
          placeholder="Bearer token"
          type="password"
          value={auth?.token || ""}
          onChange={(e) => onChange({ ...auth, type: "bearer", token: e.target.value })}
        />
      )}

      {authType === "basic" && (
        <Box display="flex" gap={1}>
          <TextField
            size="small"
            placeholder="Username"
            value={auth?.username || ""}
            onChange={(e) => onChange({ ...auth, type: "basic", username: e.target.value })}
            sx={{ flex: 1 }}
          />
          <TextField
            size="small"
            placeholder="Password"
            type="password"
            value={auth?.password || ""}
            onChange={(e) => onChange({ ...auth, type: "basic", password: e.target.value })}
            sx={{ flex: 1 }}
          />
        </Box>
      )}

      {authType === "apiKey" && (
        <Box display="flex" gap={1}>
          <TextField
            size="small"
            placeholder="Header name (default: X-API-Key)"
            value={auth?.apiKeyHeader || ""}
            onChange={(e) => onChange({ ...auth, type: "apiKey", apiKeyHeader: e.target.value || undefined })}
            sx={{ width: 200 }}
          />
          <TextField
            size="small"
            placeholder="API Key value"
            type="password"
            value={auth?.apiKey || ""}
            onChange={(e) => onChange({ ...auth, type: "apiKey", apiKey: e.target.value })}
            sx={{ flex: 1 }}
          />
        </Box>
      )}
    </Box>
  );
}

// Runtime Environment Selector
function RuntimeEnvSelector({
  value,
  onChange,
  label = "Runtime Environment",
}: {
  value?: RuntimeEnv;
  onChange: (env: RuntimeEnv) => void;
  label?: string;
}) {
  return (
    <Box>
      <FieldLabel label={label} />
      <FormControl size="small" fullWidth>
        <Select
          value={value || "workspace"}
          onChange={(e) => onChange(e.target.value as RuntimeEnv)}
        >
          <MenuItem value="workspace">Workspace (Container/Pod)</MenuItem>
          <MenuItem value="local">Local (Host Machine)</MenuItem>
        </Select>
      </FormControl>
      <FormHelperText>
        {value === "local"
          ? "Runs on the host machine where the app is running"
          : "Runs inside the workspace runtime (Docker container or K8s pod)"}
      </FormHelperText>
    </Box>
  );
}

// SSH Restrictions Form
function SSHRestrictionsForm({
  restrictions,
  onChange,
}: {
  restrictions?: SSHRestrictions;
  onChange: (patch: Partial<SSHRestrictions>) => void;
}) {
  return (
    <>
      <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5 }}>
        Terminal & Command Restrictions
      </Typography>
      <ChipListInput
        label="Allowed Commands"
        items={restrictions?.allowedCommands || []}
        onAdd={(cmd) => onChange({ allowedCommands: [...(restrictions?.allowedCommands || []), cmd] })}
        onRemove={(cmd) => onChange({ allowedCommands: restrictions?.allowedCommands?.filter((c) => c !== cmd) })}
        placeholder="Empty = all allowed. Type command and press Enter"
      />
      <ChipListInput
        label="Blocked Commands"
        items={restrictions?.blockedCommands || []}
        onAdd={(cmd) => onChange({ blockedCommands: [...(restrictions?.blockedCommands || []), cmd] })}
        onRemove={(cmd) => onChange({ blockedCommands: restrictions?.blockedCommands?.filter((c) => c !== cmd) })}
        placeholder="e.g. rm, shutdown, reboot"
        chipColor="error"
      />
      <ChipListInput
        label="Allowed Paths"
        items={restrictions?.allowedPaths || []}
        onAdd={(path) => onChange({ allowedPaths: [...(restrictions?.allowedPaths || []), path] })}
        onRemove={(path) => onChange({ allowedPaths: restrictions?.allowedPaths?.filter((p) => p !== path) })}
        placeholder="Empty = all allowed. e.g. /home/user, /var/log"
      />
      <ChipListInput
        label="Blocked Paths"
        items={restrictions?.blockedPaths || []}
        onAdd={(path) => onChange({ blockedPaths: [...(restrictions?.blockedPaths || []), path] })}
        onRemove={(path) => onChange({ blockedPaths: restrictions?.blockedPaths?.filter((p) => p !== path) })}
        placeholder="e.g. /etc/passwd, /root"
        chipColor="error"
      />
      <Divider sx={{ my: 1 }} />
      <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5 }}>
        Session Permissions
      </Typography>
      <Box display="flex" flexWrap="wrap" gap={2}>
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={restrictions?.allowSudo ?? true}
              onChange={(e) => onChange({ allowSudo: e.target.checked })}
            />
          }
          label={<Typography variant="body2">Allow sudo</Typography>}
        />
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={restrictions?.allowScp ?? true}
              onChange={(e) => onChange({ allowScp: e.target.checked })}
            />
          }
          label={<Typography variant="body2">Allow SCP</Typography>}
        />
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={restrictions?.allowSftp ?? true}
              onChange={(e) => onChange({ allowSftp: e.target.checked })}
            />
          }
          label={<Typography variant="body2">Allow SFTP</Typography>}
        />
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={restrictions?.allowPortForwarding ?? false}
              onChange={(e) => onChange({ allowPortForwarding: e.target.checked })}
            />
          }
          label={<Typography variant="body2">Allow Port Forwarding</Typography>}
        />
      </Box>
    </>
  );
}

// Local Restrictions Form
function LocalRestrictionsForm({
  restrictions,
  onChange,
}: {
  restrictions?: LocalRestrictions;
  onChange: (patch: Partial<LocalRestrictions>) => void;
}) {
  return (
    <>
      <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5 }}>
        Terminal & Command Restrictions
      </Typography>
      <ChipListInput
        label="Allowed Commands"
        items={restrictions?.allowedCommands || []}
        onAdd={(cmd) => onChange({ allowedCommands: [...(restrictions?.allowedCommands || []), cmd] })}
        onRemove={(cmd) => onChange({ allowedCommands: restrictions?.allowedCommands?.filter((c) => c !== cmd) })}
        placeholder="Empty = all allowed. Type command and press Enter"
      />
      <ChipListInput
        label="Blocked Commands"
        items={restrictions?.blockedCommands || []}
        onAdd={(cmd) => onChange({ blockedCommands: [...(restrictions?.blockedCommands || []), cmd] })}
        onRemove={(cmd) => onChange({ blockedCommands: restrictions?.blockedCommands?.filter((c) => c !== cmd) })}
        placeholder="e.g. rm, shutdown, reboot"
        chipColor="error"
      />
      <ChipListInput
        label="Allowed Paths"
        items={restrictions?.allowedPaths || []}
        onAdd={(path) => onChange({ allowedPaths: [...(restrictions?.allowedPaths || []), path] })}
        onRemove={(path) => onChange({ allowedPaths: restrictions?.allowedPaths?.filter((p) => p !== path) })}
        placeholder="Empty = all allowed. e.g. /home/user, /tmp"
      />
      <ChipListInput
        label="Blocked Paths"
        items={restrictions?.blockedPaths || []}
        onAdd={(path) => onChange({ blockedPaths: [...(restrictions?.blockedPaths || []), path] })}
        onRemove={(path) => onChange({ blockedPaths: restrictions?.blockedPaths?.filter((p) => p !== path) })}
        placeholder="e.g. /etc, /root, /var"
        chipColor="error"
      />
      <Divider sx={{ my: 1 }} />
      <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5 }}>
        Permissions
      </Typography>
      <Box display="flex" flexWrap="wrap" gap={2}>
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={restrictions?.allowSudo ?? false}
              onChange={(e) => onChange({ allowSudo: e.target.checked })}
            />
          }
          label={<Typography variant="body2">Allow sudo</Typography>}
        />
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={restrictions?.allowNetworkAccess ?? true}
              onChange={(e) => onChange({ allowNetworkAccess: e.target.checked })}
            />
          }
          label={<Typography variant="body2">Allow network commands</Typography>}
        />
      </Box>
    </>
  );
}

// Docker Restrictions Form
function DockerRestrictionsForm({
  restrictions,
  onChange,
}: {
  restrictions?: DockerRestrictions;
  onChange: (patch: Partial<DockerRestrictions>) => void;
}) {
  return (
    <>
      <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5 }}>
        Container Restrictions
      </Typography>
      <ChipListInput
        label="Allowed Containers"
        items={restrictions?.allowedContainers || []}
        onAdd={(c) => onChange({ allowedContainers: [...(restrictions?.allowedContainers || []), c] })}
        onRemove={(c) => onChange({ allowedContainers: restrictions?.allowedContainers?.filter((x) => x !== c) })}
        placeholder="Empty = all allowed. Container name or ID"
      />
      <ChipListInput
        label="Blocked Containers"
        items={restrictions?.blockedContainers || []}
        onAdd={(c) => onChange({ blockedContainers: [...(restrictions?.blockedContainers || []), c] })}
        onRemove={(c) => onChange({ blockedContainers: restrictions?.blockedContainers?.filter((x) => x !== c) })}
        placeholder="e.g. production-db, critical-service"
        chipColor="error"
      />
      <Divider sx={{ my: 1 }} />
      <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5 }}>
        Terminal Restrictions (for container exec)
      </Typography>
      <ChipListInput
        label="Allowed Commands"
        items={restrictions?.allowedCommands || []}
        onAdd={(cmd) => onChange({ allowedCommands: [...(restrictions?.allowedCommands || []), cmd] })}
        onRemove={(cmd) => onChange({ allowedCommands: restrictions?.allowedCommands?.filter((c) => c !== cmd) })}
        placeholder="Empty = all allowed. Type command and press Enter"
      />
      <ChipListInput
        label="Blocked Commands"
        items={restrictions?.blockedCommands || []}
        onAdd={(cmd) => onChange({ blockedCommands: [...(restrictions?.blockedCommands || []), cmd] })}
        onRemove={(cmd) => onChange({ blockedCommands: restrictions?.blockedCommands?.filter((c) => c !== cmd) })}
        placeholder="e.g. rm -rf, dd"
        chipColor="error"
      />
      <Divider sx={{ my: 1 }} />
      <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5 }}>
        Operation Permissions
      </Typography>
      <Box display="flex" flexWrap="wrap" gap={2}>
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={restrictions?.allowContainerExec ?? true}
              onChange={(e) => onChange({ allowContainerExec: e.target.checked })}
            />
          }
          label={<Typography variant="body2">Exec into containers</Typography>}
        />
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={restrictions?.allowContainerCreate ?? false}
              onChange={(e) => onChange({ allowContainerCreate: e.target.checked })}
            />
          }
          label={<Typography variant="body2">Create containers</Typography>}
        />
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={restrictions?.allowContainerDelete ?? false}
              onChange={(e) => onChange({ allowContainerDelete: e.target.checked })}
            />
          }
          label={<Typography variant="body2">Delete containers</Typography>}
        />
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={restrictions?.allowImagePull ?? false}
              onChange={(e) => onChange({ allowImagePull: e.target.checked })}
            />
          }
          label={<Typography variant="body2">Pull images</Typography>}
        />
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={restrictions?.allowImageDelete ?? false}
              onChange={(e) => onChange({ allowImageDelete: e.target.checked })}
            />
          }
          label={<Typography variant="body2">Delete images</Typography>}
        />
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={restrictions?.allowPrivileged ?? false}
              onChange={(e) => onChange({ allowPrivileged: e.target.checked })}
            />
          }
          label={<Typography variant="body2">Allow privileged</Typography>}
        />
      </Box>
    </>
  );
}

// Tool type labels
const toolTypeLabels: Record<ToolType, string> = {
  "mcp-stdio": "MCP (Local)",
  "mcp-sse": "MCP (SSE)",
  "mcp-http": "MCP (HTTP)",
  "openapi": "OpenAPI",
  "script": "Script",
  "browser-service": "Browser Service",
  "builtin": "Built-in",
};

// Tool Config Item Component
function ToolConfigItem({
  tool,
  expanded,
  onToggle,
  onUpdate,
  onRemove,
  visionModels = [],
}: {
  tool: ToolConfig;
  expanded: boolean;
  onToggle: () => void;
  onUpdate: (patch: Partial<ToolConfig>) => void;
  onRemove: () => void;
  visionModels?: VisionModel[];
}) {
  return (
    <Box
      sx={{
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1,
        bgcolor: "background.default",
      }}
    >
      {/* Tool Header */}
      <Box
        display="flex"
        alignItems="center"
        gap={1}
        p={1.5}
        sx={{ cursor: "pointer" }}
        onClick={onToggle}
      >
        <Switch
          size="small"
          checked={tool.enabled !== false}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onUpdate({ enabled: e.target.checked })}
        />
        <Box flex={1}>
          <Typography variant="body2" fontWeight={500}>
            {tool.name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {toolTypeLabels[tool.type]} {tool.description && `· ${tool.description}`}
          </Typography>
        </Box>
        <IconButton
          size="small"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <DeleteIcon fontSize="small" />
        </IconButton>
        {expanded ? (
          <ExpandLessIcon fontSize="small" color="action" />
        ) : (
          <ExpandMoreIcon fontSize="small" color="action" />
        )}
      </Box>

      {/* Tool Configuration (Collapsible) */}
      <Collapse in={expanded}>
        <Divider />
        <Box p={1.5} display="flex" flexDirection="column" gap={1.5}>
          {/* Basic Info */}
          <Box display="flex" gap={2}>
            <Box flex={1}>
              <FieldLabel label="Name" />
              <TextField
                size="small"
                fullWidth
                value={tool.name}
                onChange={(e) => onUpdate({ name: e.target.value })}
              />
            </Box>
            <Box flex={1}>
              <FieldLabel label="Description" />
              <TextField
                size="small"
                fullWidth
                value={tool.description || ""}
                onChange={(e) => onUpdate({ description: e.target.value })}
              />
            </Box>
          </Box>

          {/* MCP stdio config */}
          {tool.type === "mcp-stdio" && (
            <>
              <Box display="flex" gap={2}>
                <Box flex={1}>
                  <FieldLabel label="Command" />
                  <TextField
                    size="small"
                    fullWidth
                    placeholder="e.g. npx, python, node"
                    value={tool.mcpStdio?.command || ""}
                    onChange={(e) =>
                      onUpdate({ mcpStdio: { ...tool.mcpStdio, command: e.target.value } })
                    }
                  />
                </Box>
                <Box flex={2}>
                  <FieldLabel label="Arguments" />
                  <TextField
                    size="small"
                    fullWidth
                    placeholder="Space-separated arguments"
                    value={tool.mcpStdio?.args?.join(" ") || ""}
                    onChange={(e) =>
                      onUpdate({
                        mcpStdio: {
                          ...tool.mcpStdio,
                          command: tool.mcpStdio?.command || "",
                          args: e.target.value.trim() ? e.target.value.trim().split(/\s+/) : [],
                        },
                      })
                    }
                  />
                </Box>
              </Box>
              <Box display="flex" gap={2}>
                <Box flex={1}>
                  <FieldLabel label="Working Directory" />
                  <TextField
                    size="small"
                    fullWidth
                    placeholder="Optional working directory"
                    value={tool.mcpStdio?.cwd || ""}
                    onChange={(e) =>
                      onUpdate({ mcpStdio: { ...tool.mcpStdio, command: tool.mcpStdio?.command || "", cwd: e.target.value || undefined } })
                    }
                  />
                </Box>
                <Box flex={1}>
                  <RuntimeEnvSelector
                    value={tool.mcpStdio?.runtimeEnv}
                    onChange={(env) =>
                      onUpdate({ mcpStdio: { ...tool.mcpStdio, command: tool.mcpStdio?.command || "", runtimeEnv: env } })
                    }
                  />
                </Box>
              </Box>
              <EnvVarsEditor
                env={tool.mcpStdio?.env}
                onChange={(env) =>
                  onUpdate({ mcpStdio: { ...tool.mcpStdio, command: tool.mcpStdio?.command || "", env } })
                }
              />
            </>
          )}

          {/* MCP SSE config */}
          {tool.type === "mcp-sse" && (
            <>
              <Box>
                <FieldLabel label="SSE Endpoint URL" />
                <TextField
                  size="small"
                  fullWidth
                  placeholder="https://example.com/mcp/sse"
                  value={tool.mcpSse?.url || ""}
                  onChange={(e) => onUpdate({ mcpSse: { ...tool.mcpSse, url: e.target.value } })}
                />
              </Box>
              <Box display="flex" gap={2}>
                <Box flex={1}>
                  <FieldLabel label="Timeout (ms)" />
                  <TextField
                    size="small"
                    fullWidth
                    type="number"
                    placeholder="30000"
                    value={tool.mcpSse?.timeout || ""}
                    onChange={(e) =>
                      onUpdate({ mcpSse: { ...tool.mcpSse, url: tool.mcpSse?.url || "", timeout: e.target.value ? parseInt(e.target.value) : undefined } })
                    }
                  />
                </Box>
                <Box flex={1}>
                  <Box display="flex" alignItems="center" gap={1} mt={2.5}>
                    <Switch
                      size="small"
                      checked={tool.mcpSse?.reconnect !== false}
                      onChange={(e) =>
                        onUpdate({ mcpSse: { ...tool.mcpSse, url: tool.mcpSse?.url || "", reconnect: e.target.checked } })
                      }
                    />
                    <Typography variant="body2">Auto-reconnect</Typography>
                  </Box>
                </Box>
              </Box>
              <AuthConfigEditor
                auth={tool.mcpSse?.auth}
                onChange={(auth) =>
                  onUpdate({ mcpSse: { ...tool.mcpSse, url: tool.mcpSse?.url || "", auth } })
                }
              />
              <HeadersEditor
                headers={tool.mcpSse?.headers}
                onChange={(headers) =>
                  onUpdate({ mcpSse: { ...tool.mcpSse, url: tool.mcpSse?.url || "", headers } })
                }
              />
            </>
          )}

          {/* MCP HTTP config */}
          {tool.type === "mcp-http" && (
            <>
              <Box>
                <FieldLabel label="HTTP Endpoint URL" />
                <TextField
                  size="small"
                  fullWidth
                  placeholder="https://example.com/mcp"
                  value={tool.mcpHttp?.url || ""}
                  onChange={(e) => onUpdate({ mcpHttp: { ...tool.mcpHttp, url: e.target.value } })}
                />
              </Box>
              <Box display="flex" gap={2}>
                <Box flex={1}>
                  <FieldLabel label="Timeout (ms)" />
                  <TextField
                    size="small"
                    fullWidth
                    type="number"
                    placeholder="30000"
                    value={tool.mcpHttp?.timeout || ""}
                    onChange={(e) =>
                      onUpdate({ mcpHttp: { ...tool.mcpHttp, url: tool.mcpHttp?.url || "", timeout: e.target.value ? parseInt(e.target.value) : undefined } })
                    }
                  />
                </Box>
                <Box flex={1}>
                  <FieldLabel label="Retries" />
                  <TextField
                    size="small"
                    fullWidth
                    type="number"
                    placeholder="3"
                    value={tool.mcpHttp?.retries || ""}
                    onChange={(e) =>
                      onUpdate({ mcpHttp: { ...tool.mcpHttp, url: tool.mcpHttp?.url || "", retries: e.target.value ? parseInt(e.target.value) : undefined } })
                    }
                  />
                </Box>
              </Box>
              <AuthConfigEditor
                auth={tool.mcpHttp?.auth}
                onChange={(auth) =>
                  onUpdate({ mcpHttp: { ...tool.mcpHttp, url: tool.mcpHttp?.url || "", auth } })
                }
              />
              <HeadersEditor
                headers={tool.mcpHttp?.headers}
                onChange={(headers) =>
                  onUpdate({ mcpHttp: { ...tool.mcpHttp, url: tool.mcpHttp?.url || "", headers } })
                }
              />
            </>
          )}

          {/* OpenAPI config */}
          {tool.type === "openapi" && (
            <>
              <Box>
                <FieldLabel label="OpenAPI Spec URL" />
                <TextField
                  size="small"
                  fullWidth
                  placeholder="https://api.example.com/openapi.json"
                  value={tool.openapi?.specUrl || ""}
                  onChange={(e) => onUpdate({ openapi: { ...tool.openapi, specUrl: e.target.value } })}
                />
              </Box>
              <Box>
                <FieldLabel label="Base URL Override" />
                <TextField
                  size="small"
                  fullWidth
                  placeholder="Optional: override API base URL"
                  value={tool.openapi?.baseUrl || ""}
                  onChange={(e) => onUpdate({ openapi: { ...tool.openapi, baseUrl: e.target.value || undefined } })}
                />
              </Box>
            </>
          )}

          {/* Script config */}
          {tool.type === "script" && (
            <>
              <Box display="flex" gap={2}>
                <Box sx={{ minWidth: 120 }}>
                  <FieldLabel label="Runtime" />
                  <FormControl size="small" fullWidth>
                    <Select
                      value={tool.script?.runtime || "python"}
                      onChange={(e) =>
                        onUpdate({
                          script: { ...tool.script, runtime: e.target.value as ScriptConfig["runtime"] },
                        })
                      }
                    >
                      <MenuItem value="python">Python</MenuItem>
                      <MenuItem value="node">Node.js</MenuItem>
                      <MenuItem value="shell">Shell</MenuItem>
                      <MenuItem value="deno">Deno</MenuItem>
                      <MenuItem value="bun">Bun</MenuItem>
                    </Select>
                  </FormControl>
                </Box>
                <Box flex={1}>
                  <FieldLabel label="Script Path" />
                  <TextField
                    size="small"
                    fullWidth
                    placeholder="Path to script file"
                    value={tool.script?.scriptPath || ""}
                    onChange={(e) =>
                      onUpdate({
                        script: { ...tool.script, runtime: tool.script?.runtime || "python", scriptPath: e.target.value || undefined },
                      })
                    }
                  />
                </Box>
              </Box>
              <Box display="flex" gap={2}>
                <Box flex={1}>
                  <FieldLabel label="Working Directory" />
                  <TextField
                    size="small"
                    fullWidth
                    placeholder="Optional working directory"
                    value={tool.script?.cwd || ""}
                    onChange={(e) =>
                      onUpdate({
                        script: { ...tool.script, runtime: tool.script?.runtime || "python", cwd: e.target.value || undefined },
                      })
                    }
                  />
                </Box>
                <Box flex={1}>
                  <FieldLabel label="Timeout (ms)" />
                  <TextField
                    size="small"
                    fullWidth
                    type="number"
                    placeholder="60000"
                    value={tool.script?.timeout || ""}
                    onChange={(e) =>
                      onUpdate({
                        script: { ...tool.script, runtime: tool.script?.runtime || "python", timeout: e.target.value ? parseInt(e.target.value) : undefined },
                      })
                    }
                  />
                </Box>
              </Box>
              <RuntimeEnvSelector
                value={tool.script?.runtimeEnv}
                onChange={(env) =>
                  onUpdate({
                    script: { ...tool.script, runtime: tool.script?.runtime || "python", runtimeEnv: env },
                  })
                }
              />
              <EnvVarsEditor
                env={tool.script?.env}
                onChange={(env) =>
                  onUpdate({
                    script: { ...tool.script, runtime: tool.script?.runtime || "python", env },
                  })
                }
              />
            </>
          )}

          {/* Browser Service config */}
          {tool.type === "browser-service" && (
            <>
              <Box display="flex" gap={2}>
                <Box sx={{ minWidth: 140 }}>
                  <FieldLabel label="Provider" />
                  <FormControl size="small" fullWidth>
                    <Select
                      value={tool.browserService?.provider || "browserless"}
                      onChange={(e) =>
                        onUpdate({
                          browserService: {
                            ...tool.browserService,
                            provider: e.target.value as BrowserServiceConfig["provider"],
                          },
                        })
                      }
                    >
                      <MenuItem value="browserless">Browserless</MenuItem>
                      <MenuItem value="browserbase">BrowserBase</MenuItem>
                      <MenuItem value="steel">Steel</MenuItem>
                      <MenuItem value="hyperbrowser">Hyperbrowser</MenuItem>
                      <MenuItem value="custom">Custom</MenuItem>
                    </Select>
                  </FormControl>
                </Box>
                <Box flex={1}>
                  <FieldLabel label="API Key" />
                  <TextField
                    size="small"
                    fullWidth
                    type="password"
                    placeholder="Your API key"
                    value={tool.browserService?.apiKey || ""}
                    onChange={(e) =>
                      onUpdate({
                        browserService: {
                          ...tool.browserService,
                          provider: tool.browserService?.provider || "browserless",
                          apiKey: e.target.value || undefined,
                        },
                      })
                    }
                  />
                </Box>
              </Box>
              {tool.browserService?.provider === "custom" && (
                <Box>
                  <FieldLabel label="Endpoint URL" />
                  <TextField
                    size="small"
                    fullWidth
                    placeholder="https://your-browser-service.com/api"
                    value={tool.browserService?.endpoint || ""}
                    onChange={(e) =>
                      onUpdate({
                        browserService: {
                          ...tool.browserService,
                          provider: "custom",
                          endpoint: e.target.value || undefined,
                        },
                      })
                    }
                  />
                </Box>
              )}
            </>
          )}

          {/* Builtin tool config - vision model selector only for browser_get_visual_state */}
          {tool.type === "builtin" && tool.builtin?.toolId === "browser_get_visual_state" && (
            <Box>
              <FieldLabel label="Vision Model" required />
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
                Select a vision model for the analyze_image feature
              </Typography>
              <FormControl size="small" fullWidth error={!tool.builtin?.options?.vision_model_id}>
                <Select
                  value={tool.builtin?.options?.vision_model_id || ""}
                  displayEmpty
                  onChange={(e) =>
                    onUpdate({
                      builtin: {
                        ...tool.builtin,
                        toolId: tool.builtin?.toolId || "",
                        options: {
                          ...tool.builtin?.options,
                          vision_model_id: e.target.value || undefined,
                        },
                      },
                    })
                  }
                >
                  <MenuItem value="" disabled>
                    <em>Select a vision model...</em>
                  </MenuItem>
                  {visionModels.map((m) => (
                    <MenuItem key={m.id} value={m.id}>
                      {m.name} ({m.provider})
                    </MenuItem>
                  ))}
                </Select>
                {!tool.builtin?.options?.vision_model_id && (
                  <FormHelperText>Vision model is required for this tool</FormHelperText>
                )}
              </FormControl>
              {visionModels.length === 0 && (
                <Typography variant="caption" color="warning.main" sx={{ mt: 0.5, display: "block" }}>
                  No vision models found. Add a model with task_types=image_understanding.
                </Typography>
              )}
            </Box>
          )}

          {/* AI Hint */}
          <Box>
            <FieldLabel label="AI Hint" />
            <TextField
              size="small"
              fullWidth
              multiline
              minRows={2}
              placeholder="Describe this tool for AI: what it does, when to use it, any special instructions..."
              value={tool.aiHint || ""}
              onChange={(e) => onUpdate({ aiHint: e.target.value })}
            />
          </Box>
        </Box>
      </Collapse>
    </Box>
  );
}

const createHostAsset = (): HostAssetConfig => ({
  id: uid(),
  name: "",
  address: "",
  allowedServices: [],
});

const createK8sAsset = (): K8sAssetConfig => ({
  id: uid(),
  name: "",
  namespace: "default",
  allowedServices: [],
});

const createTool = (): ToolConfig => ({
  id: uid(),
  name: "",
  type: "mcp-stdio",
  description: "",
  enabled: true,
});

const runtimeTypeLabels: Record<RuntimeType, { label: string; icon: React.ReactNode; description: string }> = {
  local: {
    label: "Local",
    icon: <ComputerIcon fontSize="small" />,
    description: "Run directly on your local machine",
  },
  "docker-local": {
    label: "Docker (Local)",
    icon: <ViewInArIcon fontSize="small" />,
    description: "Run in a Docker container on local machine",
  },
  "docker-remote": {
    label: "Docker (Remote)",
    icon: <CloudIcon fontSize="small" />,
    description: "Run in a Docker container on remote host via SSH",
  },
};

const SpaceConfigDialog: React.FC<SpaceConfigDialogProps> = ({
  open,
  onClose,
  onSave,
  initialConfig,
  existingNames = [],
  editingName,
}) => {
  const [tab, setTab] = useState(0);
  const [state, setState] = useState<SpaceConfigInput>(initialConfig);
  const [hostServiceInput, setHostServiceInput] = useState<Record<string, string>>({});
  const [k8sServiceInput, setK8sServiceInput] = useState<Record<string, string>>({});

  // Reset state when dialog opens with new initialConfig
  useEffect(() => {
    if (open) {
      setState(initialConfig);
      setTab(0); // Reset to first tab
    }
  }, [open, initialConfig]);

  // Container selection state
  const [containerMode, setContainerMode] = useState<ContainerMode>("new");
  const [containers, setContainers] = useState<Array<{ id: string; name: string; image: string; status: string }>>([]);
  const [loadingContainers, setLoadingContainers] = useState(false);
  const [customImage, setCustomImage] = useState("");
  const [selectedPresetImage, setSelectedPresetImage] = useState<string>("");

  // Docker host assets state
  const [dockerHostAssets, setDockerHostAssets] = useState<AssetLike[]>([]);
  const [loadingDockerHosts, setLoadingDockerHosts] = useState(false);

  // All assets for Assets tab
  const [allAssets, setAllAssets] = useState<AssetLike[]>([]);
  const [loadingAllAssets, setLoadingAllAssets] = useState(false);
  const [assetTypeFilter, setAssetTypeFilter] = useState<string>("all");
  const [expandedAssetId, setExpandedAssetId] = useState<string | null>(null);

  // Tools tab state
  const [expandedToolId, setExpandedToolId] = useState<string | null>(null);
  const [toolSource, setToolSource] = useState<"builtin" | "manual">("builtin");
  const [newToolType, setNewToolType] = useState<ToolType>("mcp-stdio");
  const [newToolName, setNewToolName] = useState("");
  const [newToolUrl, setNewToolUrl] = useState("");
  const [newMcpCommand, setNewMcpCommand] = useState("");
  const [newMcpArgs, setNewMcpArgs] = useState("");
  const [newScriptRuntime, setNewScriptRuntime] = useState<ScriptConfig["runtime"]>("python");
  const [newBrowserProvider, setNewBrowserProvider] = useState<BrowserServiceConfig["provider"]>("browserless");
  const [newBrowserApiKey, setNewBrowserApiKey] = useState("");

  // Built-in tools from backend
  const [builtinTools, setBuiltinTools] = useState<BuiltinToolDefinition[]>([]);
  const [loadingBuiltinTools, setLoadingBuiltinTools] = useState(false);
  const [selectedBuiltinTools, setSelectedBuiltinTools] = useState<Set<string>>(new Set());
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set()); // Default: all collapsed

  // Vision models for browser_get_visual_state tool
  const [visionModels, setVisionModels] = useState<VisionModel[]>([]);
  const [loadingVisionModels, setLoadingVisionModels] = useState(false);


  // Asset type icons
  const getAssetIcon = (type: string) => {
    switch (type) {
      case "ssh":
        return <TerminalIcon fontSize="small" />;
      case "docker_host":
        return <ViewInArIcon fontSize="small" />;
      case "local":
        return <ComputerIcon fontSize="small" />;
      default:
        return <StorageIcon fontSize="small" />;
    }
  };

  // Fetch all assets for Assets tab
  const fetchAllAssets = useCallback(async (type?: string) => {
    setLoadingAllAssets(true);
    try {
      const assets = await listAssets(type && type !== "all" ? type as AssetType : undefined);
      // Filter out folders
      setAllAssets(assets.filter((a) => a.type !== "folder"));
    } catch (error) {
      console.error("Failed to fetch assets:", error);
      setAllAssets([]);
    } finally {
      setLoadingAllAssets(false);
    }
  }, []);

  // Fetch assets when dialog opens or filter changes
  useEffect(() => {
    if (open && tab === 1) {
      fetchAllAssets(assetTypeFilter);
    }
  }, [open, tab, assetTypeFilter, fetchAllAssets]);

  // Fetch built-in tools when Tools tab is active
  useEffect(() => {
    if (open && tab === 2 && builtinTools.length === 0 && !loadingBuiltinTools) {
      setLoadingBuiltinTools(true);
      listBuiltinTools()
        .then((res) => setBuiltinTools(res.tools || []))
        .catch((err) => console.error("Failed to fetch builtin tools:", err))
        .finally(() => setLoadingBuiltinTools(false));
    }
  }, [open, tab, builtinTools.length, loadingBuiltinTools]);

  // Fetch vision models for browser_get_visual_state tool configuration
  useEffect(() => {
    if (open && tab === 2 && visionModels.length === 0 && !loadingVisionModels) {
      setLoadingVisionModels(true);
      fetch(`${getApiBase()}/api/models?task_types=image_understanding`)
        .then((res) => res.json())
        .then((data) => {
          if (data.code === 200 && Array.isArray(data.data)) {
            setVisionModels(data.data);
          }
        })
        .catch((err) => console.error("Failed to fetch vision models:", err))
        .finally(() => setLoadingVisionModels(false));
    }
  }, [open, tab, visionModels.length, loadingVisionModels]);


  // Add asset to workspace
  const addAssetToWorkspace = (asset: AssetLike) => {
    if (!asset.id) return;
    const exists = state.assets.assets?.some((a) => a.assetId === asset.id);
    if (exists) return;

    const assetType = asset.type ?? "unknown";
    const typeMap: Record<string, AssetRestrictions['type']> = {
      ssh: 'ssh',
      local: 'local',
      docker_host: 'docker_host',
      database: 'database',
      k8s: 'k8s',
      redis: 'redis',
    };
    const restrictionType = typeMap[assetType] || 'generic';

    const newAssetRef: WorkspaceAssetRef = {
      id: uid(),
      assetId: asset.id,
      assetType,
      assetName: asset.name ?? "Unnamed Asset",
      aiHint: "",
      restrictions: { type: restrictionType } as AssetRestrictions,
    };

    setState((prev) => ({
      ...prev,
      assets: {
        ...prev.assets,
        assets: [...(prev.assets.assets || []), newAssetRef],
      },
    }));
  };

  // Remove asset from workspace
  const removeAssetFromWorkspace = (refId: string) => {
    setState((prev) => ({
      ...prev,
      assets: {
        ...prev.assets,
        assets: (prev.assets.assets || []).filter((a) => a.id !== refId),
      },
    }));
    if (expandedAssetId === refId) {
      setExpandedAssetId(null);
    }
  };

  // Update asset configuration
  const updateAssetConfig = (refId: string, patch: Partial<WorkspaceAssetRef>) => {
    setState((prev) => ({
      ...prev,
      assets: {
        ...prev.assets,
        assets: (prev.assets.assets || []).map((a) =>
          a.id === refId ? { ...a, ...patch } : a
        ),
      },
    }));
  };

  // Update asset restrictions
  const updateAssetRestrictions = (
    refId: string,
    restrictionsPatch: Partial<AssetRestrictions>
  ) => {
    setState((prev) => ({
      ...prev,
      assets: {
        ...prev.assets,
        assets: (prev.assets.assets || []).map((a) =>
          a.id === refId
            ? { ...a, restrictions: { ...a.restrictions, ...restrictionsPatch } as AssetRestrictions }
            : a
        ),
      },
    }));
  };

  // Initialize restrictions with correct type
  const initializeRestrictions = (refId: string, assetType: string) => {
    const typeMap: Record<string, AssetRestrictions['type']> = {
      ssh: 'ssh',
      local: 'local',
      docker_host: 'docker_host',
      database: 'database',
      k8s: 'k8s',
      redis: 'redis',
    };
    const restrictionType = typeMap[assetType] || 'generic';
    updateAssetRestrictions(refId, { type: restrictionType } as AssetRestrictions);
  };

  // Tool management functions
  const updateTool = (toolId: string, patch: Partial<ToolConfig>) => {
    setState((prev) => ({
      ...prev,
      tools: prev.tools.map((t) => (t.id === toolId ? { ...t, ...patch } : t)),
    }));
  };

  // Group tools by type (level 1) and category (level 2) for display
  const groupedTools = useMemo(() => {
    // Level 1: group by tool type
    const typeGroups: Record<string, {
      label: string;
      categories: Record<string, { label: string; tools: ToolConfig[] }>;
    }> = {};

    for (const tool of state.tools) {
      const toolType = tool.type;
      const typeLabel = toolTypeLabels[toolType] || toolType;

      if (!typeGroups[toolType]) {
        typeGroups[toolType] = { label: typeLabel, categories: {} };
      }

      // Level 2: for builtin tools, group by category; for others, use "default"
      let categoryKey = "default";
      let categoryLabel = "";

      if (toolType === "builtin" && tool.builtin?.toolId) {
        const builtinDef = builtinTools.find((b) => b.id === tool.builtin?.toolId);
        categoryKey = builtinDef?.category || "other";
        const categoryLabels: Record<string, string> = {
          workspace: "Workspace Tools",
          asset: "Remote Asset Tools",
          database: "Database Tools",
          transfer: "Transfer Tools",
          browser: "Browser Tools",
          other: "Other Tools",
        };
        categoryLabel = categoryLabels[categoryKey] || categoryKey;
      }

      if (!typeGroups[toolType].categories[categoryKey]) {
        typeGroups[toolType].categories[categoryKey] = { label: categoryLabel, tools: [] };
      }
      typeGroups[toolType].categories[categoryKey].tools.push(tool);
    }

    // Convert to array and sort: builtin first, then alphabetically
    const sortedTypes = Object.keys(typeGroups).sort((a, b) => {
      if (a === "builtin") return -1;
      if (b === "builtin") return 1;
      return a.localeCompare(b);
    });

    return sortedTypes.map((type) => {
      const group = typeGroups[type];
      const sortedCategories = Object.keys(group.categories).sort();
      return {
        type,
        label: group.label,
        totalTools: Object.values(group.categories).reduce((sum, c) => sum + c.tools.length, 0),
        categories: sortedCategories.map((cat) => ({
          key: cat,
          ...group.categories[cat],
        })),
      };
    });
  }, [state.tools, builtinTools]);

  // State for expanded type groups and category groups (default: all collapsed)
  const [expandedTypeGroups, setExpandedTypeGroups] = useState<Set<string>>(new Set());
  const [expandedCategoryGroups, setExpandedCategoryGroups] = useState<Set<string>>(new Set());

  const toggleTypeGroup = (type: string) => {
    setExpandedTypeGroups((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  const toggleCategoryGroup = (key: string) => {
    setExpandedCategoryGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const removeTool = (toolId: string) => {
    setState((prev) => ({
      ...prev,
      tools: prev.tools.filter((t) => t.id !== toolId),
    }));
    if (expandedToolId === toolId) {
      setExpandedToolId(null);
    }
  };

  const resetNewToolForm = () => {
    setNewToolName("");
    setNewToolUrl("");
    setNewMcpCommand("");
    setNewMcpArgs("");
    setNewBrowserApiKey("");
  };

  const addPresetMCPTool = (preset: typeof PRESET_MCP_SERVERS[number]) => {
    const newTool: ToolConfig = {
      id: uid(),
      name: preset.name,
      type: "mcp-stdio",
      description: preset.description,
      enabled: true,
      mcpStdio: {
        command: preset.config.command,
        args: [...preset.config.args],
      },
    };
    setState((prev) => ({ ...prev, tools: [...prev.tools, newTool] }));
  };

  const addBuiltinTool = (builtin: BuiltinToolDefinition) => {
    const newTool: ToolConfig = {
      id: uid(),
      name: builtin.name,
      type: "builtin",
      description: builtin.description,
      enabled: true,
      builtin: { toolId: builtin.id },
    };
    setState((prev) => ({ ...prev, tools: [...prev.tools, newTool] }));
  };

  // Batch add selected builtin tools
  const addSelectedBuiltinTools = () => {
    const toolsToAdd = builtinTools.filter(
      (t) => selectedBuiltinTools.has(t.id) && !state.tools.some((st) => st.type === "builtin" && st.builtin?.toolId === t.id)
    );
    const newTools: ToolConfig[] = toolsToAdd.map((builtin) => ({
      id: uid(),
      name: builtin.name,
      type: "builtin" as ToolType,
      description: builtin.description,
      enabled: true,
      builtin: { toolId: builtin.id },
    }));
    setState((prev) => ({ ...prev, tools: [...prev.tools, ...newTools] }));
    setSelectedBuiltinTools(new Set());
  };

  // Add all tools in a category
  const addCategoryTools = (category: string) => {
    const categoryTools = builtinTools.filter(
      (t) => t.category === category && !state.tools.some((st) => st.type === "builtin" && st.builtin?.toolId === t.id)
    );
    const newTools: ToolConfig[] = categoryTools.map((builtin) => ({
      id: uid(),
      name: builtin.name,
      type: "builtin" as ToolType,
      description: builtin.description,
      enabled: true,
      builtin: { toolId: builtin.id },
    }));
    setState((prev) => ({ ...prev, tools: [...prev.tools, ...newTools] }));
  };

  // Toggle single builtin tool selection
  const toggleBuiltinSelection = (toolId: string) => {
    setSelectedBuiltinTools((prev) => {
      const next = new Set(prev);
      if (next.has(toolId)) {
        next.delete(toolId);
      } else {
        next.add(toolId);
      }
      return next;
    });
  };

  // Toggle all tools in a category
  const toggleCategorySelection = (category: string, checked: boolean) => {
    const categoryToolIds = builtinTools
      .filter((t) => t.category === category && !state.tools.some((st) => st.type === "builtin" && st.builtin?.toolId === t.id))
      .map((t) => t.id);
    setSelectedBuiltinTools((prev) => {
      const next = new Set(prev);
      if (checked) {
        categoryToolIds.forEach((id) => next.add(id));
      } else {
        categoryToolIds.forEach((id) => next.delete(id));
      }
      return next;
    });
  };

  // Toggle category expand/collapse
  const toggleCategoryExpand = (category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };


  const addCustomTool = () => {
    let newTool: ToolConfig = {
      id: uid(),
      name: newToolName,
      type: newToolType,
      enabled: true,
    };

    switch (newToolType) {
      case "mcp-sse":
        newTool.mcpSse = { url: newToolUrl };
        break;
      case "mcp-http":
        newTool.mcpHttp = { url: newToolUrl };
        break;
      case "openapi":
        newTool.openapi = { specUrl: newToolUrl };
        break;
      case "script":
        newTool.script = {
          runtime: newScriptRuntime,
          scriptPath: newToolUrl || undefined,
        };
        break;
      case "browser-service":
        newTool.browserService = {
          provider: newBrowserProvider,
          apiKey: newBrowserApiKey || undefined,
          endpoint: newBrowserProvider === "custom" ? newToolUrl : undefined,
        };
        break;
    }

    setState((prev) => ({ ...prev, tools: [...prev.tools, newTool] }));
    resetNewToolForm();
  };

  const addCustomMcpStdioTool = () => {
    const args = newMcpArgs.trim() ? newMcpArgs.trim().split(/\s+/) : [];
    const newTool: ToolConfig = {
      id: uid(),
      name: newToolName,
      type: "mcp-stdio",
      enabled: true,
      mcpStdio: {
        command: newMcpCommand,
        args,
      },
    };
    setState((prev) => ({ ...prev, tools: [...prev.tools, newTool] }));
    resetNewToolForm();
  };

  // Fetch Docker host assets
  const fetchDockerHostAssets = useCallback(async () => {
    setLoadingDockerHosts(true);
    try {
      const assets = await listAssets("docker_host");
      setDockerHostAssets(assets);
    } catch (error) {
      console.error("Failed to fetch Docker host assets:", error);
      setDockerHostAssets([]);
    } finally {
      setLoadingDockerHosts(false);
    }
  }, []);

  // Fetch Docker hosts when dialog opens (only once)
  useEffect(() => {
    if (open) {
      fetchDockerHostAssets();
    }
  }, [open, fetchDockerHostAssets]);

  // Fetch containers from Docker host asset
  const fetchContainers = useCallback(async (dockerAssetId?: string) => {
    if (!dockerAssetId) return;
    setLoadingContainers(true);
    try {
      const response = await fetch(`/api/assets/${dockerAssetId}/docker/containers?all=true`);
      const json = await response.json();
      if (json.code === 200 && json.data?.containers) {
        setContainers(
          json.data.containers.map((c: any) => ({
            id: c.id,
            name: c.name,
            image: c.image,
            status: c.state, // running, paused, exited, created
          }))
        );
      } else {
        console.error("Failed to fetch containers:", json.message);
        setContainers([]);
      }
    } catch (error) {
      console.error("Failed to fetch containers:", error);
      setContainers([]);
    } finally {
      setLoadingContainers(false);
    }
  }, []);

  // Fetch containers when docker asset changes (not on runtime type change)
  const dockerAssetId = state.runtime.dockerAssetId;
  const runtimeType = state.runtime.type;
  useEffect(() => {
    if (open && dockerAssetId && runtimeType !== "local" && containerMode === "existing") {
      fetchContainers(dockerAssetId);
    }
  }, [open, dockerAssetId, containerMode, fetchContainers]);

  // Reset state when dialog opens with new config
  const initialConfigJson = useMemo(() => JSON.stringify(initialConfig), [initialConfig]);
  useEffect(() => {
    if (open) {
      const config = JSON.parse(initialConfigJson) as SpaceConfigInput;
      setState(config);
      setContainerMode(config.runtime.containerMode || "new");
      setSelectedPresetImage(config.runtime.newContainer?.image || "");
      setCustomImage("");
    }
  }, [open, initialConfigJson]);

  const handleNameChange = (value: string) => {
    const sanitized = sanitizeWorkspaceName(value);
    setState((prev) => ({
      ...prev,
      name: sanitized,
      runtime: {
        ...prev.runtime,
        workDir: {
          ...prev.runtime.workDir,
          path: prev.runtime.type === "local" || prev.runtime.type === "docker-local"
            ? `~/.choraleia/workspaces/${sanitized}`
            : prev.runtime.workDir.path,
        },
      },
    }));
  };

  const handleRuntimeTypeChange = (type: RuntimeType) => {
    const sanitizedName = state.name || "workspace";
    setContainerMode("new");
    setSelectedPresetImage("");
    setCustomImage("");
    setState((prev) => ({
      ...prev,
      runtime: {
        type,
        dockerAssetId: type === "local" ? undefined : prev.runtime.dockerAssetId,
        containerMode: type === "local" ? undefined : "new",
        containerId: type === "local" ? undefined : prev.runtime.containerId,
        newContainer: undefined,
        workDir: {
          path: type === "local"
            ? `~/.choraleia/workspaces/${sanitizedName}`
            : type === "docker-local"
              ? `~/.choraleia/workspaces/${sanitizedName}`
              : "/workspace",
          containerPath: type === "docker-local" ? "/workspace" : undefined,
        },
      },
    }));
  };

  const handleContainerModeChange = (mode: ContainerMode) => {
    setContainerMode(mode);
    setState((prev) => ({
      ...prev,
      runtime: {
        ...prev.runtime,
        containerMode: mode,
        containerId: mode === "existing" ? prev.runtime.containerId : undefined,
        newContainer: mode === "new" ? { image: selectedPresetImage || customImage } : undefined,
      },
    }));
  };

  const handleContainerSelect = (containerId: string) => {
    setState((prev) => ({
      ...prev,
      runtime: {
        ...prev.runtime,
        containerId,
      },
    }));
  };

  const handleImageSelect = (image: string, isCustom: boolean) => {
    if (isCustom) {
      setCustomImage(image);
      setSelectedPresetImage("");
    } else {
      setSelectedPresetImage(image);
      setCustomImage("");
    }
    setState((prev) => ({
      ...prev,
      runtime: {
        ...prev.runtime,
        newContainer: { image, name: prev.runtime.newContainer?.name },
      },
    }));
  };

  const handleNewContainerNameChange = (name: string) => {
    setState((prev) => ({
      ...prev,
      runtime: {
        ...prev.runtime,
        newContainer: {
          image: prev.runtime.newContainer?.image || "",
          name: name || undefined,
        },
      },
    }));
  };

  const handleChange = (patch: Partial<SpaceConfigInput>) => {
    setState((prev) => ({ ...prev, ...patch }));
  };

  const handleRuntimeChange = (patch: Partial<WorkspaceRuntime>) => {
    setState((prev) => ({
      ...prev,
      runtime: { ...prev.runtime, ...patch },
    }));
  };

  const updateHostService = (hostId: string, value: string) => {
    setHostServiceInput((prev) => ({ ...prev, [hostId]: value }));
  };

  const addHostService = (hostId: string) => {
    const value = hostServiceInput[hostId]?.trim();
    if (!value) return;
    setState((prev) => ({
      ...prev,
      assets: {
        ...prev.assets,
        hosts: prev.assets.hosts.map((host) =>
          host.id === hostId && !host.allowedServices.includes(value)
            ? { ...host, allowedServices: [...host.allowedServices, value] }
            : host,
        ),
      },
    }));
    updateHostService(hostId, "");
  };

  const updateK8sService = (clusterId: string, value: string) => {
    setK8sServiceInput((prev) => ({ ...prev, [clusterId]: value }));
  };

  const addK8sService = (clusterId: string) => {
    const value = k8sServiceInput[clusterId]?.trim();
    if (!value) return;
    setState((prev) => ({
      ...prev,
      assets: {
        ...prev.assets,
        k8s: prev.assets.k8s.map((cluster) =>
          cluster.id === clusterId && !cluster.allowedServices.includes(value)
            ? { ...cluster, allowedServices: [...cluster.allowedServices, value] }
            : cluster,
        ),
      },
    }));
    updateK8sService(clusterId, "");
  };

  // Check if name is unique (allow same name when editing)
  const isNameUnique = useMemo(() => {
    if (!state.name) return true;
    const normalizedName = state.name.toLowerCase();
    // If editing and name hasn't changed, it's valid
    if (editingName && editingName.toLowerCase() === normalizedName) return true;
    // Check against existing names
    return !existingNames.some(n => n.toLowerCase() === normalizedName);
  }, [state.name, existingNames, editingName]);

  const nameError = useMemo(() => {
    if (!state.name) return "Name is required";
    if (!isValidWorkspaceName(state.name)) return "Invalid name (use lowercase letters, numbers, hyphens)";
    if (!isNameUnique) return "A workspace with this name already exists";
    return null;
  }, [state.name, isNameUnique]);

  const canSave = useMemo(() => {
    if (!state.name || !isValidWorkspaceName(state.name)) return false;
    if (!isNameUnique) return false;
    if (state.runtime.type !== "local") {
      if (!state.runtime.dockerAssetId) return false;
      if (containerMode === "existing" && !state.runtime.containerId) return false;
      if (containerMode === "new" && !state.runtime.newContainer?.image) return false;
    }
    return true;
  }, [state, containerMode, isNameUnique]);

  const handleSave = () => {
    if (canSave) {
      onSave(state);
    }
  };

  const tabs = ["General", "Assets", "Tools"];

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle sx={{ pb: 0 }}>Space Configuration</DialogTitle>
      <Tabs
        value={tab}
        onChange={(_, value) => setTab(value)}
        sx={{ px: 2, borderBottom: 1, borderColor: "divider" }}
      >
        {tabs.map((label) => (
          <Tab key={label} label={label} sx={{ textTransform: "none", minHeight: 48 }} />
        ))}
      </Tabs>
      <DialogContent sx={{ pt: 2 }}>
        {/* General Tab */}
        {tab === 0 && (
          <Box display="flex" flexDirection="column" gap={2}>
            <FormSection title="Basic Information">
              <Box display="flex" flexDirection="column" gap={1.5}>
                <Box>
                  <FieldLabel label="Name" required />
                  <TextField
                    size="small"
                    fullWidth
                    placeholder="e.g. my-project"
                    value={state.name}
                    onChange={(e) => handleNameChange(e.target.value)}
                    error={!!nameError}
                    helperText={nameError || "Must be DNS compatible (lowercase, alphanumeric, hyphens)"}
                  />
                </Box>
                <Box>
                  <FieldLabel label="Description" />
                  <TextField
                    size="small"
                    fullWidth
                    placeholder="Optional description for this space"
                    value={state.description || ""}
                    onChange={(e) => handleChange({ description: e.target.value })}
                    multiline
                    minRows={2}
                  />
                </Box>
              </Box>
            </FormSection>

            <FormSection title="Environment">
              <Box display="flex" flexDirection="column" gap={1.5}>
                <Box>
                  <FieldLabel label="Runtime Type" required />
                  <FormControl size="small" fullWidth>
                    <Select
                      value={state.runtime.type}
                      onChange={(e) => handleRuntimeTypeChange(e.target.value as RuntimeType)}
                    >
                      {Object.entries(runtimeTypeLabels).map(([key, { label, icon, description }]) => (
                        <MenuItem key={key} value={key}>
                          <Box display="flex" alignItems="center" gap={1}>
                            {icon}
                            <Box>
                              <Typography variant="body2">{label}</Typography>
                              <Typography variant="caption" color="text.secondary">
                                {description}
                              </Typography>
                            </Box>
                          </Box>
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Box>

                {/* Docker Asset Selection */}
                {state.runtime.type !== "local" && (
                  <>
                    <Box>
                      <FieldLabel label="Docker Host" required />
                      <FormControl size="small" fullWidth>
                        <Select
                          value={state.runtime.dockerAssetId || ""}
                          onChange={(e) => {
                            handleRuntimeChange({ dockerAssetId: e.target.value, containerId: undefined });
                            setContainers([]);
                          }}
                          displayEmpty
                          renderValue={(selected) => {
                            if (!selected) {
                              return (
                                <Typography variant="body2" color="text.secondary">
                                  {state.runtime.type === "docker-local"
                                    ? "Select local Docker host..."
                                    : "Select remote Docker host (SSH)..."}
                                </Typography>
                              );
                            }
                            const asset = dockerHostAssets.find((a) => a.id === selected);
                            return asset?.name || selected;
                          }}
                          startAdornment={
                            loadingDockerHosts ? (
                              <InputAdornment position="start">
                                <CircularProgress size={16} />
                              </InputAdornment>
                            ) : null
                          }
                          endAdornment={
                            <InputAdornment position="end">
                              <IconButton
                                size="small"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  fetchDockerHostAssets();
                                }}
                                sx={{ mr: 1 }}
                              >
                                <RefreshIcon fontSize="small" />
                              </IconButton>
                            </InputAdornment>
                          }
                        >
                          <MenuItem value="" disabled>
                            <Typography variant="body2" color="text.secondary">
                              {state.runtime.type === "docker-local"
                                ? "Select local Docker host..."
                                : "Select remote Docker host (SSH)..."}
                            </Typography>
                          </MenuItem>
                          {dockerHostAssets
                            .filter((asset) => {
                              // Filter based on runtime type
                              const config = asset.config as any;
                              if (state.runtime.type === "docker-local") {
                                return !config?.ssh_asset_id; // Local docker has no SSH
                              } else {
                                return !!config?.ssh_asset_id; // Remote docker has SSH
                              }
                            })
                            .map((asset) => (
                              <MenuItem key={asset.id} value={asset.id}>
                                <Box>
                                  <Typography variant="body2">{asset.name}</Typography>
                                  {asset.description && (
                                    <Typography variant="caption" color="text.secondary">
                                      {asset.description}
                                    </Typography>
                                  )}
                                </Box>
                              </MenuItem>
                            ))}
                        </Select>
                      </FormControl>
                      {dockerHostAssets.length === 0 && !loadingDockerHosts && (
                        <FormHelperText>
                          No Docker host assets found. Create one in the Assets page first.
                        </FormHelperText>
                      )}
                    </Box>

                    {/* Container Mode Selection */}
                    <Box>
                      <FieldLabel label="Container" required />
                      <RadioGroup
                        row
                        value={containerMode}
                        onChange={(e) => handleContainerModeChange(e.target.value as ContainerMode)}
                        sx={{ mb: 1 }}
                      >
                        <FormControlLabel
                          value="new"
                          control={<Radio size="small" />}
                          label={<Typography variant="body2">Create new container</Typography>}
                        />
                        <FormControlLabel
                          value="existing"
                          control={<Radio size="small" />}
                          label={<Typography variant="body2">Use existing container</Typography>}
                        />
                      </RadioGroup>

                      {/* Existing Container Selection */}
                      {containerMode === "existing" && (
                        <Box>
                          <FormControl size="small" fullWidth>
                            <Select
                              value={state.runtime.containerId || ""}
                              onChange={(e) => handleContainerSelect(e.target.value)}
                              displayEmpty
                              renderValue={(selected) => {
                                if (!selected) {
                                  return (
                                    <Typography variant="body2" color="text.secondary">
                                      Select a container...
                                    </Typography>
                                  );
                                }
                                const container = containers.find((c) => c.id === selected);
                                return container?.name || selected;
                              }}
                              startAdornment={
                                loadingContainers ? (
                                  <InputAdornment position="start">
                                    <CircularProgress size={16} />
                                  </InputAdornment>
                                ) : null
                              }
                              endAdornment={
                                <InputAdornment position="end">
                                  <IconButton
                                    size="small"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      fetchContainers(state.runtime.dockerAssetId);
                                    }}
                                    sx={{ mr: 1 }}
                                  >
                                    <RefreshIcon fontSize="small" />
                                  </IconButton>
                                </InputAdornment>
                              }
                            >
                              <MenuItem value="" disabled>
                                <Typography variant="body2" color="text.secondary">Select a container...</Typography>
                              </MenuItem>
                              {containers.map((container) => (
                                <MenuItem key={container.id} value={container.id}>
                                  <Box display="flex" alignItems="center" gap={1} width="100%">
                                    <Chip
                                      size="small"
                                      label={container.status}
                                      color={container.status === "running" ? "success" : "default"}
                                      sx={{ height: 20, fontSize: 10 }}
                                    />
                                    <Box flex={1}>
                                      <Typography variant="body2">{container.name}</Typography>
                                      <Typography variant="caption" color="text.secondary">
                                        {container.image} · {container.id.slice(0, 12)}
                                      </Typography>
                                    </Box>
                                  </Box>
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                          {containers.length === 0 && !loadingContainers && (
                            <FormHelperText>
                              No containers found. Select a Docker host first or create a new container.
                            </FormHelperText>
                          )}
                        </Box>
                      )}

                      {/* New Container Configuration */}
                      {containerMode === "new" && (
                        <Box display="flex" flexDirection="column" gap={1.5}>
                          <Box>
                            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: "block" }}>
                              Select a preset image or enter a custom one
                            </Typography>
                            <Autocomplete
                              size="small"
                              freeSolo
                              options={PRESET_DOCKER_IMAGES}
                              getOptionLabel={(option) =>
                                typeof option === "string" ? option : option.value
                              }
                              renderOption={(props, option) => (
                                <li {...props}>
                                  <Box>
                                    <Typography variant="body2">{option.label}</Typography>
                                    <Typography variant="caption" color="text.secondary">
                                      {option.value} · {option.description}
                                    </Typography>
                                  </Box>
                                </li>
                              )}
                              value={
                                selectedPresetImage
                                  ? PRESET_DOCKER_IMAGES.find((img) => img.value === selectedPresetImage) || null
                                  : customImage || null
                              }
                              inputValue={customImage || selectedPresetImage}
                              onInputChange={(_, value, reason) => {
                                if (reason === "input") {
                                  handleImageSelect(value, true);
                                }
                              }}
                              onChange={(_, value) => {
                                if (value && typeof value !== "string") {
                                  handleImageSelect(value.value, false);
                                } else if (typeof value === "string") {
                                  handleImageSelect(value, true);
                                }
                              }}
                              renderInput={(params) => (
                                <TextField
                                  {...params}
                                  placeholder="e.g. ubuntu:22.04 or my-custom-image:latest"
                                />
                              )}
                            />
                          </Box>
                          <Box>
                            <FieldLabel label="Container Name (optional)" />
                            <TextField
                              size="small"
                              fullWidth
                              placeholder={`e.g. ${state.name || "workspace"}-dev`}
                              value={state.runtime.newContainer?.name || ""}
                              onChange={(e) => handleNewContainerNameChange(e.target.value)}
                            />
                            <FormHelperText>
                              Leave empty to auto-generate a name based on workspace name
                            </FormHelperText>
                          </Box>
                        </Box>
                      )}
                    </Box>
                  </>
                )}
              </Box>
            </FormSection>

            <FormSection title="Work Directory">
              <Box display="flex" flexDirection="column" gap={1.5}>
                {state.runtime.type === "local" && (
                  <Box>
                    <FieldLabel label="Local Path" required />
                    <TextField
                      size="small"
                      fullWidth
                      placeholder="e.g. ~/.choraleia/workspaces/my-project"
                      value={state.runtime.workDir.path}
                      onChange={(e) =>
                        handleRuntimeChange({
                          workDir: { ...state.runtime.workDir, path: e.target.value },
                        })
                      }
                    />
                    <FormHelperText>
                      Directory on your local machine for workspace files
                    </FormHelperText>
                  </Box>
                )}

                {state.runtime.type === "docker-local" && (
                  <>
                    <Alert severity="info" sx={{ py: 0.5 }}>
                      For local Docker, you can mount a host directory into the container.
                    </Alert>
                    <Box display="flex" gap={2}>
                      <Box flex={1}>
                        <FieldLabel label="Host Path" />
                        <TextField
                          size="small"
                          fullWidth
                          placeholder="e.g. ~/.choraleia/workspaces/my-project"
                          value={state.runtime.workDir.path}
                          onChange={(e) =>
                            handleRuntimeChange({
                              workDir: { ...state.runtime.workDir, path: e.target.value },
                            })
                          }
                        />
                        <FormHelperText>Local directory to mount (leave empty to use container path only)</FormHelperText>
                      </Box>
                      <Box flex={1}>
                        <FieldLabel label="Container Path" required />
                        <TextField
                          size="small"
                          fullWidth
                          placeholder="e.g. /workspace"
                          value={state.runtime.workDir.containerPath || "/workspace"}
                          onChange={(e) =>
                            handleRuntimeChange({
                              workDir: { ...state.runtime.workDir, containerPath: e.target.value },
                            })
                          }
                        />
                        <FormHelperText>Mount point inside the container</FormHelperText>
                      </Box>
                    </Box>
                  </>
                )}

                {state.runtime.type === "docker-remote" && (
                  <Box>
                    <FieldLabel label="Container Path" required />
                    <TextField
                      size="small"
                      fullWidth
                      placeholder="e.g. /workspace"
                      value={state.runtime.workDir.path}
                      onChange={(e) =>
                        handleRuntimeChange({
                          workDir: { ...state.runtime.workDir, path: e.target.value },
                        })
                      }
                    />
                    <FormHelperText>
                      Path inside the remote container where files are stored
                    </FormHelperText>
                  </Box>
                )}
              </Box>
            </FormSection>
          </Box>
        )}

        {/* Assets Tab */}
        {tab === 1 && (
          <Box display="flex" flexDirection="column" gap={2}>
            {/* Added Assets */}
            <FormSection title="Workspace Assets">
              <Box display="flex" flexDirection="column" gap={1.5}>
                {(!state.assets.assets || state.assets.assets.length === 0) && (
                  <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                    No assets added to this workspace. Add assets from the list below.
                  </Typography>
                )}
                {(state.assets.assets || []).map((assetRef) => (
                  <Box
                    key={assetRef.id}
                    sx={{
                      border: "1px solid",
                      borderColor: "divider",
                      borderRadius: 1,
                      bgcolor: "background.default",
                    }}
                  >
                    {/* Asset Header */}
                    <Box
                      display="flex"
                      alignItems="center"
                      gap={1}
                      p={1.5}
                      sx={{ cursor: "pointer" }}
                      onClick={() =>
                        setExpandedAssetId(expandedAssetId === assetRef.id ? null : assetRef.id)
                      }
                    >
                      {getAssetIcon(assetRef.assetType)}
                      <Box flex={1}>
                        <Typography variant="body2" fontWeight={500}>
                          {assetRef.assetName}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {assetRef.assetType}
                        </Typography>
                      </Box>
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeAssetFromWorkspace(assetRef.id);
                        }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                      {expandedAssetId === assetRef.id ? (
                        <ExpandLessIcon fontSize="small" color="action" />
                      ) : (
                        <ExpandMoreIcon fontSize="small" color="action" />
                      )}
                    </Box>

                    {/* Asset Configuration (Collapsible) */}
                    <Collapse in={expandedAssetId === assetRef.id}>
                      <Divider />
                      <Box p={1.5} display="flex" flexDirection="column" gap={1.5}>
                        {/* AI Hint */}
                        <Box>
                          <FieldLabel label="AI Hint" />
                          <TextField
                            size="small"
                            fullWidth
                            multiline
                            minRows={2}
                            placeholder="Describe this asset for AI: what it is, how to use it, what restrictions apply..."
                            value={assetRef.aiHint || ""}
                            onChange={(e) =>
                              updateAssetConfig(assetRef.id, { aiHint: e.target.value })
                            }
                          />
                          <FormHelperText>
                            This hint helps AI understand how to interact with this asset
                          </FormHelperText>
                        </Box>

                        {/* SSH Restrictions */}
                        {assetRef.assetType === "ssh" && (
                          <SSHRestrictionsForm
                            restrictions={assetRef.restrictions as SSHRestrictions | undefined}
                            onChange={(patch) => updateAssetRestrictions(assetRef.id, patch)}
                          />
                        )}

                        {/* Local Restrictions */}
                        {assetRef.assetType === "local" && (
                          <LocalRestrictionsForm
                            restrictions={assetRef.restrictions as LocalRestrictions | undefined}
                            onChange={(patch) => updateAssetRestrictions(assetRef.id, patch)}
                          />
                        )}

                        {/* Docker Restrictions */}
                        {assetRef.assetType === "docker_host" && (
                          <DockerRestrictionsForm
                            restrictions={assetRef.restrictions as DockerRestrictions | undefined}
                            onChange={(patch) => updateAssetRestrictions(assetRef.id, patch)}
                          />
                        )}
                      </Box>
                    </Collapse>
                  </Box>
                ))}
              </Box>
            </FormSection>

            {/* Available Assets */}
            <FormSection title="Available Assets">
              <Box display="flex" flexDirection="column" gap={1.5}>
                {/* Filter */}
                <Box display="flex" gap={1} alignItems="center">
                  <FormControl size="small" sx={{ minWidth: 140 }}>
                    <Select
                      value={assetTypeFilter}
                      onChange={(e) => setAssetTypeFilter(e.target.value)}
                    >
                      <MenuItem value="all">All Types</MenuItem>
                      <MenuItem value="local">Local</MenuItem>
                      <MenuItem value="ssh">SSH</MenuItem>
                      <MenuItem value="docker_host">Docker</MenuItem>
                    </Select>
                  </FormControl>
                  <IconButton size="small" onClick={() => fetchAllAssets(assetTypeFilter)}>
                    <RefreshIcon fontSize="small" />
                  </IconButton>
                  {loadingAllAssets && <CircularProgress size={16} />}
                </Box>

                {/* Asset List */}
                <Box
                  sx={{
                    maxHeight: 200,
                    overflow: "auto",
                    border: "1px solid",
                    borderColor: "divider",
                    borderRadius: 1,
                  }}
                >
                  {allAssets.length === 0 && !loadingAllAssets && (
                    <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: "center" }}>
                      No assets found. Create assets in the Assets page first.
                    </Typography>
                  )}
                  {allAssets.map((asset) => {
                    const isAdded = state.assets.assets?.some((a) => a.assetId === asset.id);
                    return (
                      <Box
                        key={asset.id}
                        display="flex"
                        alignItems="center"
                        gap={1}
                        px={1.5}
                        py={1}
                        sx={{
                          borderBottom: "1px solid",
                          borderColor: "divider",
                          "&:last-child": { borderBottom: "none" },
                          bgcolor: isAdded ? "action.selected" : "transparent",
                          "&:hover": { bgcolor: isAdded ? "action.selected" : "action.hover" },
                        }}
                      >
                        {getAssetIcon(asset.type ?? "unknown")}
                        <Box flex={1} minWidth={0}>
                          <Typography variant="body2" noWrap>
                            {asset.name ?? "Unnamed"}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" noWrap>
                            {asset.type ?? "unknown"}
                            {asset.description && ` · ${asset.description}`}
                          </Typography>
                        </Box>
                        <Button
                          size="small"
                          variant={isAdded ? "outlined" : "contained"}
                          disabled={isAdded}
                          onClick={() => addAssetToWorkspace(asset)}
                          sx={{ minWidth: 60 }}
                        >
                          {isAdded ? "Added" : "Add"}
                        </Button>
                      </Box>
                    );
                  })}
                </Box>
              </Box>
            </FormSection>
          </Box>
        )}

        {/* Tools Tab */}
        {tab === 2 && (
          <Box display="flex" flexDirection="column" gap={2}>
            {/* Configured Tools - grouped by type (level 1) and category (level 2) */}
            <FormSection title="Workspace Tools">
              <Box display="flex" flexDirection="column" gap={0.5}>
                {state.tools.length === 0 && (
                  <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                    No tools configured. Add MCP servers, APIs, or scripts to extend AI capabilities.
                  </Typography>
                )}
                {groupedTools.map((typeGroup) => {
                  const isTypeExpanded = expandedTypeGroups.has(typeGroup.type);
                  return (
                    <Box
                      key={typeGroup.type}
                      sx={{
                        border: "1px solid",
                        borderColor: "divider",
                        borderRadius: 1,
                        overflow: "hidden",
                      }}
                    >
                      {/* Level 1: Type Header */}
                      <Box
                        display="flex"
                        alignItems="center"
                        gap={1}
                        px={1.5}
                        py={1}
                        sx={{
                          bgcolor: "action.hover",
                          cursor: "pointer",
                          "&:hover": { bgcolor: "action.selected" },
                        }}
                        onClick={() => toggleTypeGroup(typeGroup.type)}
                      >
                        {isTypeExpanded ? (
                          <ExpandLessIcon fontSize="small" />
                        ) : (
                          <ExpandMoreIcon fontSize="small" />
                        )}
                        <Typography variant="body2" fontWeight={600} flex={1}>
                          {typeGroup.label}
                        </Typography>
                        <Chip
                          label={typeGroup.totalTools}
                          size="small"
                          sx={{ height: 20, fontSize: 11 }}
                        />
                      </Box>

                      {/* Level 1 Content */}
                      <Collapse in={isTypeExpanded}>
                        <Box display="flex" flexDirection="column">
                          {typeGroup.categories.map((category) => {
                            const categoryKey = `${typeGroup.type}-${category.key}`;
                            const isCategoryExpanded = expandedCategoryGroups.has(categoryKey);
                            const hasCategory = category.label !== "";

                            // If no category label (non-builtin tools), show tools directly
                            if (!hasCategory) {
                              return (
                                <Box key={category.key} p={1} display="flex" flexDirection="column" gap={1}>
                                  {category.tools.map((tool) => (
                                    <ToolConfigItem
                                      key={tool.id}
                                      tool={tool}
                                      expanded={expandedToolId === tool.id}
                                      onToggle={() => setExpandedToolId(expandedToolId === tool.id ? null : tool.id)}
                                      onUpdate={(patch) => updateTool(tool.id, patch)}
                                      onRemove={() => removeTool(tool.id)}
                                      visionModels={visionModels}
                                    />
                                  ))}
                                </Box>
                              );
                            }

                            // Level 2: Category with collapsible header
                            return (
                              <Box key={category.key}>
                                {/* Level 2: Category Header */}
                                <Box
                                  display="flex"
                                  alignItems="center"
                                  gap={1}
                                  px={2}
                                  py={0.75}
                                  sx={{
                                    borderTop: "1px solid",
                                    borderColor: "divider",
                                    cursor: "pointer",
                                    "&:hover": { bgcolor: "action.hover" },
                                  }}
                                  onClick={() => toggleCategoryGroup(categoryKey)}
                                >
                                  {isCategoryExpanded ? (
                                    <ExpandLessIcon fontSize="small" sx={{ fontSize: 16 }} />
                                  ) : (
                                    <ExpandMoreIcon fontSize="small" sx={{ fontSize: 16 }} />
                                  )}
                                  <Typography variant="body2" fontSize={13} flex={1}>
                                    {category.label}
                                  </Typography>
                                  <Typography variant="caption" color="text.secondary">
                                    {category.tools.length}
                                  </Typography>
                                </Box>

                                {/* Level 2 Content: Tools */}
                                <Collapse in={isCategoryExpanded}>
                                  <Box p={1} pl={2} display="flex" flexDirection="column" gap={1}>
                                    {category.tools.map((tool) => (
                                      <ToolConfigItem
                                        key={tool.id}
                                        tool={tool}
                                        expanded={expandedToolId === tool.id}
                                        onToggle={() => setExpandedToolId(expandedToolId === tool.id ? null : tool.id)}
                                        onUpdate={(patch) => updateTool(tool.id, patch)}
                                        onRemove={() => removeTool(tool.id)}
                                        visionModels={visionModels}
                                      />
                                    ))}
                                  </Box>
                                </Collapse>
                              </Box>
                            );
                          })}
                        </Box>
                      </Collapse>
                    </Box>
                  );
                })}
              </Box>
            </FormSection>

            {/* Add Tool Section */}
            <FormSection title="Add Tool">
              <Box display="flex" flexDirection="column" gap={1.5}>
                {/* Tool Source Selection */}
                <Box>
                  <FieldLabel label="Tool Source" />
                  <Box display="flex" gap={1} mb={1}>
                    {[
                      { source: "builtin" as const, label: "Built-in Tools" },
                      { source: "manual" as const, label: "Preset & Manual" },
                    ].map(({ source, label }) => (
                      <Chip
                        key={source}
                        label={label}
                        variant={toolSource === source ? "filled" : "outlined"}
                        color={toolSource === source ? "primary" : "default"}
                        onClick={() => setToolSource(source)}
                        sx={{ cursor: "pointer" }}
                      />
                    ))}
                  </Box>

                  {/* Manual tool type selection */}
                  {toolSource === "manual" && (
                    <Box display="flex" flexWrap="wrap" gap={0.5}>
                      {[
                        { type: "mcp-stdio", label: "MCP (Stdio)" },
                        { type: "mcp-sse", label: "MCP (SSE)" },
                        { type: "mcp-http", label: "MCP (HTTP)" },
                        { type: "openapi", label: "OpenAPI" },
                        { type: "script", label: "Script" },
                        { type: "browser-service", label: "Browser" },
                      ].map(({ type, label }) => (
                        <Chip
                          key={type}
                          label={label}
                          size="small"
                          variant={newToolType === type ? "filled" : "outlined"}
                          color={newToolType === type ? "secondary" : "default"}
                          onClick={() => setNewToolType(type as ToolType)}
                          sx={{ cursor: "pointer" }}
                        />
                      ))}
                    </Box>
                  )}
                </Box>

                {/* MCP Preset Servers */}
                {toolSource === "manual" && newToolType === "mcp-stdio" && (
                  <Box>
                    <FieldLabel label="Quick Add (MCP Servers)" />
                    <Box
                      sx={{
                        maxHeight: 160,
                        overflow: "auto",
                        border: "1px solid",
                        borderColor: "divider",
                        borderRadius: 1,
                      }}
                    >
                      {PRESET_MCP_SERVERS.map((preset) => {
                        const isAdded = state.tools.some(
                          (t) => t.type === "mcp-stdio" && t.mcpStdio?.command === preset.config.command &&
                            JSON.stringify(t.mcpStdio?.args) === JSON.stringify(preset.config.args)
                        );
                        return (
                          <Box
                            key={preset.id}
                            display="flex"
                            alignItems="center"
                            gap={1}
                            px={1.5}
                            py={1}
                            sx={{
                              borderBottom: "1px solid",
                              borderColor: "divider",
                              "&:last-child": { borderBottom: "none" },
                              "&:hover": { bgcolor: "action.hover" },
                            }}
                          >
                            <Box flex={1}>
                              <Typography variant="body2">{preset.name}</Typography>
                              <Typography variant="caption" color="text.secondary">
                                {preset.description}
                              </Typography>
                            </Box>
                            <Button
                              size="small"
                              variant={isAdded ? "outlined" : "contained"}
                              disabled={isAdded}
                              onClick={() => addPresetMCPTool(preset)}
                              sx={{ minWidth: 60 }}
                            >
                              {isAdded ? "Added" : "Add"}
                            </Button>
                          </Box>
                        );
                      })}
                    </Box>
                  </Box>
                )}

                {/* Built-in Tools */}
                {toolSource === "builtin" && (
                  <Box>
                    <Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
                      <FieldLabel label="Available Built-in Tools" />
                      {selectedBuiltinTools.size > 0 && (
                        <Button
                          size="small"
                          variant="contained"
                          startIcon={<AddIcon />}
                          onClick={addSelectedBuiltinTools}
                        >
                          Add Selected ({selectedBuiltinTools.size})
                        </Button>
                      )}
                    </Box>
                    {loadingBuiltinTools ? (
                      <Box display="flex" justifyContent="center" py={2}>
                        <CircularProgress size={24} />
                      </Box>
                    ) : builtinTools.length === 0 ? (
                      <Typography variant="body2" color="text.secondary" py={2} textAlign="center">
                        No built-in tools available
                      </Typography>
                    ) : (
                      <Box
                        sx={{
                          maxHeight: 320,
                          overflow: "auto",
                          border: "1px solid",
                          borderColor: "divider",
                          borderRadius: 1,
                        }}
                      >
                        {/* Group by category */}
                        {[
                          { id: "workspace", label: "Workspace Tools", desc: "File operations & command execution in workspace" },
                          { id: "asset", label: "Remote Asset Tools", desc: "File operations & commands on remote servers" },
                          { id: "database", label: "Database Tools", desc: "MySQL, PostgreSQL, Redis operations" },
                          { id: "transfer", label: "Transfer Tools", desc: "File transfer between workspace and assets" },
                          { id: "browser", label: "Browser Tools", desc: "Browser automation & web scraping" },
                        ].map(({ id: category, label, desc }) => {
                          const categoryTools = builtinTools.filter((t) => t.category === category);
                          if (categoryTools.length === 0) return null;

                          // Count tools already added to workspace
                          const addedTools = categoryTools.filter((t) =>
                            state.tools.some((st) => st.type === "builtin" && st.builtin?.toolId === t.id)
                          );
                          const addedCount = addedTools.length;

                          // Available tools = not yet added
                          const availableTools = categoryTools.filter((t) =>
                            !state.tools.some((st) => st.type === "builtin" && st.builtin?.toolId === t.id)
                          );

                          // Selected = pending selection (not yet added but checked)
                          const selectedInCategory = availableTools.filter((t) => selectedBuiltinTools.has(t.id)).length;

                          // All tools in category are either added OR selected
                          const allChecked = categoryTools.every((t) =>
                            state.tools.some((st) => st.type === "builtin" && st.builtin?.toolId === t.id) ||
                            selectedBuiltinTools.has(t.id)
                          );

                          // Some (but not all) tools are added or selected
                          const totalCheckedOrAdded = addedCount + selectedInCategory;
                          const someChecked = totalCheckedOrAdded > 0 && totalCheckedOrAdded < categoryTools.length;

                          const isExpanded = expandedCategories.has(category);

                          return (
                            <Box key={category}>
                              {/* Category Header */}
                              <Box
                                display="flex"
                                alignItems="center"
                                gap={0.5}
                                px={1}
                                py={0.75}
                                sx={{
                                  bgcolor: "action.hover",
                                  borderBottom: "1px solid",
                                  borderColor: "divider",
                                  cursor: "pointer",
                                  "&:hover": { bgcolor: "action.selected" },
                                }}
                                onClick={() => toggleCategoryExpand(category)}
                              >
                                <Checkbox
                                  size="small"
                                  checked={allChecked}
                                  indeterminate={someChecked}
                                  disabled={availableTools.length === 0}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={(e) => toggleCategorySelection(category, e.target.checked)}
                                  sx={{ p: 0.25 }}
                                />
                                <Box flex={1} ml={0.5}>
                                  <Box display="flex" alignItems="center" gap={1}>
                                    <Typography variant="body2" fontWeight={600}>
                                      {label}
                                    </Typography>
                                    <Chip
                                      label={`${addedCount}/${categoryTools.length}`}
                                      size="small"
                                      color={addedCount === categoryTools.length ? "success" : "default"}
                                      sx={{ height: 18, fontSize: 10 }}
                                    />
                                  </Box>
                                  <Typography variant="caption" color="text.secondary">
                                    {desc}
                                  </Typography>
                                </Box>
                                <IconButton size="small" sx={{ p: 0.25 }}>
                                  {isExpanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                                </IconButton>
                                <Button
                                  size="small"
                                  variant="text"
                                  disabled={availableTools.length === 0}
                                  onClick={(e) => { e.stopPropagation(); addCategoryTools(category); }}
                                  sx={{ minWidth: 60, fontSize: 11 }}
                                >
                                  Add All
                                </Button>
                              </Box>

                              {/* Category Tools */}
                              <Collapse in={isExpanded}>
                                {categoryTools.map((builtin) => {
                                  const isAdded = state.tools.some(
                                    (t) => t.type === "builtin" && t.builtin?.toolId === builtin.id
                                  );
                                  const isSelected = selectedBuiltinTools.has(builtin.id);
                                  return (
                                    <Box
                                      key={builtin.id}
                                      display="flex"
                                      alignItems="center"
                                      gap={0.5}
                                      pl={2}
                                      pr={1.5}
                                      py={0.5}
                                      sx={{
                                        borderBottom: "1px solid",
                                        borderColor: "divider",
                                        "&:last-child": { borderBottom: "none" },
                                        "&:hover": { bgcolor: "action.hover" },
                                        opacity: isAdded ? 0.5 : 1,
                                      }}
                                    >
                                      <Checkbox
                                        size="small"
                                        checked={isSelected || isAdded}
                                        disabled={isAdded}
                                        onChange={() => toggleBuiltinSelection(builtin.id)}
                                        sx={{ p: 0.25 }}
                                      />
                                      <Box flex={1} ml={0.5}>
                                        <Box display="flex" alignItems="center" gap={0.5}>
                                          <Typography variant="body2" fontSize={13}>
                                            {builtin.name}
                                          </Typography>
                                          {builtin.dangerous && (
                                            <Chip label="Write" size="small" color="warning" sx={{ height: 16, fontSize: 9 }} />
                                          )}
                                          {isAdded && (
                                            <Chip label="Added" size="small" color="success" sx={{ height: 16, fontSize: 9 }} />
                                          )}
                                        </Box>
                                        <Typography variant="caption" color="text.secondary" fontSize={11}>
                                          {builtin.description}
                                        </Typography>
                                      </Box>
                                    </Box>
                                  );
                                })}
                              </Collapse>
                            </Box>
                          );
                        })}
                      </Box>
                    )}
                  </Box>
                )}


                {/* Browser Service Providers */}
                {toolSource === "manual" && newToolType === "browser-service" && (
                  <Box display="flex" flexDirection="column" gap={1.5}>
                    <Box>
                      <FieldLabel label="Browser Service Provider" />
                      <Box
                        sx={{
                          maxHeight: 160,
                          overflow: "auto",
                          border: "1px solid",
                          borderColor: "divider",
                          borderRadius: 1,
                        }}
                      >
                        {BROWSER_SERVICE_PROVIDERS.map((provider) => (
                          <Box
                            key={provider.id}
                            display="flex"
                            alignItems="center"
                            gap={1}
                            px={1.5}
                            py={1}
                            sx={{
                              borderBottom: "1px solid",
                              borderColor: "divider",
                              "&:last-child": { borderBottom: "none" },
                              bgcolor: newBrowserProvider === provider.id ? "action.selected" : "transparent",
                              "&:hover": { bgcolor: newBrowserProvider === provider.id ? "action.selected" : "action.hover" },
                              cursor: "pointer",
                            }}
                            onClick={() => {
                              setNewBrowserProvider(provider.id as BrowserServiceConfig["provider"]);
                              setNewToolName(provider.name);
                            }}
                          >
                            <Radio
                              size="small"
                              checked={newBrowserProvider === provider.id}
                              onChange={() => {
                                setNewBrowserProvider(provider.id as BrowserServiceConfig["provider"]);
                                setNewToolName(provider.name);
                              }}
                            />
                            <Box flex={1}>
                              <Typography variant="body2">{provider.name}</Typography>
                              <Typography variant="caption" color="text.secondary">
                                {provider.description}
                              </Typography>
                            </Box>
                          </Box>
                        ))}
                        {/* Custom provider option */}
                        <Box
                          display="flex"
                          alignItems="center"
                          gap={1}
                          px={1.5}
                          py={1}
                          sx={{
                            bgcolor: newBrowserProvider === "custom" ? "action.selected" : "transparent",
                            "&:hover": { bgcolor: newBrowserProvider === "custom" ? "action.selected" : "action.hover" },
                            cursor: "pointer",
                          }}
                          onClick={() => {
                            setNewBrowserProvider("custom");
                            setNewToolName("Custom Browser");
                          }}
                        >
                          <Radio
                            size="small"
                            checked={newBrowserProvider === "custom"}
                            onChange={() => {
                              setNewBrowserProvider("custom");
                              setNewToolName("Custom Browser");
                            }}
                          />
                          <Box flex={1}>
                            <Typography variant="body2">Custom Provider</Typography>
                            <Typography variant="caption" color="text.secondary">
                              Configure a custom browser service endpoint
                            </Typography>
                          </Box>
                        </Box>
                      </Box>
                    </Box>

                    <Box display="flex" gap={2}>
                      <Box flex={1}>
                        <FieldLabel label="Name" required />
                        <TextField
                          size="small"
                          fullWidth
                          placeholder="e.g. My Browser Service"
                          value={newToolName}
                          onChange={(e) => setNewToolName(e.target.value)}
                        />
                      </Box>
                      <Box flex={1}>
                        <FieldLabel label="API Key" />
                        <TextField
                          size="small"
                          fullWidth
                          type="password"
                          placeholder="Your API key"
                          value={newBrowserApiKey}
                          onChange={(e) => setNewBrowserApiKey(e.target.value)}
                        />
                      </Box>
                    </Box>

                    {newBrowserProvider === "custom" && (
                      <Box>
                        <FieldLabel label="Endpoint URL" required />
                        <TextField
                          size="small"
                          fullWidth
                          placeholder="https://your-browser-service.com/api"
                          value={newToolUrl}
                          onChange={(e) => setNewToolUrl(e.target.value)}
                        />
                      </Box>
                    )}

                    <Button
                      variant="contained"
                      size="small"
                      startIcon={<AddIcon fontSize="small" />}
                      onClick={addCustomTool}
                      disabled={!newToolName || (newBrowserProvider === "custom" && !newToolUrl)}
                      sx={{ alignSelf: "flex-start" }}
                    >
                      Add Browser Service
                    </Button>
                  </Box>
                )}

                {/* Manual Tool Configuration */}
                {toolSource === "manual" && (newToolType === "mcp-sse" || newToolType === "mcp-http" || newToolType === "openapi" || newToolType === "script") && (
                  <Box display="flex" flexDirection="column" gap={1.5}>
                    <Box display="flex" gap={2}>
                      <Box flex={1}>
                        <FieldLabel label="Name" required />
                        <TextField
                          size="small"
                          fullWidth
                          placeholder="e.g. My Custom Tool"
                          value={newToolName}
                          onChange={(e) => setNewToolName(e.target.value)}
                        />
                      </Box>
                    </Box>

                    {/* MCP SSE Config */}
                    {newToolType === "mcp-sse" && (
                      <Box>
                        <FieldLabel label="SSE Endpoint URL" required />
                        <TextField
                          size="small"
                          fullWidth
                          placeholder="https://example.com/mcp/sse"
                          value={newToolUrl}
                          onChange={(e) => setNewToolUrl(e.target.value)}
                        />
                      </Box>
                    )}

                    {/* MCP HTTP Config */}
                    {newToolType === "mcp-http" && (
                      <Box>
                        <FieldLabel label="HTTP Endpoint URL" required />
                        <TextField
                          size="small"
                          fullWidth
                          placeholder="https://example.com/mcp"
                          value={newToolUrl}
                          onChange={(e) => setNewToolUrl(e.target.value)}
                        />
                      </Box>
                    )}

                    {/* OpenAPI Config */}
                    {newToolType === "openapi" && (
                      <Box>
                        <FieldLabel label="OpenAPI Spec URL" required />
                        <TextField
                          size="small"
                          fullWidth
                          placeholder="https://api.example.com/openapi.json"
                          value={newToolUrl}
                          onChange={(e) => setNewToolUrl(e.target.value)}
                        />
                        <FormHelperText>URL to OpenAPI/Swagger specification (JSON or YAML)</FormHelperText>
                      </Box>
                    )}

                    {/* Script Config */}
                    {newToolType === "script" && (
                      <>
                        <Box display="flex" gap={2}>
                          <Box sx={{ minWidth: 120 }}>
                            <FieldLabel label="Runtime" required />
                            <FormControl size="small" fullWidth>
                              <Select
                                value={newScriptRuntime}
                                onChange={(e) => setNewScriptRuntime(e.target.value as ScriptConfig["runtime"])}
                              >
                                <MenuItem value="python">Python</MenuItem>
                                <MenuItem value="node">Node.js</MenuItem>
                                <MenuItem value="shell">Shell</MenuItem>
                                <MenuItem value="deno">Deno</MenuItem>
                                <MenuItem value="bun">Bun</MenuItem>
                              </Select>
                            </FormControl>
                          </Box>
                          <Box flex={1}>
                            <FieldLabel label="Script Path" />
                            <TextField
                              size="small"
                              fullWidth
                              placeholder="Path to script file (or leave empty for inline)"
                              value={newToolUrl}
                              onChange={(e) => setNewToolUrl(e.target.value)}
                            />
                          </Box>
                        </Box>
                      </>
                    )}

                    <Button
                      variant="contained"
                      size="small"
                      startIcon={<AddIcon fontSize="small" />}
                      onClick={addCustomTool}
                      disabled={!newToolName || (newToolType !== "script" && !newToolUrl)}
                      sx={{ alignSelf: "flex-start" }}
                    >
                      Add Tool
                    </Button>
                  </Box>
                )}

                {/* MCP stdio manual add */}
                {toolSource === "manual" && newToolType === "mcp-stdio" && (
                  <Box display="flex" flexDirection="column" gap={1.5}>
                    <Box display="flex" gap={2}>
                      <Box flex={1}>
                        <FieldLabel label="Name" required />
                        <TextField
                          size="small"
                          fullWidth
                          placeholder="e.g. My MCP Server"
                          value={newToolName}
                          onChange={(e) => setNewToolName(e.target.value)}
                        />
                      </Box>
                      <Box flex={1}>
                        <FieldLabel label="Command" required />
                        <TextField
                          size="small"
                          fullWidth
                          placeholder="e.g. npx, python, node"
                          value={newMcpCommand}
                          onChange={(e) => setNewMcpCommand(e.target.value)}
                        />
                      </Box>
                    </Box>
                    <Box>
                      <FieldLabel label="Arguments" />
                      <TextField
                        size="small"
                        fullWidth
                        placeholder="e.g. -y @org/server-name /path/to/config"
                        value={newMcpArgs}
                        onChange={(e) => setNewMcpArgs(e.target.value)}
                      />
                      <FormHelperText>Space-separated arguments</FormHelperText>
                    </Box>
                    <Button
                      variant="contained"
                      size="small"
                      startIcon={<AddIcon fontSize="small" />}
                      onClick={addCustomMcpStdioTool}
                      disabled={!newToolName || !newMcpCommand}
                      sx={{ alignSelf: "flex-start" }}
                    >
                      Add MCP Server
                    </Button>
                  </Box>
                )}
              </Box>
            </FormSection>
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 2, py: 1.5 }}>
        <Button onClick={onClose} size="small">Cancel</Button>
        <Button variant="contained" onClick={handleSave} size="small" disabled={!canSave}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default SpaceConfigDialog;


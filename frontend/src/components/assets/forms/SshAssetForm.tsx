// filepath: /home/blue/codes/choraleia/frontend/src/components/assets/forms/SshAssetForm.tsx
import React, { useState, useEffect, useImperativeHandle } from "react";
import {
  Box,
  TextField,
  Typography,
  FormControl,
  MenuItem,
  RadioGroup,
  FormControlLabel,
  Radio,
  Select,
  Switch,
  IconButton,
  Chip,
  Autocomplete,
} from "@mui/material";
import FolderIcon from "@mui/icons-material/Folder";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import {
  FolderTreeItem,
  listSSHKeys,
  inspectSSHKey,
  SSHKeyInfo,
  AssetLike,
  listAssets,
} from "../api/assets";
import { createAsset, updateAsset } from "../api/assets";

export interface SshConfig {
  // Connection
  host: string;
  port: number;
  username: string;
  password?: string;
  private_key_path?: string;
  private_key_passphrase?: string;
  private_key?: string;
  timeout?: number;
  keepalive_interval?: number;
  // Connection mode: direct, proxy, jump
  connection_mode?: "direct" | "proxy" | "jump";
  // Proxy settings (for proxy mode)
  proxy_type?: "http" | "socks4" | "socks5";
  proxy_host?: string;
  proxy_port?: number;
  proxy_username?: string;
  proxy_password?: string;
  // Jump host settings (for jump mode) - use existing SSH asset
  jump_asset_id?: string;
  // Advanced connection
  compression?: boolean;
  agent_forwarding?: boolean;
  strict_host_key?: boolean;
  // Tunnels / Port forwarding
  tunnels?: Array<{
    type: "local" | "remote" | "dynamic";
    local_host?: string;
    local_port: number;
    remote_host?: string;
    remote_port?: number;
    description?: string;
  }>;
  // Terminal settings
  shell?: string;
  term_type?: string;
  startup_command?: string;
  // Environment
  environment?: Record<string, string>;
  // Terminal preferences
  scrollback?: number;
  font_size?: number;
  copy_on_select?: boolean;
  bell?: boolean;
}

export interface SshAssetFormHandle {
  submit: () => Promise<boolean>;
  canSubmit: () => boolean;
}

interface Props {
  asset?: AssetLike | null;
  mode: "create" | "edit";
  folderTreeItems: FolderTreeItem[];
  defaultParentId?: string | null;
  onSuccess?: () => void;
  onValidityChange?: (valid: boolean) => void;
  folderPathResolver: (id: string) => string;
}

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

const SshAssetForm = React.forwardRef<SshAssetFormHandle, Props>(
  (
    {
      asset,
      mode,
      folderTreeItems,
      defaultParentId = null,
      onSuccess,
      onValidityChange,
      folderPathResolver,
    },
    ref,
  ) => {
    const [name, setName] = useState<string>(asset?.name || "");
    const [description, setDescription] = useState<string>(
      asset?.description || "",
    );
    const [parentFolder, setParentFolder] = useState<string | null>(
      asset?.parent_id ?? defaultParentId ?? null,
    );
    const [config, setConfig] = useState<SshConfig>(() => {
      const cfg = (asset?.config || {}) as any;
      return {
        host: cfg.host || "",
        port: typeof cfg.port === "number" ? cfg.port : 22,
        username: cfg.username || "",
        password: cfg.password || "",
        private_key_path: cfg.private_key_path || "",
        private_key_passphrase: cfg.private_key_passphrase || "",
        private_key: cfg.private_key || "",
        timeout: typeof cfg.timeout === "number" ? cfg.timeout : 30,
        keepalive_interval: typeof cfg.keepalive_interval === "number" ? cfg.keepalive_interval : 60,
        connection_mode: cfg.connection_mode || "direct",
        proxy_type: cfg.proxy_type || "socks5",
        proxy_host: cfg.proxy_host || "",
        proxy_port: typeof cfg.proxy_port === "number" ? cfg.proxy_port : 1080,
        proxy_username: cfg.proxy_username || "",
        proxy_password: cfg.proxy_password || "",
        jump_asset_id: cfg.jump_asset_id || "",
        compression: cfg.compression || false,
        agent_forwarding: cfg.agent_forwarding || false,
        strict_host_key: cfg.strict_host_key !== false,
        tunnels: cfg.tunnels || [],
        shell: cfg.shell || "",
        term_type: cfg.term_type || "xterm-256color",
        startup_command: cfg.startup_command || "",
        environment: cfg.environment || {},
        scrollback: cfg.scrollback || 10000,
        font_size: cfg.font_size || 14,
        copy_on_select: cfg.copy_on_select || false,
        bell: cfg.bell !== false,
      };
    });
    const [authMethod, setAuthMethod] = useState<"password" | "keyFile">(() => {
      const cfg = (asset?.config || {}) as any;
      if (cfg.private_key_path && cfg.private_key_path !== "") return "keyFile";
      return "password";
    });
    const [keyEncrypted, setKeyEncrypted] = useState<boolean>(false);

    // Environment variable editing state
    const [newEnvKey, setNewEnvKey] = useState("");
    const [newEnvValue, setNewEnvValue] = useState("");

    // Tunnel editing state
    const [newTunnel, setNewTunnel] = useState<{
      type: "local" | "remote" | "dynamic";
      local_host: string;
      local_port: string;
      remote_host: string;
      remote_port: string;
    }>({
      type: "local",
      local_host: "127.0.0.1",
      local_port: "",
      remote_host: "",
      remote_port: "",
    });

    useEffect(() => {
      setName(asset?.name || "");
      setDescription(asset?.description || "");
      setParentFolder(asset?.parent_id ?? defaultParentId ?? null);
      const cfg = (asset?.config || {}) as any;
      setConfig({
        host: cfg.host || "",
        port: typeof cfg.port === "number" ? cfg.port : 22,
        username: cfg.username || "",
        password: cfg.password || "",
        private_key_path: cfg.private_key_path || "",
        private_key_passphrase: cfg.private_key_passphrase || "",
        private_key: cfg.private_key || "",
        timeout: typeof cfg.timeout === "number" ? cfg.timeout : 30,
        keepalive_interval: typeof cfg.keepalive_interval === "number" ? cfg.keepalive_interval : 60,
        connection_mode: cfg.connection_mode || "direct",
        proxy_type: cfg.proxy_type || "socks5",
        proxy_host: cfg.proxy_host || "",
        proxy_port: typeof cfg.proxy_port === "number" ? cfg.proxy_port : 1080,
        proxy_username: cfg.proxy_username || "",
        proxy_password: cfg.proxy_password || "",
        jump_asset_id: cfg.jump_asset_id || "",
        compression: cfg.compression || false,
        agent_forwarding: cfg.agent_forwarding || false,
        strict_host_key: cfg.strict_host_key !== false,
        tunnels: cfg.tunnels || [],
        shell: cfg.shell || "",
        term_type: cfg.term_type || "xterm-256color",
        startup_command: cfg.startup_command || "",
        environment: cfg.environment || {},
        scrollback: cfg.scrollback || 10000,
        font_size: cfg.font_size || 14,
        copy_on_select: cfg.copy_on_select || false,
        bell: cfg.bell !== false,
      });
      if (cfg.private_key_path && cfg.private_key_path !== "")
        setAuthMethod("keyFile");
      else if (cfg.password && cfg.password !== "") setAuthMethod("password");
      else setAuthMethod("password");
    }, [asset, defaultParentId]);

    const isValid = React.useMemo(() => {
      if (!name.trim() || !config.host || !config.username) return false;
      if (authMethod === "password") return !!config.password;
      if (authMethod === "keyFile") return !!config.private_key_path;
      return false;
    }, [name, config, authMethod]);

    useEffect(() => {
      onValidityChange?.(isValid);
    }, [isValid, onValidityChange]);

    const submit = async (): Promise<boolean> => {
      if (!isValid) return false;
      const authConfig = { ...config } as any;
      if (authMethod !== "password") authConfig.password = "";
      if (authMethod !== "keyFile") authConfig.private_key_path = "";
      authConfig.private_key = "";
      const body = {
        name: name.trim(),
        type: "ssh" as const,
        description: description || "",
        config: { ...authConfig },
        tags: [],
        parent_id: parentFolder ?? null,
      };
      try {
        if (mode === "edit" && asset?.id) {
          const res = await updateAsset(asset.id, body);
          if (res.code === 200) {
            onSuccess?.();
            return true;
          }
        } else {
          const res = await createAsset(body);
          if (res.code === 200) {
            onSuccess?.();
            return true;
          }
        }
      } catch (e) {
        console.error("SSH asset save failed", e);
      }
      return false;
    };

    useImperativeHandle(ref, () => ({ submit, canSubmit: () => isValid }), [
      submit,
      isValid,
    ]);

    const [availableKeys, setAvailableKeys] = useState<SSHKeyInfo[]>([]);
    const [sshAssets, setSshAssets] = useState<AssetLike[]>([]);

    useEffect(() => {
      listSSHKeys()
        .then((keys) => setAvailableKeys(keys))
        .catch(() => {});
      // Load SSH assets for jump host selection
      listAssets()
        .then((assets) => setSshAssets(assets.filter((a) => a.type === "ssh" && a.id !== asset?.id)))
        .catch(() => {});
    }, [asset?.id]);

    useEffect(() => {
      if (authMethod === "keyFile" && config.private_key_path) {
        const match = availableKeys.find(
          (k) => k.path === config.private_key_path,
        );
        if (match) {
          setKeyEncrypted(match.encrypted);
        } else {
          inspectSSHKey(config.private_key_path)
            .then((info) => setKeyEncrypted(!!info?.encrypted))
            .catch(() => setKeyEncrypted(false));
        }
      } else {
        setKeyEncrypted(false);
      }
    }, [authMethod, config.private_key_path, availableKeys]);

    return (
      <Box display="flex" flexDirection="column" gap={2}>
        {/* Basic Info Section */}
        <FormSection title="Basic Information">
          <Box display="flex" flexDirection="column" gap={1.5}>
            {/* Name and Folder row */}
            <Box display="flex" gap={2}>
              <Box flex={1}>
                <FieldLabel label="Name" required />
                <TextField
                  size="small"
                  fullWidth
                  placeholder="e.g. Production Server"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Box>
              <Box sx={{ minWidth: 180 }}>
                <FieldLabel label="Folder" />
                <FormControl size="small" fullWidth>
                  <Select
                    value={parentFolder ?? "root"}
                    renderValue={(value) => {
                      if (value === "root") return "/";
                      if (typeof value === "string")
                        return "/" + folderPathResolver(value);
                      return "/";
                    }}
                    onChange={(e) =>
                      setParentFolder(
                        e.target.value === "root"
                          ? null
                          : (e.target.value as string),
                      )
                    }
                  >
                    <MenuItem value="root">/</MenuItem>
                    {folderTreeItems.map((item) => (
                      <MenuItem key={item.id} value={item.id}>
                        <Box
                          pl={item.depth * 1.5}
                          display="flex"
                          alignItems="center"
                        >
                          <FolderIcon
                            fontSize="small"
                            style={{ marginRight: 4 }}
                          />
                          {item.name}
                        </Box>
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>
            </Box>

            {/* Description */}
            <Box>
              <FieldLabel label="Description" />
              <TextField
                size="small"
                fullWidth
                placeholder="Optional description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                multiline
                minRows={2}
              />
            </Box>
          </Box>
        </FormSection>

        {/* Connection Settings Section */}
        <FormSection title="Connection">
          <Box display="flex" flexDirection="column" gap={1.5}>
            {/* Host, Port, Username row */}
            <Box display="flex" gap={2}>
              <Box flex={2}>
                <FieldLabel label="Host" required />
                <TextField
                  size="small"
                  fullWidth
                  placeholder="e.g. 192.168.1.100 or server.example.com"
                  value={config.host || ""}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, host: e.target.value }))
                  }
                />
              </Box>
              <Box sx={{ width: 100 }}>
                <FieldLabel label="Port" required />
                <TextField
                  size="small"
                  fullWidth
                  type="number"
                  placeholder="22"
                  value={config.port || 22}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, port: Number(e.target.value) }))
                  }
                />
              </Box>
              <Box flex={1}>
                <FieldLabel label="Username" required />
                <TextField
                  size="small"
                  fullWidth
                  placeholder="e.g. root"
                  value={config.username || ""}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, username: e.target.value }))
                  }
                />
              </Box>
            </Box>

            {/* Timeout and Keepalive row */}
            <Box display="flex" gap={2}>
              <Box sx={{ width: 150 }}>
                <FieldLabel label="Timeout (seconds)" />
                <TextField
                  size="small"
                  fullWidth
                  type="number"
                  placeholder="30"
                  value={config.timeout || 30}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, timeout: Number(e.target.value) }))
                  }
                  inputProps={{ min: 5, max: 300 }}
                />
              </Box>
              <Box sx={{ width: 180 }}>
                <FieldLabel label="Keepalive Interval (s)" />
                <TextField
                  size="small"
                  fullWidth
                  type="number"
                  placeholder="60"
                  value={config.keepalive_interval || 60}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, keepalive_interval: Number(e.target.value) }))
                  }
                  inputProps={{ min: 0, max: 600 }}
                />
              </Box>
            </Box>

            {/* Connection Mode */}
            <Box>
              <FieldLabel label="Connection Mode" />
              <RadioGroup
                row
                value={config.connection_mode || "direct"}
                onChange={(e) =>
                  setConfig((c) => ({ ...c, connection_mode: e.target.value as any }))
                }
              >
                <FormControlLabel
                  value="direct"
                  control={<Radio size="small" />}
                  label={<Typography variant="body2">Direct</Typography>}
                />
                <FormControlLabel
                  value="proxy"
                  control={<Radio size="small" />}
                  label={<Typography variant="body2">Proxy</Typography>}
                />
                <FormControlLabel
                  value="jump"
                  control={<Radio size="small" />}
                  label={<Typography variant="body2">Jump Host</Typography>}
                />
              </RadioGroup>
            </Box>

            {/* Proxy settings */}
            {config.connection_mode === "proxy" && (
              <Box display="flex" flexDirection="column" gap={1.5}>
                <Box display="flex" gap={2}>
                  <Box sx={{ width: 120 }}>
                    <FieldLabel label="Proxy Type" required />
                    <FormControl size="small" fullWidth>
                      <Select
                        value={config.proxy_type || "socks5"}
                        onChange={(e) =>
                          setConfig((c) => ({ ...c, proxy_type: e.target.value as any }))
                        }
                      >
                        <MenuItem value="socks5">SOCKS5</MenuItem>
                        <MenuItem value="socks4">SOCKS4</MenuItem>
                        <MenuItem value="http">HTTP</MenuItem>
                      </Select>
                    </FormControl>
                  </Box>
                  <Box flex={1}>
                    <FieldLabel label="Proxy Host" required />
                    <TextField
                      size="small"
                      fullWidth
                      placeholder="e.g. 127.0.0.1"
                      value={config.proxy_host || ""}
                      onChange={(e) =>
                        setConfig((c) => ({ ...c, proxy_host: e.target.value }))
                      }
                    />
                  </Box>
                  <Box sx={{ width: 100 }}>
                    <FieldLabel label="Port" required />
                    <TextField
                      size="small"
                      fullWidth
                      type="number"
                      placeholder="1080"
                      value={config.proxy_port || 1080}
                      onChange={(e) =>
                        setConfig((c) => ({ ...c, proxy_port: Number(e.target.value) }))
                      }
                    />
                  </Box>
                </Box>
                <Box display="flex" gap={2}>
                  <Box flex={1}>
                    <FieldLabel label="Proxy Username" />
                    <TextField
                      size="small"
                      fullWidth
                      placeholder="Optional"
                      value={config.proxy_username || ""}
                      onChange={(e) =>
                        setConfig((c) => ({ ...c, proxy_username: e.target.value }))
                      }
                    />
                  </Box>
                  <Box flex={1}>
                    <FieldLabel label="Proxy Password" />
                    <TextField
                      size="small"
                      fullWidth
                      type="password"
                      placeholder="Optional"
                      value={config.proxy_password || ""}
                      onChange={(e) =>
                        setConfig((c) => ({ ...c, proxy_password: e.target.value }))
                      }
                    />
                  </Box>
                </Box>
              </Box>
            )}

            {/* Jump host settings */}
            {config.connection_mode === "jump" && (
              <Box>
                <FieldLabel label="Jump Host" required />
                <FormControl size="small" fullWidth>
                  <Select
                    value={config.jump_asset_id || ""}
                    onChange={(e) =>
                      setConfig((c) => ({ ...c, jump_asset_id: e.target.value }))
                    }
                    displayEmpty
                  >
                    <MenuItem value="" disabled>
                      Select an SSH asset as jump host...
                    </MenuItem>
                    {sshAssets.map((a) => (
                      <MenuItem key={a.id} value={a.id}>
                        {a.name} ({(a.config as any)?.username}@{(a.config as any)?.host})
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>
            )}
          </Box>
        </FormSection>

        {/* Authentication Section */}
        <FormSection title="Authentication">
          <Box display="flex" flexDirection="column" gap={1.5}>
            {/* Auth Method */}
            <Box>
              <FieldLabel label="Method" required />
              <RadioGroup
                row
                value={authMethod}
                onChange={(e) => setAuthMethod(e.target.value as any)}
              >
                <FormControlLabel
                  value="password"
                  control={<Radio size="small" />}
                  label={<Typography variant="body2">Password</Typography>}
                />
                <FormControlLabel
                  value="keyFile"
                  control={<Radio size="small" />}
                  label={<Typography variant="body2">SSH Key</Typography>}
                />
              </RadioGroup>
            </Box>

            {/* Password auth */}
            {authMethod === "password" && (
              <Box>
                <FieldLabel label="Password" required />
                <TextField
                  size="small"
                  fullWidth
                  type="password"
                  placeholder="Enter password"
                  value={config.password || ""}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, password: e.target.value }))
                  }
                />
              </Box>
            )}

            {/* Key file auth */}
            {authMethod === "keyFile" && (
              <Box display="flex" gap={2}>
                <Box flex={1}>
                  <FieldLabel label="Key File Path" required />
                  <Autocomplete
                    freeSolo
                    size="small"
                    options={availableKeys.map((k) => k.path)}
                    value={config.private_key_path || ""}
                    onInputChange={(_, val) =>
                      setConfig((c) => ({ ...c, private_key_path: val }))
                    }
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        placeholder="e.g. ~/.ssh/id_rsa"
                      />
                    )}
                  />
                </Box>
                {keyEncrypted && (
                  <Box sx={{ minWidth: 200 }}>
                    <FieldLabel label="Key Passphrase" />
                    <TextField
                      size="small"
                      fullWidth
                      type="password"
                      placeholder="Enter passphrase if encrypted"
                      value={config.private_key_passphrase || ""}
                      onChange={(e) =>
                        setConfig((c) => ({
                          ...c,
                          private_key_passphrase: e.target.value,
                        }))
                      }
                    />
                  </Box>
                )}
              </Box>
            )}
          </Box>
        </FormSection>


        {/* Advanced Options Section */}
        <FormSection title="Advanced Options">
          <Box display="flex" flexWrap="wrap" gap={2}>
            <Box display="flex" alignItems="center" gap={1}>
              <Switch
                size="small"
                checked={config.compression || false}
                onChange={(e) =>
                  setConfig((c) => ({ ...c, compression: e.target.checked }))
                }
              />
              <Typography variant="body2" color="text.secondary">
                Enable compression
              </Typography>
            </Box>
            <Box display="flex" alignItems="center" gap={1}>
              <Switch
                size="small"
                checked={config.agent_forwarding || false}
                onChange={(e) =>
                  setConfig((c) => ({ ...c, agent_forwarding: e.target.checked }))
                }
              />
              <Typography variant="body2" color="text.secondary">
                SSH Agent forwarding
              </Typography>
            </Box>
            <Box display="flex" alignItems="center" gap={1}>
              <Switch
                size="small"
                checked={config.strict_host_key !== false}
                onChange={(e) =>
                  setConfig((c) => ({ ...c, strict_host_key: e.target.checked }))
                }
              />
              <Typography variant="body2" color="text.secondary">
                Strict host key checking
              </Typography>
            </Box>
          </Box>
        </FormSection>

        {/* Tunnels / Port Forwarding Section */}
        <FormSection title="Port Forwarding">
          <Box display="flex" flexDirection="column" gap={1.5}>
            {/* Existing tunnels */}
            {(config.tunnels || []).length > 0 && (
              <Box display="flex" flexDirection="column" gap={0.5}>
                {(config.tunnels || []).map((tunnel, idx) => (
                  <Chip
                    key={idx}
                    size="small"
                    label={
                      tunnel.type === "dynamic"
                        ? `[D] ${tunnel.local_host || "127.0.0.1"}:${tunnel.local_port}`
                        : tunnel.type === "local"
                        ? `[L] ${tunnel.local_host || "127.0.0.1"}:${tunnel.local_port} → ${tunnel.remote_host}:${tunnel.remote_port}`
                        : `[R] ${tunnel.remote_host}:${tunnel.remote_port} → ${tunnel.local_host || "127.0.0.1"}:${tunnel.local_port}`
                    }
                    onDelete={() => {
                      setConfig((c) => ({
                        ...c,
                        tunnels: (c.tunnels || []).filter((_, i) => i !== idx),
                      }));
                    }}
                    deleteIcon={<DeleteIcon />}
                    sx={{ fontFamily: "monospace", fontSize: 11, justifyContent: "flex-start" }}
                  />
                ))}
              </Box>
            )}

            {/* Add new tunnel */}
            <Box display="flex" flexDirection="column" gap={1}>
              <Box display="flex" gap={2} alignItems="flex-end">
                <Box sx={{ width: 100 }}>
                  <FieldLabel label="Type" />
                  <FormControl size="small" fullWidth>
                    <Select
                      value={newTunnel.type}
                      onChange={(e) =>
                        setNewTunnel((t) => ({ ...t, type: e.target.value as any }))
                      }
                    >
                      <MenuItem value="local">Local (-L)</MenuItem>
                      <MenuItem value="remote">Remote (-R)</MenuItem>
                      <MenuItem value="dynamic">Dynamic (-D)</MenuItem>
                    </Select>
                  </FormControl>
                </Box>
                <Box sx={{ width: 120 }}>
                  <FieldLabel label="Local Host" />
                  <TextField
                    size="small"
                    fullWidth
                    placeholder="127.0.0.1"
                    value={newTunnel.local_host}
                    onChange={(e) =>
                      setNewTunnel((t) => ({ ...t, local_host: e.target.value }))
                    }
                  />
                </Box>
                <Box sx={{ width: 80 }}>
                  <FieldLabel label="Local Port" />
                  <TextField
                    size="small"
                    fullWidth
                    type="number"
                    placeholder="8080"
                    value={newTunnel.local_port}
                    onChange={(e) =>
                      setNewTunnel((t) => ({ ...t, local_port: e.target.value }))
                    }
                  />
                </Box>
                {newTunnel.type !== "dynamic" && (
                  <>
                    <Box flex={1}>
                      <FieldLabel label="Remote Host" />
                      <TextField
                        size="small"
                        fullWidth
                        placeholder="e.g. localhost or db.internal"
                        value={newTunnel.remote_host}
                        onChange={(e) =>
                          setNewTunnel((t) => ({ ...t, remote_host: e.target.value }))
                        }
                      />
                    </Box>
                    <Box sx={{ width: 80 }}>
                      <FieldLabel label="Remote Port" />
                      <TextField
                        size="small"
                        fullWidth
                        type="number"
                        placeholder="3306"
                        value={newTunnel.remote_port}
                        onChange={(e) =>
                          setNewTunnel((t) => ({ ...t, remote_port: e.target.value }))
                        }
                      />
                    </Box>
                  </>
                )}
                <IconButton
                  size="small"
                  disabled={
                    !newTunnel.local_port ||
                    (newTunnel.type !== "dynamic" && (!newTunnel.remote_host || !newTunnel.remote_port))
                  }
                  onClick={() => {
                    const tunnel = {
                      type: newTunnel.type,
                      local_host: newTunnel.local_host || "127.0.0.1",
                      local_port: parseInt(newTunnel.local_port, 10),
                      remote_host: newTunnel.type !== "dynamic" ? newTunnel.remote_host : undefined,
                      remote_port: newTunnel.type !== "dynamic" ? parseInt(newTunnel.remote_port, 10) : undefined,
                    };
                    setConfig((c) => ({
                      ...c,
                      tunnels: [...(c.tunnels || []), tunnel],
                    }));
                    setNewTunnel({
                      type: "local",
                      local_host: "127.0.0.1",
                      local_port: "",
                      remote_host: "",
                      remote_port: "",
                    });
                  }}
                  sx={{ mb: 0.5 }}
                >
                  <AddIcon />
                </IconButton>
              </Box>
              <Typography variant="caption" color="text.secondary">
                Local (-L): Forward local port to remote. Remote (-R): Forward remote port to local. Dynamic (-D): SOCKS proxy.
              </Typography>
            </Box>
          </Box>
        </FormSection>

        {/* Terminal Settings Section */}
        <FormSection title="Terminal Settings">
          <Box display="flex" flexDirection="column" gap={1.5}>
            {/* Shell and Terminal Type row */}
            <Box display="flex" gap={2}>
              <Box flex={1}>
                <FieldLabel label="Shell" />
                <Autocomplete
                  freeSolo
                  size="small"
                  options={[
                    "/bin/bash",
                    "/bin/sh",
                    "/bin/zsh",
                    "/usr/bin/fish",
                    "/bin/ash",
                  ]}
                  value={config.shell || ""}
                  onInputChange={(_, val) =>
                    setConfig((c) => ({ ...c, shell: val }))
                  }
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      placeholder="Use server default"
                    />
                  )}
                />
              </Box>
              <Box flex={1}>
                <FieldLabel label="Terminal Type" />
                <Autocomplete
                  freeSolo
                  size="small"
                  options={[
                    "xterm-256color",
                    "xterm",
                    "xterm-color",
                    "vt100",
                    "vt102",
                    "linux",
                    "screen",
                    "screen-256color",
                    "tmux",
                    "tmux-256color",
                  ]}
                  value={config.term_type || "xterm-256color"}
                  onInputChange={(_, val) =>
                    setConfig((c) => ({ ...c, term_type: val || "xterm-256color" }))
                  }
                  renderInput={(params) => (
                    <TextField {...params} placeholder="xterm-256color" />
                  )}
                />
              </Box>
            </Box>

            {/* Startup Command */}
            <Box>
              <FieldLabel label="Startup Command" />
              <TextField
                size="small"
                fullWidth
                placeholder="Command to run after login (e.g. cd /app && clear)"
                value={config.startup_command || ""}
                onChange={(e) =>
                  setConfig((c) => ({ ...c, startup_command: e.target.value }))
                }
              />
            </Box>
          </Box>
        </FormSection>

        {/* Environment Variables Section */}
        <FormSection title="Environment Variables">
          <Box display="flex" flexDirection="column" gap={1.5}>
            {/* Existing environment variables */}
            {Object.keys(config.environment || {}).length > 0 && (
              <Box display="flex" flexWrap="wrap" gap={0.5}>
                {Object.entries(config.environment || {}).map(([key, value]) => (
                  <Chip
                    key={key}
                    size="small"
                    label={`${key}=${value}`}
                    onDelete={() => {
                      const newEnv = { ...config.environment };
                      delete newEnv[key];
                      setConfig((c) => ({ ...c, environment: newEnv }));
                    }}
                    deleteIcon={<DeleteIcon />}
                    sx={{ fontFamily: "monospace", fontSize: 11 }}
                  />
                ))}
              </Box>
            )}

            {/* Add new environment variable */}
            <Box display="flex" gap={1} alignItems="flex-end">
              <Box flex={1}>
                <FieldLabel label="Variable Name" />
                <TextField
                  size="small"
                  fullWidth
                  placeholder="e.g. MY_VAR"
                  value={newEnvKey}
                  onChange={(e) => setNewEnvKey(e.target.value.toUpperCase())}
                />
              </Box>
              <Box flex={2}>
                <FieldLabel label="Value" />
                <TextField
                  size="small"
                  fullWidth
                  placeholder="e.g. my_value"
                  value={newEnvValue}
                  onChange={(e) => setNewEnvValue(e.target.value)}
                />
              </Box>
              <IconButton
                size="small"
                disabled={!newEnvKey.trim()}
                onClick={() => {
                  if (newEnvKey.trim()) {
                    setConfig((c) => ({
                      ...c,
                      environment: {
                        ...c.environment,
                        [newEnvKey.trim()]: newEnvValue,
                      },
                    }));
                    setNewEnvKey("");
                    setNewEnvValue("");
                  }
                }}
                sx={{ mb: 0.5 }}
              >
                <AddIcon />
              </IconButton>
            </Box>
          </Box>
        </FormSection>

        {/* Terminal Preferences Section */}
        <FormSection title="Terminal Preferences">
          <Box display="flex" flexDirection="column" gap={1.5}>
            {/* Scrollback and Font Size row */}
            <Box display="flex" gap={2}>
              <Box sx={{ width: 150 }}>
                <FieldLabel label="Scrollback Lines" />
                <TextField
                  size="small"
                  fullWidth
                  type="number"
                  placeholder="10000"
                  value={config.scrollback || 10000}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      scrollback: Math.max(100, Number(e.target.value) || 10000),
                    }))
                  }
                  inputProps={{ min: 100, max: 100000, step: 1000 }}
                />
              </Box>
              <Box sx={{ width: 120 }}>
                <FieldLabel label="Font Size" />
                <TextField
                  size="small"
                  fullWidth
                  type="number"
                  placeholder="14"
                  value={config.font_size || 14}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      font_size: Math.max(8, Math.min(32, Number(e.target.value) || 14)),
                    }))
                  }
                  inputProps={{ min: 8, max: 32 }}
                />
              </Box>
            </Box>

            {/* Toggle options */}
            <Box display="flex" flexWrap="wrap" gap={2}>
              <Box display="flex" alignItems="center" gap={1}>
                <Switch
                  size="small"
                  checked={config.copy_on_select || false}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, copy_on_select: e.target.checked }))
                  }
                />
                <Typography variant="body2" color="text.secondary">
                  Copy on select
                </Typography>
              </Box>
              <Box display="flex" alignItems="center" gap={1}>
                <Switch
                  size="small"
                  checked={config.bell !== false}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, bell: e.target.checked }))
                  }
                />
                <Typography variant="body2" color="text.secondary">
                  Terminal bell
                </Typography>
              </Box>
            </Box>
          </Box>
        </FormSection>
      </Box>
    );
  },
);

export default SshAssetForm;


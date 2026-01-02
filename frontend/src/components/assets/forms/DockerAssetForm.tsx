// filepath: /home/blue/codes/choraleia/frontend/src/components/assets/forms/DockerAssetForm.tsx
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
  Button,
  CircularProgress,
  Switch,
  Autocomplete,
} from "@mui/material";
import FolderIcon from "@mui/icons-material/Folder";
import RefreshIcon from "@mui/icons-material/Refresh";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import {
  FolderTreeItem,
  AssetLike,
  listAssets,
} from "../api/assets";
import { createAsset, updateAsset } from "../api/assets";
import { getApiUrl } from "../../../api/base";

export interface DockerHostConfig {
  // Connection
  connection_type: "local" | "ssh";
  ssh_asset_id?: string;
  // Container settings
  shell?: string;
  user?: string;
  show_all_containers?: boolean;
  // Terminal preferences
  term_type?: string;
  scrollback?: number;
  font_size?: number;
  copy_on_select?: boolean;
  bell?: boolean;
}

export interface DockerAssetFormHandle {
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

const DockerAssetForm = React.forwardRef<DockerAssetFormHandle, Props>(
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
    const [config, setConfig] = useState<DockerHostConfig>(() => {
      const cfg = (asset?.config || {}) as any;
      return {
        connection_type: cfg.connection_type || "local",
        ssh_asset_id: cfg.ssh_asset_id || "",
        shell: cfg.shell || "/bin/sh",
        user: cfg.user || "",
        show_all_containers: cfg.show_all_containers ?? false,
        term_type: cfg.term_type || "xterm-256color",
        scrollback: cfg.scrollback || 10000,
        font_size: cfg.font_size || 14,
        copy_on_select: cfg.copy_on_select || false,
        bell: cfg.bell !== false,
      };
    });

    const [sshAssets, setSshAssets] = useState<AssetLike[]>([]);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<{
      success: boolean;
      message: string;
      version?: string;
      containers?: number;
    } | null>(null);

    // Load SSH assets for remote docker option
    useEffect(() => {
      const loadSshAssets = async () => {
        try {
          const assets = await listAssets();
          setSshAssets(assets.filter((a) => a.type === "ssh"));
        } catch (e) {
          console.error("Failed to load SSH assets:", e);
        }
      };
      loadSshAssets();
    }, []);

    useEffect(() => {
      setName(asset?.name || "");
      setDescription(asset?.description || "");
      setParentFolder(asset?.parent_id ?? defaultParentId ?? null);
      const cfg = (asset?.config || {}) as any;
      setConfig({
        connection_type: cfg.connection_type || "local",
        ssh_asset_id: cfg.ssh_asset_id || "",
        shell: cfg.shell || "/bin/sh",
        user: cfg.user || "",
        show_all_containers: cfg.show_all_containers ?? false,
        term_type: cfg.term_type || "xterm-256color",
        scrollback: cfg.scrollback || 10000,
        font_size: cfg.font_size || 14,
        copy_on_select: cfg.copy_on_select || false,
        bell: cfg.bell !== false,
      });
      setTestResult(null);
    }, [asset, defaultParentId]);

    const isValid = React.useMemo(() => {
      if (!name.trim()) return false;
      if (config.connection_type === "ssh" && !config.ssh_asset_id) return false;
      return true;
    }, [name, config]);

    useEffect(() => {
      onValidityChange?.(isValid);
    }, [isValid, onValidityChange]);

    const handleTestConnection = async () => {
      setTesting(true);
      setTestResult(null);
      try {
        const resp = await fetch(getApiUrl("/api/docker/test"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            connection_type: config.connection_type,
            ssh_asset_id: config.ssh_asset_id,
          }),
        });
        const data = await resp.json();
        if (data.code === 200 && data.data?.success) {
          setTestResult({
            success: true,
            message: `Docker ${data.data.version} - ${data.data.containers} containers`,
            version: data.data.version,
            containers: data.data.containers,
          });
        } else {
          setTestResult({
            success: false,
            message: data.message || "Connection failed",
          });
        }
      } catch (e: any) {
        setTestResult({
          success: false,
          message: e.message || "Connection failed",
        });
      } finally {
        setTesting(false);
      }
    };

    const handleSubmit = async (): Promise<boolean> => {
      if (!isValid) return false;

      const payload = {
        name: name.trim(),
        type: "docker_host" as const,
        description: description.trim(),
        config: {
          connection_type: config.connection_type,
          ssh_asset_id: config.connection_type === "ssh" ? config.ssh_asset_id : undefined,
          shell: config.shell || "/bin/sh",
          user: config.user || undefined,
          show_all_containers: config.show_all_containers,
          term_type: config.term_type,
          scrollback: config.scrollback,
          font_size: config.font_size,
          copy_on_select: config.copy_on_select,
          bell: config.bell,
        },
        tags: [] as string[],
        parent_id: parentFolder,
      };

      try {
        if (mode === "edit" && asset?.id) {
          await updateAsset(asset.id, payload);
        } else {
          await createAsset(payload);
        }
        onSuccess?.();
        return true;
      } catch (e: any) {
        console.error("Failed to save Docker host:", e);
        return false;
      }
    };

    useImperativeHandle(ref, () => ({
      submit: handleSubmit,
      canSubmit: () => isValid,
    }));

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
                  placeholder="e.g. Production Docker"
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

        {/* Connection Section */}
        <FormSection title="Connection">
          <Box display="flex" flexDirection="column" gap={1.5}>
            {/* Connection Type */}
            <Box>
              <FieldLabel label="Docker Host" />
              <RadioGroup
                row
                value={config.connection_type}
                onChange={(e) => {
                  setConfig({ ...config, connection_type: e.target.value as "local" | "ssh" });
                  setTestResult(null);
                }}
              >
                <FormControlLabel
                  value="local"
                  control={<Radio size="small" />}
                  label={<Typography variant="body2">Local Docker</Typography>}
                />
                <FormControlLabel
                  value="ssh"
                  control={<Radio size="small" />}
                  label={<Typography variant="body2">Remote via SSH</Typography>}
                />
              </RadioGroup>
            </Box>

            {/* SSH Asset Selection (for remote) */}
            {config.connection_type === "ssh" && (
              <Box>
                <FieldLabel label="SSH Host" required />
                <FormControl size="small" fullWidth>
                  <Select
                    value={config.ssh_asset_id || ""}
                    onChange={(e) => {
                      setConfig({ ...config, ssh_asset_id: e.target.value });
                      setTestResult(null);
                    }}
                    displayEmpty
                  >
                    <MenuItem value="" disabled>
                      Select SSH connection...
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

            {/* Test Connection */}
            <Box display="flex" alignItems="center" gap={1}>
              <Button
                variant="outlined"
                size="small"
                onClick={handleTestConnection}
                disabled={testing || (config.connection_type === "ssh" && !config.ssh_asset_id)}
                startIcon={testing ? <CircularProgress size={16} /> : <RefreshIcon />}
              >
                Test Connection
              </Button>
              {testResult && (
                <Box display="flex" alignItems="center" gap={0.5}>
                  {testResult.success ? (
                    <CheckCircleIcon sx={{ fontSize: 14, color: "success.main" }} />
                  ) : (
                    <ErrorIcon sx={{ fontSize: 14, color: "error.main" }} />
                  )}
                  <Typography
                    variant="body2"
                    color={testResult.success ? "success.main" : "error.main"}
                    sx={{ fontSize: 12 }}
                  >
                    {testResult.message}
                  </Typography>
                </Box>
              )}
            </Box>
          </Box>
        </FormSection>

        {/* Container Settings Section */}
        <FormSection title="Container Defaults">
          <Box display="flex" flexDirection="column" gap={1.5}>
            {/* Shell and User row */}
            <Box display="flex" gap={2}>
              <Box flex={1}>
                <FieldLabel label="Default Shell" />
                <Autocomplete
                  freeSolo
                  size="small"
                  options={[
                    "/bin/sh",
                    "/bin/bash",
                    "/bin/ash",
                    "/bin/zsh",
                  ]}
                  value={config.shell || "/bin/sh"}
                  onInputChange={(_, val) =>
                    setConfig({ ...config, shell: val || "/bin/sh" })
                  }
                  renderInput={(params) => (
                    <TextField {...params} placeholder="/bin/sh" />
                  )}
                />
              </Box>
              <Box flex={1}>
                <FieldLabel label="Default User" />
                <TextField
                  size="small"
                  fullWidth
                  placeholder="e.g. root or 1000:1000"
                  value={config.user || ""}
                  onChange={(e) => setConfig({ ...config, user: e.target.value })}
                />
              </Box>
            </Box>

            {/* Terminal Type */}
            <Box sx={{ maxWidth: 280 }}>
              <FieldLabel label="Terminal Type" />
              <Autocomplete
                freeSolo
                size="small"
                options={[
                  "xterm-256color",
                  "xterm",
                  "xterm-color",
                  "vt100",
                  "linux",
                ]}
                value={config.term_type || "xterm-256color"}
                onInputChange={(_, val) =>
                  setConfig({ ...config, term_type: val || "xterm-256color" })
                }
                renderInput={(params) => (
                  <TextField {...params} placeholder="xterm-256color" />
                )}
              />
            </Box>

            {/* Show all containers toggle */}
            <Box display="flex" alignItems="center" gap={1}>
              <Switch
                size="small"
                checked={config.show_all_containers || false}
                onChange={(e) =>
                  setConfig({ ...config, show_all_containers: e.target.checked })
                }
              />
              <Typography variant="body2" color="text.secondary">
                Show all containers (including stopped)
              </Typography>
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
                    setConfig({
                      ...config,
                      scrollback: Math.max(100, Number(e.target.value) || 10000),
                    })
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
                    setConfig({
                      ...config,
                      font_size: Math.max(8, Math.min(32, Number(e.target.value) || 14)),
                    })
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
                    setConfig({ ...config, copy_on_select: e.target.checked })
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
                    setConfig({ ...config, bell: e.target.checked })
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

DockerAssetForm.displayName = "DockerAssetForm";

export default DockerAssetForm;


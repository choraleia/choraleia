// filepath: /home/blue/codes/choraleia/frontend/src/components/assets/forms/LocalAssetForm.tsx
import React, { useState, useEffect, useImperativeHandle } from "react";
import {
  Box,
  TextField,
  Typography,
  FormControl,
  Select,
  MenuItem,
  Switch,
  IconButton,
  Chip,
  Autocomplete,
} from "@mui/material";
import FolderIcon from "@mui/icons-material/Folder";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import { FolderTreeItem } from "../api/assets";
import { createAsset, updateAsset, AssetLike } from "../api/assets";

export interface LocalConfig {
  shell: string;
  working_dir?: string;
  startup_command?: string;
  environment?: Record<string, string>;
  inherit_env?: boolean;
  term_type?: string;
  login_shell?: boolean;
  // Additional options
  scrollback?: number;
  font_size?: number;
  copy_on_select?: boolean;
  bell?: boolean;
}

export interface LocalAssetFormHandle {
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
  folderPathResolver?: (id: string) => string;
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

const LocalAssetForm = React.forwardRef<LocalAssetFormHandle, Props>(
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
    const [config, setConfig] = useState<LocalConfig>(() => {
      const cfg = (asset?.config || {}) as any;
      return {
        shell: cfg.shell || "/bin/bash",
        working_dir: cfg.working_dir || "",
        startup_command: cfg.startup_command || "",
        environment: cfg.environment || {},
        inherit_env: cfg.inherit_env !== false, // default true
        term_type: cfg.term_type || "xterm-256color",
        login_shell: cfg.login_shell || false,
        scrollback: cfg.scrollback || 10000,
        font_size: cfg.font_size || 14,
        copy_on_select: cfg.copy_on_select || false,
        bell: cfg.bell !== false, // default true
      };
    });

    // Environment variable editing state
    const [newEnvKey, setNewEnvKey] = useState("");
    const [newEnvValue, setNewEnvValue] = useState("");

    useEffect(() => {
      setName(asset?.name || "");
      setDescription(asset?.description || "");
      setParentFolder(asset?.parent_id ?? defaultParentId ?? null);
      const cfg = (asset?.config || {}) as any;
      setConfig({
        shell: cfg.shell || "/bin/bash",
        working_dir: cfg.working_dir || "",
        startup_command: cfg.startup_command || "",
        environment: cfg.environment || {},
        inherit_env: cfg.inherit_env !== false,
        term_type: cfg.term_type || "xterm-256color",
        login_shell: cfg.login_shell || false,
        scrollback: cfg.scrollback || 10000,
        font_size: cfg.font_size || 14,
        copy_on_select: cfg.copy_on_select || false,
        bell: cfg.bell !== false,
      });
    }, [asset, defaultParentId]);

    const isValid = React.useMemo(() => {
      return !!name.trim() && !!config.shell;
    }, [name, config]);

    useEffect(() => {
      onValidityChange?.(isValid);
    }, [isValid, onValidityChange]);

    const submit = async (): Promise<boolean> => {
      if (!isValid) return false;
      const body = {
        name: name.trim(),
        type: "local" as const,
        description: description || "",
        config: { ...config },
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
        console.error("Local asset save failed", e);
      }
      return false;
    };

    useImperativeHandle(ref, () => ({ submit, canSubmit: () => isValid }), [
      submit,
      isValid,
    ]);

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
                  placeholder="e.g. My Local Terminal"
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
                      if (typeof value === "string") {
                        const path = folderPathResolver?.(value);
                        return path ? "/" + path : "/";
                      }
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

        {/* Terminal Settings Section */}
        <FormSection title="Terminal Settings">
          <Box display="flex" flexDirection="column" gap={1.5}>
            {/* Shell and Working Directory row */}
            <Box display="flex" gap={2}>
              <Box flex={1}>
                <FieldLabel label="Shell" required />
                <FormControl size="small" fullWidth>
                  <Select
                    value={config.shell || "/bin/bash"}
                    onChange={(e) =>
                      setConfig((c) => ({ ...c, shell: e.target.value }))
                    }
                  >
                    <MenuItem value="/bin/bash">/bin/bash</MenuItem>
                    <MenuItem value="/bin/sh">/bin/sh</MenuItem>
                    <MenuItem value="/bin/zsh">/bin/zsh</MenuItem>
                    <MenuItem value="/usr/bin/fish">/usr/bin/fish</MenuItem>
                    <MenuItem value="powershell">PowerShell</MenuItem>
                    <MenuItem value="cmd">CMD</MenuItem>
                  </Select>
                </FormControl>
              </Box>
              <Box flex={1}>
                <FieldLabel label="Working Directory" />
                <TextField
                  size="small"
                  fullWidth
                  placeholder="e.g. /home/user"
                  value={config.working_dir || ""}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, working_dir: e.target.value }))
                  }
                />
              </Box>
            </Box>

            {/* Startup Command */}
            <Box>
              <FieldLabel label="Startup Command" />
              <TextField
                size="small"
                fullWidth
                placeholder="Command to run after shell starts (e.g. source ~/.profile)"
                value={config.startup_command || ""}
                onChange={(e) =>
                  setConfig((c) => ({ ...c, startup_command: e.target.value }))
                }
              />
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
                  "xterm-16color",
                  "vt100",
                  "vt102",
                  "vt220",
                  "linux",
                  "screen",
                  "screen-256color",
                  "tmux",
                  "tmux-256color",
                  "rxvt",
                  "rxvt-unicode",
                  "rxvt-unicode-256color",
                  "ansi",
                  "dumb",
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

            {/* Login Shell Toggle */}
            <Box display="flex" alignItems="center" gap={1}>
              <Switch
                size="small"
                checked={config.login_shell || false}
                onChange={(e) =>
                  setConfig((c) => ({ ...c, login_shell: e.target.checked }))
                }
              />
              <Typography variant="body2" color="text.secondary">
                Login Shell (load profile/rc files)
              </Typography>
            </Box>
          </Box>
        </FormSection>

        {/* Environment Variables Section */}
        <FormSection title="Environment Variables">
          <Box display="flex" flexDirection="column" gap={1.5}>
            {/* Inherit system env toggle */}
            <Box display="flex" alignItems="center" gap={1}>
              <Switch
                size="small"
                checked={config.inherit_env !== false}
                onChange={(e) =>
                  setConfig((c) => ({ ...c, inherit_env: e.target.checked }))
                }
              />
              <Typography variant="body2" color="text.secondary">
                Inherit system environment variables
              </Typography>
            </Box>

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

export default LocalAssetForm;


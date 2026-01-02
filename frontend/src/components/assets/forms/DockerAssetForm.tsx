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
  Alert,
} from "@mui/material";
import FolderIcon from "@mui/icons-material/Folder";
import RefreshIcon from "@mui/icons-material/Refresh";
import {
  FolderTreeItem,
  AssetLike,
  listAssets,
} from "../api/assets";
import { createAsset, updateAsset } from "../api/assets";
import { getApiUrl } from "../../../api/base";

export interface DockerHostConfig {
  connection_type: "local" | "ssh";
  ssh_asset_id?: string;
  shell?: string;
  show_all_containers?: boolean;
  user?: string;
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
        show_all_containers: cfg.show_all_containers ?? false,
        user: cfg.user || "",
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
      // Hydrate when asset changes (edit mode reopen)
      setName(asset?.name || "");
      setDescription(asset?.description || "");
      setParentFolder(asset?.parent_id ?? defaultParentId ?? null);
      const cfg = (asset?.config || {}) as any;
      setConfig({
        connection_type: cfg.connection_type || "local",
        ssh_asset_id: cfg.ssh_asset_id || "",
        shell: cfg.shell || "/bin/sh",
        show_all_containers: cfg.show_all_containers ?? false,
        user: cfg.user || "",
      });
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
          show_all_containers: config.show_all_containers,
          user: config.user || undefined,
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

    const folderSelect = (
      <FormControl fullWidth size="small">
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
              e.target.value === "root" ? null : (e.target.value as string),
            )
          }
        >
          <MenuItem value="root">/</MenuItem>
          {folderTreeItems.map((item) => (
            <MenuItem key={item.id} value={item.id}>
              <Box pl={item.depth * 1.5} display="flex" alignItems="center">
                <FolderIcon fontSize="small" style={{ marginRight: 4 }} />
                {item.name}
              </Box>
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    );

    return (
      <Box display="flex" flexDirection="column" gap={2}>
        {/* Name */}
        <TextField
          label="Name"
          size="small"
          required
          fullWidth
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Production Docker"
        />

        {/* Description */}
        <TextField
          label="Description"
          size="small"
          fullWidth
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description"
        />

        {/* Connection Type */}
        <Box>
          <Typography variant="subtitle2" gutterBottom>
            Connection Type
          </Typography>
          <RadioGroup
            row
            value={config.connection_type}
            onChange={(e) =>
              setConfig({ ...config, connection_type: e.target.value as "local" | "ssh" })
            }
          >
            <FormControlLabel
              value="local"
              control={<Radio size="small" />}
              label="Local Docker"
            />
            <FormControlLabel
              value="ssh"
              control={<Radio size="small" />}
              label="Remote via SSH"
            />
          </RadioGroup>
        </Box>

        {/* SSH Asset Selection (for remote) */}
        {config.connection_type === "ssh" && (
          <FormControl fullWidth size="small">
            <Typography variant="subtitle2" gutterBottom>
              SSH Host
            </Typography>
            <Select
              value={config.ssh_asset_id || ""}
              onChange={(e) =>
                setConfig({ ...config, ssh_asset_id: e.target.value })
              }
              displayEmpty
            >
              <MenuItem value="" disabled>
                Select SSH connection...
              </MenuItem>
              {sshAssets.map((asset) => (
                <MenuItem key={asset.id} value={asset.id}>
                  {asset.name} ({(asset.config as any)?.host})
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )}

        {/* Default Shell */}
        <FormControl fullWidth size="small">
          <Typography variant="subtitle2" gutterBottom>
            Default Shell
          </Typography>
          <Select
            value={config.shell || "/bin/sh"}
            onChange={(e) => setConfig({ ...config, shell: e.target.value })}
          >
            <MenuItem value="/bin/sh">/bin/sh</MenuItem>
            <MenuItem value="/bin/bash">/bin/bash</MenuItem>
            <MenuItem value="/bin/zsh">/bin/zsh</MenuItem>
            <MenuItem value="/bin/ash">/bin/ash (Alpine)</MenuItem>
          </Select>
        </FormControl>

        {/* Default User */}
        <TextField
          label="Default User (optional)"
          size="small"
          fullWidth
          value={config.user || ""}
          onChange={(e) => setConfig({ ...config, user: e.target.value })}
          placeholder="e.g. root or 1000:1000"
        />

        {/* Folder */}
        <Box>
          <Typography variant="subtitle2" gutterBottom>
            Folder
          </Typography>
          {folderSelect}
        </Box>

        {/* Test Connection */}
        <Box display="flex" alignItems="center" gap={2}>
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
            <Alert
              severity={testResult.success ? "success" : "error"}
              sx={{ flex: 1, py: 0 }}
            >
              {testResult.message}
            </Alert>
          )}
        </Box>
      </Box>
    );
  },
);

DockerAssetForm.displayName = "DockerAssetForm";

export default DockerAssetForm;


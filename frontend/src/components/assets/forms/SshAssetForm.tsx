import React, { useState, useEffect, useImperativeHandle } from "react";
import { Box, Tabs, Tab, TextField, Typography, FormControl, MenuItem, RadioGroup, FormControlLabel, Radio, Select, Switch } from "@mui/material";
import Autocomplete from "@mui/material/Autocomplete";
import FolderIcon from "@mui/icons-material/Folder";
import { FolderTreeItem, listSSHKeys, inspectSSHKey, SSHKeyInfo, AssetLike } from "../api/assets";
import { createAsset, updateAsset } from "../api/assets";

export interface SshConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  private_key_path?: string;
  private_key_passphrase?: string;
  private_key?: string;
  timeout?: number;
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

const SshAssetForm = React.forwardRef<SshAssetFormHandle, Props>(
  ({ asset, mode, folderTreeItems, defaultParentId = null, onSuccess, onValidityChange, folderPathResolver }, ref) => {
    const [tab, setTab] = useState<"basic" | "advanced">("basic");

    const [name, setName] = useState<string>(asset?.name || "");
    const [description, setDescription] = useState<string>(asset?.description || "");
    const [parentFolder, setParentFolder] = useState<string | null>(asset?.parent_id ?? defaultParentId ?? null);
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
      } as any;
    });
    const [authMethod, setAuthMethod] = useState<"password" | "keyFile">(() => {
      const cfg = (asset?.config || {}) as any;
      if (cfg.private_key_path && cfg.private_key_path !== "") return "keyFile";
      return "password";
    });
    const [keyEncrypted, setKeyEncrypted] = useState<boolean>(false);

    useEffect(() => {
      // Hydrate when asset changes (edit mode reopen)
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
      } as any);
      if (cfg.private_key_path && cfg.private_key_path !== "") setAuthMethod("keyFile"); else if (cfg.password && cfg.password !== "") setAuthMethod("password"); else setAuthMethod("password");
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

    const folderSelect = (
      <FormControl>
        <Select
          value={parentFolder ?? "root"}
          renderValue={(value) => {
            if (value === "root") return "/";
            if (typeof value === "string") return "/" + folderPathResolver(value);
            return "/";
          }}
          onChange={(e) => setParentFolder(e.target.value === "root" ? null : (e.target.value as string))}
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

    const submit = async (): Promise<boolean> => {
      if (!isValid) return false;
      // Clear unused auth fields based on method to avoid confusion
      const authConfig = { ...config } as any;
      if (authMethod !== "password") authConfig.password = "";
      if (authMethod !== "keyFile") authConfig.private_key_path = "";
      authConfig.private_key = ""; // inline key removed
      const body = {
        name: name.trim(),
        type: "ssh" as const,
        description: description || "",
        config: {
          host: authConfig.host,
          port: authConfig.port,
          username: authConfig.username,
          password: authConfig.password || "",
          private_key_path: authConfig.private_key_path || "",
          private_key_passphrase: authConfig.private_key_passphrase || "",
          private_key: authConfig.private_key || "",
          timeout: authConfig.timeout || 30,
        },
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

    useImperativeHandle(ref, () => ({ submit, canSubmit: () => isValid }), [submit, isValid]);

    const [availableKeys, setAvailableKeys] = useState<SSHKeyInfo[]>([]);
    useEffect(() => {
      listSSHKeys().then((keys) => setAvailableKeys(keys)).catch(() => {});
    }, []);

    // auto inspect when key path changes
    useEffect(() => {
      if (authMethod === "keyFile" && config.private_key_path) {
        const match = availableKeys.find(k => k.path === config.private_key_path);
        if (match) {
          setKeyEncrypted(match.encrypted);
        } else {
          inspectSSHKey(config.private_key_path)
            .then(info => setKeyEncrypted(!!info?.encrypted))
            .catch(() => setKeyEncrypted(false));
        }
      } else {
        setKeyEncrypted(false);
      }
    }, [authMethod, config.private_key_path, availableKeys]);

    return (
      <Box display="flex" flexDirection="column" gap={2}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 1 }}>
          <Tab label="Basic" value="basic" />
          <Tab label="Advanced" value="advanced" />
        </Tabs>
        {tab === "basic" ? (
          <Box display="flex" flexDirection="column" gap={2}>
            {folderSelect}
            <TextField placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
            <Box display="flex" gap={2}>
              <TextField
                placeholder="Username"
                value={config.username || ""}
                onChange={(e) => setConfig((c) => ({ ...c, username: e.target.value }))}
                required
                sx={{ flex: 1 }}
              />
              <TextField
                placeholder="Host"
                value={config.host || ""}
                onChange={(e) => setConfig((c) => ({ ...c, host: e.target.value }))}
                required
                sx={{ flex: 1 }}
              />
              <TextField
                placeholder="Port"
                type="number"
                value={config.port || 22}
                onChange={(e) => setConfig((c) => ({ ...c, port: Number(e.target.value) }))}
                required
                sx={{ width: 120 }}
              />
            </Box>
            <FormControl size={"small"}>
              <Typography sx={{ mb: 0.5 }}>Authentication Method</Typography>
              <RadioGroup row value={authMethod} onChange={(e) => setAuthMethod(e.target.value as any)} sx={{ '& .MuiFormControlLabel-label': { fontSize: 12 } }}>
                <FormControlLabel value="password" control={<Radio size="small" />} label="Password" />
                <FormControlLabel value="keyFile" control={<Radio size="small" />} label="Key File" />
              </RadioGroup>
            </FormControl>
            {authMethod === "password" && (
              <TextField
                placeholder="Password"
                type="password"
                value={config.password || ""}
                onChange={(e) => setConfig((c) => ({ ...c, password: e.target.value }))}
                required
                size={"small"}
              />
            )}
            {authMethod === "keyFile" && (
              <Box display="flex" flexDirection="row" gap={2} alignItems="flex-start">
                <Box flex={1}>
                  <Autocomplete
                    freeSolo
                    options={availableKeys.map(k => k.path)}
                    value={config.private_key_path || ""}
                    onInputChange={(_, val) => setConfig((c) => ({ ...c, private_key_path: val }))}
                    renderInput={(params) => (
                      <TextField {...params} placeholder="SSH Key File Path" required />
                    )}
                    size={"small"}
                  />
                </Box>
                {keyEncrypted && (
                  <TextField
                    placeholder="Passphrase"
                    type="password"
                    value={config.private_key_passphrase || ""}
                    onChange={(e) => setConfig((c) => ({ ...c, private_key_passphrase: e.target.value }))}
                    sx={{ minWidth: 180 }}
                    size={"small"}
                  />
                )}
              </Box>
            )}
            <TextField
              placeholder="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              multiline
              minRows={2}
            />
          </Box>
        ) : (
          <Box display="flex" flexDirection="column" gap={2}>
            <TextField
              placeholder="Timeout"
              type="number"
              value={config.timeout || 30}
              onChange={(e) => setConfig((c) => ({ ...c, timeout: Number(e.target.value) }))}
            />
            <Box display="flex" alignItems="center" gap={1}>
              <Typography variant="caption">Use Password</Typography>
              <Switch
                size="small"
                checked={!!config.password}
                onChange={(e) => setConfig((c) => ({ ...c, password: e.target.checked ? c.password : "" }))}
              />
            </Box>
          </Box>
        )}
      </Box>
    );
  },
);

export default SshAssetForm;

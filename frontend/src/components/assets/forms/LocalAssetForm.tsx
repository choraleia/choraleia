import React, { useState, useEffect, useImperativeHandle } from "react";
import { Box, Tabs, Tab, TextField, Typography, FormControl, Select, MenuItem } from "@mui/material";
import FolderIcon from "@mui/icons-material/Folder";
import { FolderTreeItem } from "../api/assets";
import { createAsset, updateAsset, AssetLike } from "../api/assets";

export interface LocalConfig {
  shell: string;
  working_dir?: string;
  environment?: Record<string, string>;
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
  folderPathResolver?: (id: string) => string; // added optional resolver
}

const LocalAssetForm = React.forwardRef<LocalAssetFormHandle, Props>(
  ({ asset, mode, folderTreeItems, defaultParentId = null, onSuccess, onValidityChange, folderPathResolver }, ref) => {
    const [tab, setTab] = useState<"basic" | "advanced">("basic");

    const [name, setName] = useState<string>(asset?.name || "");
    const [description, setDescription] = useState<string>(asset?.description || "");
    const [parentFolder, setParentFolder] = useState<string | null>(asset?.parent_id ?? defaultParentId ?? null);
    const [config, setConfig] = useState<LocalConfig>(() => {
      const cfg = (asset?.config || {}) as any;
      return {
        shell: cfg.shell || "/bin/bash",
        working_dir: cfg.working_dir || "",
        environment: cfg.environment || {},
      };
    });

    useEffect(() => {
      setName(asset?.name || "");
      setDescription(asset?.description || "");
      setParentFolder(asset?.parent_id ?? defaultParentId ?? null);
      const cfg = (asset?.config || {}) as any;
      setConfig({
        shell: cfg.shell || "/bin/bash",
        working_dir: cfg.working_dir || "",
        environment: cfg.environment || {},
      });
    }, [asset, defaultParentId]);

    const isValid = React.useMemo(() => {
      return !!name.trim() && !!config.shell;
    }, [name, config]);

    useEffect(() => {
      onValidityChange?.(isValid);
    }, [isValid, onValidityChange]);

    const folderSelect = (
      <FormControl>
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

    useImperativeHandle(ref, () => ({ submit, canSubmit: () => isValid }), [submit, isValid]);

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
            <TextField
              placeholder="Shell"
              value={config.shell || ""}
              onChange={(e) => setConfig((c) => ({ ...c, shell: e.target.value }))}
              required
            />
            <TextField
              placeholder="Working Dir"
              value={config.working_dir || ""}
              onChange={(e) => setConfig((c) => ({ ...c, working_dir: e.target.value }))}
            />
            <TextField
              placeholder="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              multiline
              minRows={2}
            />
          </Box>
        ) : (
          <Typography variant="body2" color="text.secondary">
            No advanced configuration available for this type
          </Typography>
        )}
      </Box>
    );
  },
);

export default LocalAssetForm;

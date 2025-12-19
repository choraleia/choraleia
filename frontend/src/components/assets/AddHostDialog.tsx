import React, { useState, useEffect, useRef } from "react";
import {
  Box,
  Tabs,
  Tab,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from "@mui/material";
import DesktopMacIcon from "@mui/icons-material/DesktopMac";
import SecurityIcon from "@mui/icons-material/Security";
import SshAssetForm, { SshAssetFormHandle } from "./forms/SshAssetForm";
import LocalAssetForm, { LocalAssetFormHandle } from "./forms/LocalAssetForm";
import { listFolders, buildFolderTreeItems } from "./api/assets";

// Component props type
interface AddHostWindowProps {
  onClose?: () => void;
  onSuccess?: (hostData: any) => void;
  parentId?: string;
  open?: boolean; // control Dialog visibility
  asset?: {
    id: string;
    name: string;
    type: AssetType | "folder";
    description?: string;
    config: Record<string, any>;
    parent_id?: string | null;
  } | null; // optional: edit existing asset
}

// Asset type definition
export type AssetType = "local" | "ssh";

const AddHostDialog: React.FC<AddHostWindowProps> = ({
  onClose,
  onSuccess,
  parentId,
  open = false,
  asset = null,
}) => {
  // Do not render when closed to avoid unnecessary state usage
  if (!open) return null;

  const isEdit = !!asset?.id;

  const initialType: AssetType =
    asset && (asset.type === "ssh" || asset.type === "local")
      ? (asset.type as AssetType)
      : "local";
  const [selectedType, setSelectedType] = useState<AssetType>(initialType);
  const [folderTreeItems, setFolderTreeItems] = useState<
    { id: string; name: string; depth: number }[]
  >([]);
  const [folderPathResolver, setFolderPathResolver] = useState<
    (id: string) => string
  >(() => () => "");
  const [loading, setLoading] = useState(false);
  const [isValid, setIsValid] = useState(false);

  const sshFormRef = useRef<SshAssetFormHandle>(null);
  const localFormRef = useRef<LocalAssetFormHandle>(null);

  const defaultParentId = asset?.parent_id ?? parentId ?? null;

  // Load folder list
  useEffect(() => {
    const loadFolders = async () => {
      try {
        const folders = await listFolders();
        setFolderTreeItems(buildFolderTreeItems(folders));
        setFolderPathResolver(() => (id: string) => {
          // Build path from latest fetched folders snapshot
          const idMap: Record<
            string,
            { id: string; name: string; parent_id: string | null }
          > = {};
          folders.forEach((f) => {
            idMap[f.id] = f as any;
          });
          const parts: string[] = [];
          const guard = new Set<string>();
          let cur = idMap[id];
          while (cur && !guard.has(cur.id)) {
            parts.push(cur.name);
            guard.add(cur.id);
            if (!cur.parent_id) break;
            cur = idMap[cur.parent_id!];
          }
          return parts.reverse().join("/");
        });
      } catch (error) {
        console.error("Failed to load folders:", error);
      }
    };
    loadFolders();
  }, []);

  const handleFormSuccess = () => {
    onSuccess?.(null);
    onClose?.();
  };

  const handleSubmit = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const ok =
        selectedType === "ssh"
          ? await sshFormRef.current?.submit()
          : await localFormRef.current?.submit();
      if (ok) return; // onSuccess closes dialog
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{isEdit ? "Edit Asset" : "Add Host"}</DialogTitle>
      <DialogContent dividers>
        <Box display="flex" flexDirection="row" height="100%" gap={2}>
          {/* Left asset type vertical Tabs */}
          <Tabs
            orientation="vertical"
            value={selectedType}
            onChange={(_, v) => !isEdit && setSelectedType(v as AssetType)}
            sx={{
              borderRight: 1,
              borderColor: "divider",
              minWidth: 160,
              alignItems: "flex-start",
            }}
          >
            <Tab
              key="local"
              value="local"
              label="Local"
              iconPosition="start"
              icon={<DesktopMacIcon />}
              disabled={isEdit}
              sx={{
                justifyContent: "flex-start",
                alignItems: "center",
                pl: 1,
                textAlign: "left",
              }}
            />
            <Tab
              key="ssh"
              value="ssh"
              label="SSH"
              iconPosition="start"
              icon={<SecurityIcon />}
              disabled={isEdit}
              sx={{
                justifyContent: "flex-start",
                alignItems: "center",
                pl: 1,
                textAlign: "left",
              }}
            />
          </Tabs>
          {/* Right side content: render type-specific form components with internal tabs */}
          <Box flex={1} display="flex" flexDirection="column" gap={2}>
            {selectedType === "ssh" ? (
              <SshAssetForm
                ref={sshFormRef}
                asset={asset}
                mode={isEdit ? "edit" : "create"}
                folderTreeItems={folderTreeItems}
                defaultParentId={defaultParentId}
                onSuccess={handleFormSuccess}
                onValidityChange={setIsValid}
                folderPathResolver={folderPathResolver}
              />
            ) : (
              <LocalAssetForm
                ref={localFormRef}
                asset={asset}
                mode={isEdit ? "edit" : "create"}
                folderTreeItems={folderTreeItems}
                defaultParentId={defaultParentId}
                onSuccess={handleFormSuccess}
                onValidityChange={setIsValid}
                folderPathResolver={folderPathResolver}
              />
            )}
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={loading || !isValid}
        >
          {loading
            ? isEdit
              ? "Updating..."
              : "Saving..."
            : isEdit
              ? "Update"
              : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default AddHostDialog;

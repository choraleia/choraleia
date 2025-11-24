import React, { useState, useEffect } from "react";
import {
  Box,
  Tabs,
  Tab,
  TextField,
  Select,
  MenuItem,
  Button,
  Switch,
  FormControl,
  InputLabel,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from "@mui/material";
import DesktopMacIcon from "@mui/icons-material/DesktopMac";
import SecurityIcon from "@mui/icons-material/Security";
import FolderIcon from "@mui/icons-material/Folder";
import {
  buildFolderTreeItems,
  getFolderPath,
  BasicFolder,
} from "./folderUtils";

// Component props type
interface AddHostWindowProps {
  onClose?: () => void;
  onSuccess?: (hostData: any) => void;
  parentId?: string;
  open?: boolean; // Added: control Dialog visibility
}

// Asset type definition
export type AssetType = "local" | "ssh";

// Asset type configuration
const assetTypeConfig: Record<
  AssetType,
  { name: string; icon: React.ReactNode; defaultConfig: any }
> = {
  local: {
    name: "Local Terminal",
    icon: <DesktopMacIcon />,
    defaultConfig: { shell: "/bin/bash", working_dir: "", environment: {} },
  },
  ssh: {
    name: "SSH",
    icon: <SecurityIcon />,
    defaultConfig: {
      host: "",
      port: 22,
      username: "",
      password: "",
      private_key_path: "",
      timeout: 30,
    },
  },
};

const API_BASE_URL = "http://wails.localhost:8088/api/assets";

const AddHostDialog: React.FC<AddHostWindowProps> = ({
  onClose,
  onSuccess,
  parentId,
  open = false,
}) => {
  // Do not render when closed to avoid unnecessary state usage
  if (!open) return null;

  const [selectedType, setSelectedType] = useState<AssetType>("ssh");
  const [loading, setLoading] = useState(false);
  const [folderOptions, setFolderOptions] = useState<BasicFolder[]>([]);
  const [activeTab, setActiveTab] = useState<"basic" | "advanced">("basic");

  // Form field unified state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [parentFolder, setParentFolder] = useState<string>("root");
  const [config, setConfig] = useState<any>(
    assetTypeConfig["ssh"].defaultConfig,
  );

  // Initialize defaults when asset type changes
  useEffect(() => {
    setConfig(assetTypeConfig[selectedType].defaultConfig);
  }, [selectedType]);

  // Load folder list
  const loadFolders = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}?type=folder`);
      const result = await response.json();
      if (result.code === 200) {
        const folders: BasicFolder[] = result.data.assets || [];
        setFolderOptions(folders);
      }
    } catch (error) {
      console.error("Failed to load folders:", error);
    }
  };
  useEffect(() => {
    loadFolders();
  }, []);

  // Create asset
  const createAsset = async () => {
    if (!name.trim()) return;
    if (selectedType === "ssh" && (!config.host || !config.username)) return;
    setLoading(true);
    try {
      let finalParentId: string | null = parentFolder;
      if (finalParentId === "root" || finalParentId === "" || !finalParentId) {
        finalParentId = parentId || null;
      }
      const assetData = {
        name: name.trim(),
        type: selectedType,
        description: description || "",
        config: { ...config },
        tags: [],
        parent_id: finalParentId,
      };
      const response = await fetch(API_BASE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(assetData),
      });
      const result = await response.json();
      if (result.code === 200) {
        onSuccess?.(assetData);
        onClose?.();
      } else {
        console.error(result.message);
      }
    } catch (error) {
      console.error("Failed to add asset", error);
    } finally {
      setLoading(false);
    }
  };

  const folderTreeItems = React.useMemo(
    () => buildFolderTreeItems(folderOptions),
    [folderOptions],
  );

  // Basic config form
  function renderBasicConfigForm() {
    const folderSelect = (
      <FormControl>
        <Select
          value={parentFolder}
          renderValue={(value) => {
            if (value === "root") return "/";
            if (typeof value === "string")
              return "/" + getFolderPath(value, folderOptions);
            return "";
          }}
          onChange={(e) => setParentFolder(e.target.value)}
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
    switch (selectedType) {
      case "ssh":
        return (
          <Box display="flex" flexDirection="column" gap={2}>
            {folderSelect}
            <TextField
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <Box display="flex" gap={2}>
              <TextField
                placeholder="Username"
                value={config.username || ""}
                onChange={(e) =>
                  setConfig((c: any) => ({ ...c, username: e.target.value }))
                }
                required
                sx={{ flex: 1 }}
              />
              <TextField
                placeholder="Host"
                value={config.host || ""}
                onChange={(e) =>
                  setConfig((c: any) => ({ ...c, host: e.target.value }))
                }
                required
                sx={{ flex: 1 }}
              />
              <TextField
                placeholder="Port"
                type="number"
                value={config.port || 22}
                onChange={(e) =>
                  setConfig((c: any) => ({
                    ...c,
                    port: Number(e.target.value),
                  }))
                }
                required
                sx={{ width: 120 }}
              />
            </Box>
            <TextField
              placeholder="Password"
              type="password"
              value={config.password || ""}
              onChange={(e) =>
                setConfig((c: any) => ({ ...c, password: e.target.value }))
              }
            />
            <TextField
              placeholder="Private Key Path"
              value={config.private_key_path || ""}
              onChange={(e) =>
                setConfig((c: any) => ({
                  ...c,
                  private_key_path: e.target.value,
                }))
              }
            />
            <TextField
              placeholder="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              multiline
              minRows={2}
            />
          </Box>
        );
      case "local":
        return (
          <Box display="flex" flexDirection="column" gap={2}>
            {folderSelect}
            <TextField
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <TextField
              placeholder="Shell"
              value={config.shell || ""}
              onChange={(e) =>
                setConfig((c: any) => ({ ...c, shell: e.target.value }))
              }
              required
            />
            <TextField
              placeholder="Working Dir"
              value={config.working_dir || ""}
              onChange={(e) =>
                setConfig((c: any) => ({ ...c, working_dir: e.target.value }))
              }
            />
            <TextField
              placeholder="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              multiline
              minRows={2}
            />
          </Box>
        );
    }
  }

  // Advanced config (only SSH shows timeout)
  function renderAdvancedConfigForm() {
    if (selectedType === "ssh") {
      return (
        <Box display="flex" flexDirection="column" gap={2}>
          <TextField
            placeholder="Timeout"
            type="number"
            value={config.timeout || 30}
            onChange={(e) =>
              setConfig((c: any) => ({ ...c, timeout: Number(e.target.value) }))
            }
          />
          <Box display="flex" alignItems="center" gap={1}>
            <Typography variant="caption">Use Password</Typography>
            <Switch
              size="small"
              checked={!!config.password}
              onChange={(e) =>
                setConfig((c: any) => ({
                  ...c,
                  password: e.target.checked ? c.password : "",
                }))
              }
            />
          </Box>
        </Box>
      );
    }
    return (
      <Typography variant="body2" color="text.secondary">
        No advanced configuration available for this type
      </Typography>
    );
  }

  // Wrap original return content with Dialog
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Add Host</DialogTitle>
      <DialogContent dividers>
        <Box display="flex" flexDirection="row" height="100%" gap={2}>
          {/* Left asset type vertical Tabs */}
          <Tabs
            orientation="vertical"
            value={selectedType}
            onChange={(_, v) => setSelectedType(v as AssetType)}
            sx={{
              borderRight: 1,
              borderColor: "divider",
              minWidth: 160,
              alignItems: "flex-start",
            }}
          >
            {Object.entries(assetTypeConfig).map(([k, v]) => (
              <Tab
                key={k}
                value={k}
                label={v.name}
                iconPosition="start"
                icon={v.icon as any}
                sx={{
                  justifyContent: "flex-start",
                  alignItems: "center",
                  pl: 1,
                  textAlign: "left",
                }}
              />
            ))}
          </Tabs>
          {/* Right side content */}
          <Box flex={1} display="flex" flexDirection="column" gap={2}>
            <Tabs
              value={activeTab}
              onChange={(_, v) => setActiveTab(v)}
              sx={{ mb: 1 }}
            >
              <Tab label="Basic" value="basic" />
              <Tab label="Advanced" value="advanced" />
            </Tabs>
            {activeTab === "basic" && renderBasicConfigForm()}
            {activeTab === "advanced" && renderAdvancedConfigForm()}
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={createAsset} disabled={loading}>
          {loading ? "Saving..." : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default AddHostDialog;

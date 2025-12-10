import React, { useEffect, useState } from "react";
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
  Stack,
  Select,
  MenuItem,
  Chip,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import AddIcon from "@mui/icons-material/Add";
import { SpaceConfigInput, WorkDirectory, HostAssetConfig, K8sAssetConfig, ToolConfig } from "../../state/workspaces";
import Editor from "@monaco-editor/react";

interface SpaceConfigDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (config: SpaceConfigInput) => void;
  initialConfig: SpaceConfigInput;
}

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

const createWorkDir = (kind: "local" | "docker" = "local"): WorkDirectory => ({
  id: uid(),
  kind,
  path: kind === "local" ? "~/" : "/workspace",
  container: kind === "docker" ? "container-id" : undefined,
});

const createHostAsset = (): HostAssetConfig => ({
  id: uid(),
  name: "Host",
  address: "192.168.0.1",
  allowedServices: [],
});

const createK8sAsset = (): K8sAssetConfig => ({
  id: uid(),
  name: "Cluster",
  namespace: "default",
  allowedServices: [],
});

const createTool = (): ToolConfig => ({
  id: uid(),
  name: "Tool",
  type: "mcp",
  description: "",
});

const SpaceConfigDialog: React.FC<SpaceConfigDialogProps> = ({ open, onClose, onSave, initialConfig }) => {
  const [tab, setTab] = useState(0);
  const [state, setState] = useState<SpaceConfigInput>(initialConfig);
  const [hostServiceInput, setHostServiceInput] = useState<Record<string, string>>({});
  const [k8sServiceInput, setK8sServiceInput] = useState<Record<string, string>>({});

  useEffect(() => {
    setState(initialConfig);
  }, [initialConfig]);

  const handleChange = (patch: Partial<SpaceConfigInput>) => {
    setState((prev) => ({ ...prev, ...patch }));
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

  const handleSave = () => {
    onSave(state);
  };

  const tabs = ["General", "Directories", "Assets", "Tools"];
  const handleEditorChange = (value?: string) => {
    setState((prev) => ({ ...prev, description: value ?? "" }));
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="lg">
      <DialogTitle>Space Configuration</DialogTitle>
      <Tabs value={tab} onChange={(_, value) => setTab(value)} variant="scrollable">
        {tabs.map((label) => (
          <Tab key={label} label={label} />
        ))}
      </Tabs>
      <DialogContent dividers>
        {tab === 0 && (
          <Stack spacing={2}>
            <TextField
              label="Name"
              value={state.name}
              onChange={(e) => handleChange({ name: e.target.value })}
              fullWidth
            />
            <Box sx={{ "& .monaco-editor .margin": { width: 0 }, "& .monaco-editor .margin-view-overlays": { width: 0 } }}>
              <Editor
                height="200px"
                defaultLanguage="markdown"
                value={state.description}
                onChange={handleEditorChange}
                options={{
                  minimap: { enabled: false },
                  fontSize: 14,
                  lineNumbers: "off",
                  glyphMargin: false,
                  lineDecorationsWidth: 0,
                  lineNumbersMinChars: 0,
                  folding: false,
                }}
              />
            </Box>
          </Stack>
        )}
        {tab === 1 && (
          <Stack spacing={1.5}>
            {state.workDirectories.map((dir) => (
              <Box key={dir.id} display="flex" gap={1} alignItems="center">
                <Select
                  size="small"
                  value={dir.kind}
                  onChange={(e) =>
                    setState((prev) => ({
                      ...prev,
                      workDirectories: prev.workDirectories.map((item) =>
                        item.id === dir.id ? { ...item, kind: e.target.value as WorkDirectory["kind"] } : item,
                      ),
                    }))
                  }
                  sx={{ width: 140 }}
                >
                  <MenuItem value="local">Local</MenuItem>
                  <MenuItem value="docker">Docker</MenuItem>
                </Select>
                <TextField
                  label="Path"
                  value={dir.path}
                  onChange={(e) =>
                    setState((prev) => ({
                      ...prev,
                      workDirectories: prev.workDirectories.map((item) =>
                        item.id === dir.id ? { ...item, path: e.target.value } : item,
                      ),
                    }))
                  }
                  fullWidth
                />
                {dir.kind === "docker" && (
                  <TextField
                    label="Container"
                    value={dir.container || ""}
                    onChange={(e) =>
                      setState((prev) => ({
                        ...prev,
                        workDirectories: prev.workDirectories.map((item) =>
                          item.id === dir.id ? { ...item, container: e.target.value } : item,
                        ),
                      }))
                    }
                    sx={{ width: 160 }}
                  />
                )}
                <IconButton
                  onClick={() =>
                    setState((prev) => ({
                      ...prev,
                      workDirectories: prev.workDirectories.filter((item) => item.id !== dir.id),
                    }))
                  }
                  size="small"
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Box>
            ))}
            <Button
              variant="outlined"
              size="small"
              startIcon={<AddIcon fontSize="small" />}
              onClick={() =>
                setState((prev) => ({
                  ...prev,
                  workDirectories: [...prev.workDirectories, createWorkDir()],
                }))
              }
            >
              Add Directory
            </Button>
          </Stack>
        )}
        {tab === 2 && (
          <Stack spacing={2}>
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Host Assets
              </Typography>
              <Stack spacing={1}>
                {state.assets.hosts.map((host) => (
                  <Stack key={host.id} spacing={1} border={(theme) => `1px solid ${theme.palette.divider}`} borderRadius={1.5} p={1.25}>
                    <Box display="flex" gap={1} alignItems="center">
                      <TextField
                        label="Name"
                        value={host.name}
                        onChange={(e) =>
                          setState((prev) => ({
                            ...prev,
                            assets: {
                              ...prev.assets,
                              hosts: prev.assets.hosts.map((item) =>
                                item.id === host.id ? { ...item, name: e.target.value } : item,
                              ),
                            },
                          }))
                        }
                        sx={{ width: 160 }}
                      />
                      <TextField
                        label="Address"
                        value={host.address}
                        onChange={(e) =>
                          setState((prev) => ({
                            ...prev,
                            assets: {
                              ...prev.assets,
                              hosts: prev.assets.hosts.map((item) =>
                                item.id === host.id ? { ...item, address: e.target.value } : item,
                              ),
                            },
                          }))
                        }
                        fullWidth
                      />
                      <IconButton
                        size="small"
                        onClick={() =>
                          setState((prev) => ({
                            ...prev,
                            assets: {
                              ...prev.assets,
                              hosts: prev.assets.hosts.filter((item) => item.id !== host.id),
                            },
                          }))
                        }
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Box>
                    <Box display="flex" gap={1} alignItems="center" flexWrap="wrap">
                      {host.allowedServices.map((svc) => (
                        <Chip
                          key={svc}
                          label={svc}
                          size="small"
                          onDelete={() =>
                            setState((prev) => ({
                              ...prev,
                              assets: {
                                ...prev.assets,
                                hosts: prev.assets.hosts.map((item) =>
                                  item.id === host.id
                                    ? {
                                        ...item,
                                        allowedServices: item.allowedServices.filter((s) => s !== svc),
                                      }
                                    : item,
                                ),
                              },
                            }))
                          }
                        />
                      ))}
                      <TextField
                        size="small"
                        label="Allow service"
                        value={hostServiceInput[host.id] || ""}
                        onChange={(e) => updateHostService(host.id, e.target.value)}
                        sx={{ minWidth: 160 }}
                      />
                      <Button size="small" variant="outlined" onClick={() => addHostService(host.id)}>
                        Add
                      </Button>
                    </Box>
                  </Stack>
                ))}
                {state.assets.hosts.length === 0 && (
                  <Typography variant="body2" color="text.secondary">
                    No host assets yet.
                  </Typography>
                )}
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<AddIcon fontSize="small" />}
                  onClick={() =>
                    setState((prev) => ({
                      ...prev,
                      assets: {
                        ...prev.assets,
                        hosts: [...prev.assets.hosts, createHostAsset()],
                      },
                    }))
                  }
                >
                  Add Host
                </Button>
              </Stack>
            </Box>
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Kubernetes Assets
              </Typography>
              <Stack spacing={1}>
                {state.assets.k8s.map((cluster) => (
                  <Stack key={cluster.id} spacing={1} border={(theme) => `1px solid ${theme.palette.divider}`} borderRadius={1.5} p={1.25}>
                    <Box display="flex" gap={1} alignItems="center">
                      <TextField
                        label="Name"
                        value={cluster.name}
                        onChange={(e) =>
                          setState((prev) => ({
                            ...prev,
                            assets: {
                              ...prev.assets,
                              k8s: prev.assets.k8s.map((item) =>
                                item.id === cluster.id ? { ...item, name: e.target.value } : item,
                              ),
                            },
                          }))
                        }
                        sx={{ width: 160 }}
                      />
                      <TextField
                        label="Namespace"
                        value={cluster.namespace}
                        onChange={(e) =>
                          setState((prev) => ({
                            ...prev,
                            assets: {
                              ...prev.assets,
                              k8s: prev.assets.k8s.map((item) =>
                                item.id === cluster.id ? { ...item, namespace: e.target.value } : item,
                              ),
                            },
                          }))
                        }
                        sx={{ width: 160 }}
                      />
                      <IconButton
                        size="small"
                        onClick={() =>
                          setState((prev) => ({
                            ...prev,
                            assets: {
                              ...prev.assets,
                              k8s: prev.assets.k8s.filter((item) => item.id !== cluster.id),
                            },
                          }))
                        }
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Box>
                    <Box display="flex" gap={1} alignItems="center" flexWrap="wrap">
                      {cluster.allowedServices.map((svc) => (
                        <Chip
                          key={svc}
                          label={svc}
                          size="small"
                          onDelete={() =>
                            setState((prev) => ({
                              ...prev,
                              assets: {
                                ...prev.assets,
                                k8s: prev.assets.k8s.map((item) =>
                                  item.id === cluster.id
                                    ? {
                                        ...item,
                                        allowedServices: item.allowedServices.filter((s) => s !== svc),
                                      }
                                    : item,
                                ),
                              },
                            }))
                          }
                        />
                      ))}
                      <TextField
                        size="small"
                        label="Allow service"
                        value={k8sServiceInput[cluster.id] || ""}
                        onChange={(e) => updateK8sService(cluster.id, e.target.value)}
                        sx={{ minWidth: 160 }}
                      />
                      <Button size="small" variant="outlined" onClick={() => addK8sService(cluster.id)}>
                        Add
                      </Button>
                    </Box>
                  </Stack>
                ))}
                {state.assets.k8s.length === 0 && (
                  <Typography variant="body2" color="text.secondary">
                    No Kubernetes clusters configured.
                  </Typography>
                )}
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<AddIcon fontSize="small" />}
                  onClick={() =>
                    setState((prev) => ({
                      ...prev,
                      assets: {
                        ...prev.assets,
                        k8s: [...prev.assets.k8s, createK8sAsset()],
                      },
                    }))
                  }
                >
                  Add Cluster
                </Button>
              </Stack>
            </Box>
          </Stack>
        )}
        {tab === 3 && (
          <Stack spacing={1.5}>
            {state.tools.map((tool) => (
              <Box key={tool.id} display="flex" gap={1} alignItems="center">
                <TextField
                  label="Name"
                  value={tool.name}
                  onChange={(e) =>
                    setState((prev) => ({
                      ...prev,
                      tools: prev.tools.map((item) =>
                        item.id === tool.id ? { ...item, name: e.target.value } : item,
                      ),
                    }))
                  }
                  sx={{ width: 160 }}
                />
                <TextField
                  label="Type"
                  value={tool.type}
                  onChange={(e) =>
                    setState((prev) => ({
                      ...prev,
                      tools: prev.tools.map((item) =>
                        item.id === tool.id ? { ...item, type: e.target.value } : item,
                      ),
                    }))
                  }
                  sx={{ width: 160 }}
                />
                <TextField
                  label="Description"
                  value={tool.description || ""}
                  onChange={(e) =>
                    setState((prev) => ({
                      ...prev,
                      tools: prev.tools.map((item) =>
                        item.id === tool.id ? { ...item, description: e.target.value } : item,
                      ),
                    }))
                  }
                  fullWidth
                />
                <IconButton
                  size="small"
                  onClick={() =>
                    setState((prev) => ({
                      ...prev,
                      tools: prev.tools.filter((item) => item.id !== tool.id),
                    }))
                  }
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Box>
            ))}
            {state.tools.length === 0 && (
              <Typography variant="body2" color="text.secondary">
                No tools configured.
              </Typography>
            )}
            <Button
              variant="outlined"
              size="small"
              startIcon={<AddIcon fontSize="small" />}
              onClick={() =>
                setState((prev) => ({
                  ...prev,
                  tools: [...prev.tools, createTool()],
                }))
              }
            >
              Add Tool
            </Button>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default SpaceConfigDialog;


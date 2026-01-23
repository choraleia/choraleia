import React, { useEffect, useState } from "react";
import {
  Box,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Select,
  MenuItem,
  Typography,
  FormControl,
  Chip,
  IconButton,
  Collapse,
  Card,
  CardContent,
  Tooltip,
  InputAdornment,
  CircularProgress,
  Autocomplete,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import SettingsIcon from "@mui/icons-material/Settings";
import DeleteIcon from "@mui/icons-material/Delete";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import { getApiUrl } from "../../api/base";

// ============================================================
// Type Definitions
// ============================================================

type ModelDomain = "language" | "embedding" | "vision" | "audio" | "video" | "multimodal";

interface ModelCapabilities {
  reasoning?: boolean;
  function_call?: boolean;
  streaming?: boolean;
  json_mode?: boolean;
  system_prompt?: boolean;
  context_caching?: boolean;
  realtime?: boolean;
  batch?: boolean;
  fine_tuning?: boolean;
}

interface ModelLimits {
  context_window?: number;
  max_tokens?: number;
}

interface ModelPreset {
  model: string;
  name: string;
  domain: string;
  task_types: string[];
  capabilities: ModelCapabilities;
  limits?: ModelLimits;
  description?: string;
}

interface ExtraField {
  key: string;
  label: string;
  required: boolean;
  placeholder?: string;
}

interface ProviderPreset {
  id: string;
  name: string;
  base_url: string;
  presets: ModelPreset[];
  extra_fields?: ExtraField[];
}

// ============================================================
// Constants
// ============================================================

const MODEL_CAPABILITY_OPTIONS: { key: keyof ModelCapabilities; label: string }[] = [
  { key: "reasoning", label: "Reasoning" },
  { key: "function_call", label: "Function Call" },
  { key: "streaming", label: "Streaming" },
  { key: "json_mode", label: "JSON Mode" },
  { key: "system_prompt", label: "System Prompt" },
  { key: "context_caching", label: "Context Cache" },
  { key: "realtime", label: "Realtime" },
  { key: "batch", label: "Batch" },
];

// Domain definitions
const DOMAINS: { value: ModelDomain; label: string }[] = [
  { value: "language", label: "Language" },
  { value: "embedding", label: "Embedding" },
  { value: "vision", label: "Vision" },
  { value: "audio", label: "Audio" },
  { value: "video", label: "Video" },
  { value: "multimodal", label: "Multimodal" },
];

// Task type definitions grouped by domain
const TASK_TYPES: { value: string; label: string; domain: ModelDomain }[] = [
  // Language
  { value: "chat", label: "Chat / Completion", domain: "language" },
  // Embedding
  { value: "text_embedding", label: "Text Embedding", domain: "embedding" },
  { value: "rerank", label: "Rerank", domain: "embedding" },
  // Vision
  { value: "image_understanding", label: "Image Understanding", domain: "vision" },
  { value: "image_generation", label: "Image Generation", domain: "vision" },
  // Audio
  { value: "speech_to_text", label: "Speech to Text", domain: "audio" },
  { value: "text_to_speech", label: "Text to Speech", domain: "audio" },
  // Video
  { value: "video_understanding", label: "Video Understanding", domain: "video" },
  { value: "video_generation", label: "Video Generation", domain: "video" },
];

// Domain to task types mapping
const DOMAIN_TASK_MAPPING: Record<ModelDomain, string[]> = {
  language: ["chat"],
  embedding: ["text_embedding", "rerank"],
  vision: ["image_understanding", "image_generation"],
  audio: ["speech_to_text", "text_to_speech"],
  video: ["video_understanding", "video_generation"],
  multimodal: ["chat", "image_understanding", "speech_to_text", "text_to_speech", "video_understanding"],
};

// ============================================================
// Helper Functions
// ============================================================

function formatTaskTypes(taskTypes?: string[]) {
  if (!taskTypes?.length) return "-";
  return taskTypes.map(t => {
    const task = TASK_TYPES.find(tt => tt.value === t);
    return task?.label || t;
  }).join(", ");
}

function getTaskTypeLabel(taskType: string) {
  const task = TASK_TYPES.find(t => t.value === taskType);
  return task?.label || taskType;
}

function getDomainLabel(domain: string) {
  const d = DOMAINS.find(d => d.value === domain);
  return d?.label || domain;
}

// Check if domain needs limits and capabilities configuration
// Only language/multimodal/vision models need context_window, max_tokens, and capabilities
function needsLimitsAndCapabilities(domain: string): boolean {
  return ["language", "multimodal", "vision"].includes(domain);
}

// ============================================================
// Main Component
// ============================================================

const Models: React.FC = () => {
  return (
    <Box p={2} height="100%" overflow="auto">
      <ModelManager />
    </Box>
  );
};

// ============================================================
// Model Manager Component
// ============================================================

const ModelManager: React.FC = () => {
  const [models, setModels] = useState<any[]>([]);
  const [providers, setProviders] = useState<ProviderPreset[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);

  const fetchModels = async () => {
    setLoading(true);
    try {
      const res = await fetch(getApiUrl("/api/models"));
      const data = await res.json();
      if (data.code === 200) {
        setModels(data.data || []);
      }
    } catch (e) {
      console.error("Failed to fetch models", e);
    }
    setLoading(false);
  };

  const fetchPresets = async () => {
    try {
      const res = await fetch(getApiUrl("/api/models/presets"));
      const data = await res.json();
      if (data.code === 200 && data.data?.providers) {
        setProviders(data.data.providers);
      }
    } catch (e) {
      console.error("Failed to fetch presets", e);
    }
  };

  useEffect(() => {
    fetchModels();
    fetchPresets();
  }, []);

  const handleDelete = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this model?")) return;
    try {
      const res = await fetch(getApiUrl(`/api/models/${id}`), { method: "DELETE" });
      const data = await res.json();
      if (data.code === 200) fetchModels();
    } catch (e) {
      console.error("Failed to delete model", e);
    }
  };

  // Group models by provider
  const groupedModels = models.reduce((acc: Record<string, any[]>, m: any) => {
    const p = m.provider || "unknown";
    if (!acc[p]) acc[p] = [];
    acc[p].push(m);
    return acc;
  }, {});

  const getProviderName = (providerId: string) => {
    const provider = providers.find((p) => p.id === providerId);
    return provider?.name || providerId;
  };

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h6">Models</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setShowAddDialog(true)}>
          Add Model
        </Button>
      </Box>

      {loading ? (
        <Box display="flex" justifyContent="center" py={4}>
          <CircularProgress size={24} />
        </Box>
      ) : models.length === 0 ? (
        <Box textAlign="center" py={4} color="text.secondary">
          <Typography>No models configured</Typography>
          <Typography variant="body2">Click "Add Model" to get started</Typography>
        </Box>
      ) : (
        <Box>
          {Object.entries(groupedModels).map(([provider, providerModels]) => (
            <Box key={provider} mb={3}>
              <Typography fontWeight={600} fontSize={14} mb={1} textTransform="capitalize">
                {getProviderName(provider)}
              </Typography>
              <Box display="flex" flexDirection="column" gap={1}>
                {providerModels.map((model: any) => (
                  <Card key={model.id} variant="outlined" sx={{ bgcolor: "#fafafa" }}>
                    <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
                      <Box display="flex" justifyContent="space-between" alignItems="center">
                        <Box>
                          <Typography fontWeight={500} fontSize={14}>
                            {model.name}
                          </Typography>
                          <Typography fontSize={12} color="text.secondary">
                            {model.model} · {getDomainLabel(model.domain || "language")} · {model.limits?.context_window ? `${(model.limits.context_window / 1000).toFixed(0)}K` : '-'} / {model.limits?.max_tokens ? `${(model.limits.max_tokens / 1000).toFixed(0)}K` : '-'}
                          </Typography>
                        </Box>
                        <IconButton size="small" color="error" onClick={() => handleDelete(model.id)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    </CardContent>
                  </Card>
                ))}
              </Box>
            </Box>
          ))}
        </Box>
      )}

      <AddModelDialog
        open={showAddDialog}
        onClose={() => setShowAddDialog(false)}
        providers={providers}
        onSuccess={() => {
          setShowAddDialog(false);
          fetchModels();
        }}
      />
    </Box>
  );
};

// ============================================================
// Add Model Dialog
// ============================================================

interface AddModelDialogProps {
  open: boolean;
  onClose: () => void;
  providers: ProviderPreset[];
  onSuccess: () => void;
}

const AddModelDialog: React.FC<AddModelDialogProps> = ({ open, onClose, providers, onSuccess }) => {
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [savedApiKeys, setSavedApiKeys] = useState<{ value: string; display: string }[]>([]);
  const [savedBaseUrls, setSavedBaseUrls] = useState<string[]>([]);
  const [customModel, setCustomModel] = useState<{
    model: string;
    name: string;
    domain: string;
    task_types: string[];
    capabilities: ModelCapabilities;
    limits: ModelLimits;
    base_url: string;
    extra: Record<string, string>;
  }>({
    model: "",
    name: "",
    domain: "language",
    task_types: ["chat"],
    capabilities: { streaming: true, system_prompt: true },
    limits: { context_window: 128000, max_tokens: 4096 },
    base_url: "",
    extra: {},
  });
  const [expandedPreset, setExpandedPreset] = useState<string | null>(null);
  const [presetOverrides, setPresetOverrides] = useState<Record<string, Partial<ModelPreset>>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [error, setError] = useState("");

  const provider = providers.find((p) => p.id === selectedProvider);

  // Fetch saved API keys when provider changes
  const fetchSavedKeys = async (providerId: string) => {
    try {
      const res = await fetch(getApiUrl(`/api/models/provider-keys?provider=${providerId}`));
      const data = await res.json();
      if (data.code === 200 && data.data) {
        setSavedApiKeys(data.data.api_keys || []);
        setSavedBaseUrls(data.data.base_urls || []);
      }
    } catch (e) {
      console.error("Failed to fetch saved keys", e);
    }
  };

  // Set default provider when providers are loaded
  useEffect(() => {
    if (providers.length > 0 && !selectedProvider) {
      setSelectedProvider(providers[0].id);
    }
  }, [providers]);

  // Reset state when provider changes
  useEffect(() => {
    setApiKey("");
    setShowCustomForm(false);
    setExpandedPreset(null);
    setPresetOverrides({});
    setError("");
    setTestResult(null);
    setSavedApiKeys([]);
    setSavedBaseUrls([]);
    setCustomModel({
      model: "",
      name: "",
      domain: "language",
      task_types: ["chat"],
      capabilities: { streaming: true, system_prompt: true },
      limits: { context_window: 128000, max_tokens: 4096 },
      base_url: provider?.base_url || "",
      extra: {},
    });
    if (selectedProvider) {
      fetchSavedKeys(selectedProvider);
    }
  }, [selectedProvider]);


  const handleAddPreset = async (preset: ModelPreset) => {
    if (!apiKey && selectedProvider !== "ollama") {
      setError("API Key is required");
      return;
    }
    setSaving(true);
    setError("");
    const overrides = presetOverrides[preset.model] || {};
    const domain = overrides.domain || preset.domain;
    const needsConfig = needsLimitsAndCapabilities(domain);

    const payload: Record<string, unknown> = {
      provider: selectedProvider,
      model: overrides.model || preset.model,
      name: overrides.name || preset.name,
      domain: domain,
      task_types: overrides.task_types || preset.task_types,
      base_url: customModel.base_url || provider?.base_url || "",
      api_key: apiKey,
      extra: customModel.extra,
    };
    // Only include limits and capabilities for domains that need them
    if (needsConfig) {
      payload.capabilities = overrides.capabilities || preset.capabilities;
      payload.limits = overrides.limits || preset.limits;
    }
    try {
      const res = await fetch(getApiUrl("/api/models"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.code === 200) {
        onSuccess();
      } else {
        setError(data.message || "Failed to add model");
      }
    } catch (e) {
      setError("Network error");
    }
    setSaving(false);
  };

  const handleAddCustomModel = async () => {
    if (!customModel.model || !customModel.name) {
      setError("Model ID and Name are required");
      return;
    }
    if (!apiKey && selectedProvider !== "ollama") {
      setError("API Key is required");
      return;
    }
    setSaving(true);
    setError("");

    const needsConfig = needsLimitsAndCapabilities(customModel.domain);
    const payload: Record<string, unknown> = {
      provider: selectedProvider,
      model: customModel.model,
      name: customModel.name,
      domain: customModel.domain,
      task_types: customModel.task_types,
      base_url: customModel.base_url || provider?.base_url || "",
      api_key: apiKey,
      extra: customModel.extra,
    };
    // Only include limits and capabilities for domains that need them
    if (needsConfig) {
      payload.capabilities = customModel.capabilities;
      payload.limits = customModel.limits;
    }
    try {
      const res = await fetch(getApiUrl("/api/models"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.code === 200) {
        onSuccess();
      } else {
        setError(data.message || "Failed to add model");
      }
    } catch (e) {
      setError("Network error");
    }
    setSaving(false);
  };

  const updatePresetOverride = (modelId: string, field: string, value: any) => {
    setPresetOverrides((prev) => ({
      ...prev,
      [modelId]: { ...prev[modelId], [field]: value },
    }));
  };

  const handleTestConnection = async (modelId: string, modelName: string, taskTypes: string[]) => {
    setTesting(true);
    setTestResult(null);

    const payload = {
      provider: selectedProvider,
      model: modelId,
      name: modelName,
      task_types: taskTypes,
      base_url: customModel.base_url || provider?.base_url || "",
      api_key: apiKey,
      extra: customModel.extra,
    };
    try {
      const res = await fetch(getApiUrl("/api/models/test"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.code === 200 && data.success) {
        setTestResult({ success: true, message: "Connection successful!" });
      } else {
        setTestResult({ success: false, message: data.message || "Connection failed" });
      }
    } catch (e) {
      setTestResult({ success: false, message: "Network error" });
    }
    setTesting(false);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth PaperProps={{ sx: { height: "80vh" } }}>
      <DialogTitle>Add Model</DialogTitle>
      <DialogContent sx={{ p: 0, display: "flex", height: "100%" }}>
        {/* Left: Provider List */}
        <Box
          sx={{
            width: 200,
            borderRight: "1px solid #e5e7eb",
            overflowY: "auto",
          }}
        >
          {providers.map((p) => (
            <Box
              key={p.id}
              onClick={() => setSelectedProvider(p.id)}
              sx={{
                px: 2,
                py: 1,
                cursor: "pointer",
                borderLeft: selectedProvider === p.id ? "3px solid #1976d2" : "3px solid transparent",
                "&:hover": { bgcolor: "#f5f5f5" },
              }}
            >
              <Typography fontSize={13} fontWeight={selectedProvider === p.id ? 600 : 400}>
                {p.name}
              </Typography>
            </Box>
          ))}
        </Box>

        {/* Right: Configuration */}
        <Box flex={1} p={2} overflow="auto">
          {/* Base URL (optional override) */}
          <Box mb={1.5}>
            <Typography fontSize={12} color="text.secondary" mb={1}>
              Base URL (optional)
            </Typography>
            <Autocomplete
              freeSolo
              size="small"
              options={savedBaseUrls}
              value={customModel.base_url}
              onChange={(_, newValue) => setCustomModel((m) => ({ ...m, base_url: newValue || "" }))}
              onInputChange={(_, newValue) => setCustomModel((m) => ({ ...m, base_url: newValue }))}
              renderInput={(params) => (
                <TextField
                  {...params}
                  placeholder={provider?.base_url || "https://api.example.com/v1"}
                />
              )}
            />
          </Box>

          {/* API Key Section */}
          <Box mb={3}>
            <Typography fontSize={12} color="text.secondary" mb={1}>
              API Key {selectedProvider !== "ollama" && <span style={{ color: "#f44336" }}>*</span>}
            </Typography>
            <Autocomplete
              freeSolo
              size="small"
              options={savedApiKeys}
              getOptionLabel={(option) => typeof option === "string" ? option : option.display}
              value={apiKey}
              onChange={(_, newValue) => {
                if (typeof newValue === "string") {
                  setApiKey(newValue);
                } else if (newValue) {
                  setApiKey(newValue.value);
                } else {
                  setApiKey("");
                }
              }}
              onInputChange={(_, newValue) => setApiKey(newValue)}
              renderOption={(props, option) => (
                <li {...props} key={typeof option === "string" ? option : option.value}>
                  {typeof option === "string" ? option : option.display}
                </li>
              )}
              renderInput={(params) => (
                <TextField
                  {...params}
                  placeholder="Enter or select API Key"
                  type={showApiKey ? "text" : "password"}
                  InputProps={{
                    ...params.InputProps,
                    endAdornment: (
                      <>
                        {params.InputProps.endAdornment}
                        <InputAdornment position="end">
                          <IconButton size="small" onClick={() => setShowApiKey(!showApiKey)}>
                            {showApiKey ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                          </IconButton>
                        </InputAdornment>
                      </>
                    ),
                  }}
                />
              )}
            />
          </Box>

          {/* Extra Fields for specific providers */}
          {provider?.extra_fields?.map((field) => (
            <Box key={field.key} mb={2}>
              <Typography fontSize={12} color="text.secondary" mb={0.5}>
                {field.label} {field.required && <span style={{ color: "#f44336" }}>*</span>}
              </Typography>
              <TextField
                size="small"
                fullWidth
                placeholder={field.placeholder}
                value={customModel.extra[field.key] || ""}
                onChange={(e) =>
                  setCustomModel((m) => ({ ...m, extra: { ...m.extra, [field.key]: e.target.value } }))
                }
              />
            </Box>
          ))}

          {/* Quick Add Presets */}
          {provider && provider.presets && provider.presets.length > 0 && (
            <Box mb={3}>
              <Box display="flex" alignItems="center" gap={1} mb={1}>
                <Typography fontSize={12} color="text.secondary">
                  Quick Add
                </Typography>
              </Box>
              <Box display="flex" flexDirection="column" gap={1}>
                {provider.presets.map((preset) => {
                  const isExpanded = expandedPreset === preset.model;
                  const override = presetOverrides[preset.model] || {};

                  return (
                    <Card key={preset.model} variant="outlined">
                      <Box
                        display="flex"
                        alignItems="center"
                        justifyContent="space-between"
                        px={2}
                        py={1}
                        sx={{ cursor: "pointer" }}
                        onClick={() => setExpandedPreset(isExpanded ? null : preset.model)}
                      >
                        <Box flex={1}>
                          <Box display="flex" alignItems="center" gap={1}>
                            <Typography fontSize={14} fontWeight={500}>
                              {preset.name}
                            </Typography>
                          </Box>
                          <Typography fontSize={11} color="text.secondary">
                            {preset.model} · {getDomainLabel(preset.domain)} · {preset.limits?.context_window ? `${(preset.limits.context_window / 1000).toFixed(0)}K` : '-'} / {preset.limits?.max_tokens ? `${(preset.limits.max_tokens / 1000).toFixed(0)}K` : '-'}
                          </Typography>
                        </Box>
                        <Box display="flex" alignItems="center" gap={1}>
                          <Tooltip title="Configure">
                            <IconButton size="small" onClick={(e) => { e.stopPropagation(); setExpandedPreset(isExpanded ? null : preset.model); }}>
                              <SettingsIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Button
                            size="small"
                            variant="contained"
                            disabled={saving}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAddPreset(preset);
                            }}
                          >
                            Add
                          </Button>
                        </Box>
                      </Box>
                      <Collapse in={isExpanded}>
                        <Box px={2} pb={2} pt={1} bgcolor="#fafafa" borderTop="1px solid #eee">
                          <Box display="flex" flexDirection="column" gap={1.5}>
                            <Box>
                              <Typography fontSize={11} color="text.secondary" mb={0.5}>
                                Model ID
                              </Typography>
                              <TextField
                                size="small"
                                fullWidth
                                value={override.model ?? preset.model}
                                onChange={(e) => updatePresetOverride(preset.model, "model", e.target.value)}
                              />
                            </Box>
                            <Box>
                              <Typography fontSize={11} color="text.secondary" mb={0.5}>
                                Display Name
                              </Typography>
                              <TextField
                                size="small"
                                fullWidth
                                value={override.name ?? preset.name}
                                onChange={(e) => updatePresetOverride(preset.model, "name", e.target.value)}
                              />
                            </Box>
                            <Box>
                              <Typography fontSize={11} color="text.secondary" mb={0.5}>
                                Model Domain
                              </Typography>
                              <FormControl size="small" fullWidth>
                                <Select
                                  value={override.domain ?? preset.domain}
                                  onChange={(e) => {
                                    const newDomain = e.target.value as ModelDomain;
                                    const needsConfig = needsLimitsAndCapabilities(newDomain);
                                    updatePresetOverride(preset.model, "domain", newDomain);
                                    // Reset task_types to default for new domain
                                    updatePresetOverride(preset.model, "task_types", DOMAIN_TASK_MAPPING[newDomain]?.slice(0, 1) || ["chat"]);
                                    // Clear limits and capabilities for non-chat domains
                                    if (!needsConfig) {
                                      updatePresetOverride(preset.model, "limits", { context_window: 0, max_tokens: 0 });
                                      updatePresetOverride(preset.model, "capabilities", {});
                                    }
                                  }}
                                >
                                  {DOMAINS.map((d) => (
                                    <MenuItem key={d.value} value={d.value} sx={{ fontSize: 13 }}>
                                      {d.label}
                                    </MenuItem>
                                  ))}
                                </Select>
                              </FormControl>
                            </Box>
                            <Box>
                              <Typography fontSize={11} color="text.secondary" mb={0.5}>
                                Task Types
                              </Typography>
                              <FormControl size="small" fullWidth>
                                <Select
                                  multiple
                                  value={override.task_types ?? preset.task_types ?? []}
                                  renderValue={(selected) => (selected as string[]).map(t => getTaskTypeLabel(t)).join(", ")}
                                  onChange={(e) => updatePresetOverride(preset.model, "task_types", e.target.value as string[])}
                                >
                                  {TASK_TYPES.map((t) => (
                                    <MenuItem key={t.value} value={t.value} sx={{ fontSize: 13 }}>
                                      {t.label}
                                    </MenuItem>
                                  ))}
                                </Select>
                              </FormControl>
                            </Box>
                            {needsLimitsAndCapabilities(override.domain ?? preset.domain) && (
                              <>
                                <Box>
                                  <Box display="flex" gap={1}>
                                    <Box flex={1}>
                                      <Typography fontSize={11} color="text.secondary" mb={0.5}>
                                        Context Window
                                      </Typography>
                                      <TextField
                                        size="small"
                                        fullWidth
                                        type="number"
                                        value={(override.limits ?? preset.limits)?.context_window || 0}
                                        onChange={(e) => {
                                          const currentLimits = override.limits ?? preset.limits ?? {};
                                          updatePresetOverride(preset.model, "limits", {
                                            ...currentLimits,
                                            context_window: parseInt(e.target.value) || 0,
                                          });
                                        }}
                                        inputProps={{ min: 0 }}
                                      />
                                    </Box>
                                    <Box flex={1}>
                                      <Typography fontSize={11} color="text.secondary" mb={0.5}>
                                        Max Tokens
                                      </Typography>
                                      <TextField
                                        size="small"
                                        fullWidth
                                        type="number"
                                        value={(override.limits ?? preset.limits)?.max_tokens || 0}
                                        onChange={(e) => {
                                          const currentLimits = override.limits ?? preset.limits ?? {};
                                          updatePresetOverride(preset.model, "limits", {
                                            ...currentLimits,
                                            max_tokens: parseInt(e.target.value) || 0,
                                          });
                                        }}
                                        inputProps={{ min: 0 }}
                                      />
                                    </Box>
                                  </Box>
                                </Box>
                                <Box>
                                  <Typography fontSize={11} color="text.secondary" mb={0.5}>
                                    Capabilities
                                  </Typography>
                                  <Box display="flex" flexWrap="wrap" gap={0.5}>
                                    {MODEL_CAPABILITY_OPTIONS.map((cap) => {
                                      const caps = override.capabilities ?? preset.capabilities;
                                      const isActive = caps[cap.key];
                                      return (
                                        <Chip
                                          key={cap.key}
                                          label={cap.label}
                                          size="small"
                                          variant={isActive ? "filled" : "outlined"}
                                          color={isActive ? "primary" : "default"}
                                          onClick={() => {
                                            const newCaps = { ...caps, [cap.key]: !isActive };
                                            updatePresetOverride(preset.model, "capabilities", newCaps);
                                          }}
                                          sx={{ fontSize: 11, cursor: "pointer" }}
                                        />
                                      );
                                    })}
                                  </Box>
                                </Box>
                              </>
                            )}
                            <Box display="flex" justifyContent="flex-end" gap={1} mt={1}>
                              <Button
                                size="small"
                                variant="outlined"
                                disabled={testing}
                                onClick={() => handleTestConnection(
                                  override.model ?? preset.model,
                                  override.name ?? preset.name,
                                  override.task_types ?? preset.task_types
                                )}
                              >
                                {testing ? "Testing..." : "Test Connection"}
                              </Button>
                            </Box>
                            {testResult && expandedPreset === preset.model && (
                              <Typography
                                fontSize={11}
                                color={testResult.success ? "success.main" : "error.main"}
                                mt={1}
                              >
                                {testResult.message}
                              </Typography>
                            )}
                          </Box>
                        </Box>
                      </Collapse>
                    </Card>
                  );
                })}
              </Box>
            </Box>
          )}

          {/* Custom Model Form */}
          <Box>
            <Button
              fullWidth
              variant="outlined"
              size="small"
              onClick={() => setShowCustomForm(!showCustomForm)}
              endIcon={showCustomForm ? <ExpandLessIcon /> : <ExpandMoreIcon />}
              sx={{ justifyContent: "space-between", textTransform: "none", mb: 1, borderColor: "#e0e0e0", color: "text.secondary", fontSize: 13, "&:hover": { borderColor: "#bdbdbd", bgcolor: "transparent" } }}
            >
              {provider && provider.presets && provider.presets.length > 0 ? "Or add custom model" : "Add Model"}
            </Button>
            <Collapse in={showCustomForm || !provider || !provider.presets || provider.presets.length === 0}>
              <Card variant="outlined" sx={{ p: 2 }}>
                <Box display="flex" flexDirection="column" gap={2}>
                  <Box display="flex" gap={2}>
                    <Box flex={1}>
                      <Typography fontSize={11} color="text.secondary" mb={0.5}>
                        Model ID <span style={{ color: "#f44336" }}>*</span>
                      </Typography>
                      <TextField
                        size="small"
                        fullWidth
                        placeholder="e.g. gpt-4o"
                        value={customModel.model}
                        onChange={(e) => setCustomModel((m) => ({ ...m, model: e.target.value }))}
                      />
                    </Box>
                    <Box flex={1}>
                      <Typography fontSize={11} color="text.secondary" mb={0.5}>
                        Display Name <span style={{ color: "#f44336" }}>*</span>
                      </Typography>
                      <TextField
                        size="small"
                        fullWidth
                        placeholder="e.g. GPT-4o"
                        value={customModel.name}
                        onChange={(e) => setCustomModel((m) => ({ ...m, name: e.target.value }))}
                      />
                    </Box>
                  </Box>
                  <Box>
                    <Typography fontSize={11} color="text.secondary" mb={0.5}>
                      Domain
                    </Typography>
                    <FormControl size="small" fullWidth>
                      <Select
                        value={customModel.domain}
                        onChange={(e) => {
                          const newDomain = e.target.value as ModelDomain;
                          const needsConfig = needsLimitsAndCapabilities(newDomain);
                          setCustomModel((m) => ({
                            ...m,
                            domain: newDomain,
                            task_types: DOMAIN_TASK_MAPPING[newDomain]?.slice(0, 1) || ["chat"],
                            // Clear limits and capabilities for non-chat domains
                            limits: needsConfig ? m.limits : { context_window: 0, max_tokens: 0 },
                            capabilities: needsConfig ? m.capabilities : {},
                          }));
                        }}
                      >
                        {DOMAINS.map((d) => (
                          <MenuItem key={d.value} value={d.value} sx={{ fontSize: 13 }}>
                            {d.label}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Box>
                  <Box>
                    <Typography fontSize={11} color="text.secondary" mb={0.5}>
                      Task Types
                    </Typography>
                    <FormControl size="small" fullWidth>
                      <Select
                        multiple
                        value={customModel.task_types}
                        renderValue={(selected) => (selected as string[]).map(t => getTaskTypeLabel(t)).join(", ")}
                        onChange={(e) => setCustomModel((m) => ({ ...m, task_types: e.target.value as string[] }))}
                      >
                        {TASK_TYPES.map((t) => (
                          <MenuItem key={t.value} value={t.value} sx={{ fontSize: 13 }}>
                            {t.label}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Box>
                  {needsLimitsAndCapabilities(customModel.domain) && (
                    <>
                      <Box>
                        <Box display="flex" gap={1}>
                          <Box flex={1}>
                            <Typography fontSize={11} color="text.secondary" mb={0.5}>
                              Context Window
                            </Typography>
                            <TextField
                              size="small"
                              fullWidth
                              type="number"
                              value={customModel.limits.context_window || 0}
                              onChange={(e) =>
                                setCustomModel((m) => ({
                                  ...m,
                                  limits: { ...m.limits, context_window: parseInt(e.target.value) || 0 },
                                }))
                              }
                              inputProps={{ min: 0 }}
                            />
                          </Box>
                          <Box flex={1}>
                            <Typography fontSize={11} color="text.secondary" mb={0.5}>
                              Max Tokens
                            </Typography>
                            <TextField
                              size="small"
                              fullWidth
                              type="number"
                              value={customModel.limits.max_tokens || 0}
                              onChange={(e) =>
                                setCustomModel((m) => ({
                                  ...m,
                                  limits: { ...m.limits, max_tokens: parseInt(e.target.value) || 0 },
                                }))
                              }
                              inputProps={{ min: 0 }}
                            />
                          </Box>
                        </Box>
                      </Box>
                      <Box>
                        <Typography fontSize={11} color="text.secondary" mb={0.5}>
                          Capabilities
                        </Typography>
                        <Box display="flex" flexWrap="wrap" gap={0.5}>
                          {MODEL_CAPABILITY_OPTIONS.map((cap) => {
                            const isActive = customModel.capabilities[cap.key];
                            return (
                              <Chip
                                key={cap.key}
                                label={cap.label}
                                size="small"
                                variant={isActive ? "filled" : "outlined"}
                                color={isActive ? "primary" : "default"}
                                onClick={() =>
                                  setCustomModel((m) => ({
                                    ...m,
                                    capabilities: { ...m.capabilities, [cap.key]: !isActive },
                                  }))
                                }
                                sx={{ fontSize: 11, cursor: "pointer" }}
                              />
                            );
                          })}
                        </Box>
                      </Box>
                    </>
                  )}
                  <Box display="flex" justifyContent="flex-end" gap={1}>
                    <Button
                      variant="outlined"
                      size="small"
                      disabled={!customModel.model || testing}
                      onClick={() => handleTestConnection(
                        customModel.model,
                        customModel.name || customModel.model,
                        customModel.task_types
                      )}
                    >
                      {testing ? "Testing..." : "Test Connection"}
                    </Button>
                    <Button
                      variant="contained"
                      disabled={saving}
                      onClick={handleAddCustomModel}
                    >
                      Add Model
                    </Button>
                  </Box>
                  {testResult && showCustomForm && (
                    <Typography
                      fontSize={11}
                      color={testResult.success ? "success.main" : "error.main"}
                      mt={1}
                      textAlign="right"
                    >
                      {testResult.message}
                    </Typography>
                  )}
                </Box>
              </Card>
            </Collapse>
          </Box>

          {error && (
            <Typography color="error" fontSize={12} mt={2}>
              {error}
            </Typography>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};

export default Models;


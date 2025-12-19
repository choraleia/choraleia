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
  InputLabel,
  Chip,
} from "@mui/material";
import { getApiUrl } from "../../api/base";

// Model provider enumeration
const MODEL_PROVIDERS = [
  { label: "Ark", value: "ark" },
  { label: "DeepSeek", value: "deepseek" },
];

// Menu tab definition
const SETTINGS_TABS = [{ label: "Model Management", value: "model" }];

const Models: React.FC = () => {
  const [activeTab, setActiveTab] = useState("model");
  return (
    <Box display="flex" height="100%" width="100%">
      <Box minWidth={140} borderRight="1px solid #e5e7eb" bgcolor="#f9fafb">
        <Box component="ul" m={0} p={0} sx={{ listStyle: "none", py: 1 }}>
          {SETTINGS_TABS.map((tab) => (
            <Box
              key={tab.value}
              component="li"
              onClick={() => setActiveTab(tab.value)}
              sx={{
                px: 2,
                py: 1,
                cursor: "pointer",
                fontSize: 14,
                borderRadius: 1,
                mb: 0.5,
                userSelect: "none",
                bgcolor: activeTab === tab.value ? "#eef6ff" : "transparent",
                color: activeTab === tab.value ? "#1677ff" : "inherit",
                "&:hover": {
                  bgcolor: activeTab === tab.value ? "#eef6ff" : "#f1f5f9",
                },
              }}
            >
              {tab.label}
            </Box>
          ))}
        </Box>
      </Box>
      <Box flex={1} p={2} overflow="auto">
        {activeTab === "model" && <ModelManager />}
      </Box>
    </Box>
  );
};

// Ark model fields & defaults
const ARK_FIELDS = [
  { label: "Endpoint", key: "endpoint", required: true },
  { label: "Region", key: "region", required: false },
  { label: "Name", key: "name", required: true },
  { label: "Model", key: "model", required: false },
  { label: "Base URL", key: "base_url", required: true },
  { label: "API Key", key: "api_key", required: true },
];
const ARK_DEFAULT_ENDPOINT_URL = "ark.cn-beijing.volcengineapi.com";
const ARK_DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";

// DeepSeek model fields & defaults
const DEEPSEEK_FIELDS = [
  { label: "Name", key: "name", required: true },
  { label: "Model ID", key: "model", required: false },
  { label: "Base URL", key: "base_url", required: true },
  { label: "API Key", key: "api_key", required: true },
];
const DEEPSEEK_DEFAULT_BASE_URL = "https://api.deepseek.com/v1";

// Provider field mapping config
const PROVIDER_CONFIG = {
  ark: { fields: ARK_FIELDS },
  deepseek: { fields: DEEPSEEK_FIELDS },
};

const ModelManager: React.FC = () => {
  const [models, setModels] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [adding, setAdding] = useState(false);
  const [testing, setTesting] = useState(false);
  const [providerTab, setProviderTab] = useState<"ark" | "deepseek">("ark");

  // Ark authentication config state
  const [arkCredential, setArkCredential] = useState<{
    configured: boolean;
    ak?: string;
    sk?: string;
  } | null>(null);
  const [arkCredForm, setArkCredForm] = useState({ ak: "", sk: "" });
  const [arkModelForm, setArkModelForm] = useState({
    name: "",
    provider: "ark",
    model: "",
    base_url: ARK_DEFAULT_BASE_URL,
    api_key: "",
    endpoint: ARK_DEFAULT_ENDPOINT_URL,
    extra: { region: "" },
  });
  const [deepseekForm, setDeepseekForm] = useState({
    name: "",
    provider: "deepseek",
    model: "",
    base_url: DEEPSEEK_DEFAULT_BASE_URL,
    api_key: "",
    extra: {},
  });
  const [showEditArkCred, setShowEditArkCred] = useState(false);
  const [arkModelList, setArkModelList] = useState<any[]>([]);
  const [arkModelPage, setArkModelPage] = useState(1);
  const [arkModelPageSize, setArkModelPageSize] = useState(10);
  const [arkModelTotal, setArkModelTotal] = useState(0);

  const fetchModels = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(getApiUrl("/api/models"));
      const data = await res.json();
      if (data.code === 200) {
        setModels(data.data || []);
      } else setError(data.message || "Fetch failed");
    } catch {
      setError("Network error");
    }
    setLoading(false);
  };
  useEffect(() => {
    fetchModels();
  }, []);

  const handleDelete = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this model?")) return;
    try {
      const res = await fetch(getApiUrl(`/api/models/${id}`), {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.code === 200) fetchModels();
      else alert(data.message || "Delete failed");
    } catch {
      alert("Network error");
    }
  };

  const handleProviderTabChange = (p: "ark" | "deepseek") => {
    setProviderTab(p);
    setError("");
    setArkCredForm({ ak: "", sk: "" });
    if (p === "ark") {
      setArkModelForm({
        name: "",
        provider: "ark",
        model: "",
        base_url: ARK_DEFAULT_BASE_URL,
        endpoint: ARK_DEFAULT_ENDPOINT_URL,
        api_key: "",
        extra: { region: "" },
      });
    } else {
      setDeepseekForm({
        name: "",
        provider: "deepseek",
        model: "",
        base_url: DEEPSEEK_DEFAULT_BASE_URL,
        api_key: "",
        extra: {},
      });
    }
  };

  useEffect(() => {
    if (showAdd) {
      if (providerTab === "ark") {
        setArkModelForm({
          name: "",
          provider: "ark",
          model: "",
          base_url: ARK_DEFAULT_BASE_URL,
          endpoint: ARK_DEFAULT_ENDPOINT_URL,
          api_key: "",
          extra: { region: "" },
        });
      } else {
        setDeepseekForm({
          name: "",
          provider: "deepseek",
          model: "",
          base_url: DEEPSEEK_DEFAULT_BASE_URL,
          api_key: "",
          extra: {},
        });
      }
    }
  }, [showAdd, providerTab]);

  useEffect(() => {
    if (showAdd && providerTab === "ark") {
      fetch(getApiUrl("/api/models/provider/ark/credentials"))
        .then((r) => r.json())
        .then((data) => {
          setArkCredential(data);
          if (data.configured && data.ak) {
            setArkCredForm((f) => ({ ...f, ak: data.ak }));
          }
        });
    }
  }, [showAdd, providerTab]);

  const handleSaveArkCredentials = async () => {
    if (!arkCredForm.ak || !arkCredForm.sk) {
      setError("AK and SK are required");
      return;
    }
    setAdding(true);
    setError("");
    try {
      const res = await fetch(
        getApiUrl("/api/models/provider/ark/credentials"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(arkCredForm),
        },
      );
      const data = await res.json();
      if (data.code === 200) {
        setArkCredential({
          configured: true,
          ak: arkCredForm.ak,
          sk: arkCredForm.sk,
        });
      } else setError(data.message || "Save failed");
    } catch {
      setError("Network error");
    }
    setAdding(false);
  };

  const handleAddArkModel = async () => {
    for (const f of ARK_FIELDS) {
      if (f.required && !arkModelForm[f.key]) {
        setError(`${f.label} is required`);
        return;
      }
    }
    setAdding(true);
    setError("");
    try {
      const res = await fetch(getApiUrl("/api/models"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(arkModelForm),
      });
      const data = await res.json();
      if (data.code === 200) {
        setShowAdd(false);
        fetchModels();
      } else setError(data.message || "Add failed");
    } catch {
      setError("Network error");
    }
    setAdding(false);
  };

  const handleAddDeepseekModel = async () => {
    for (const f of DEEPSEEK_FIELDS) {
      if (f.required && !deepseekForm[f.key]) {
        setError(`${f.label} is required`);
        return;
      }
    }
    setAdding(true);
    setError("");
    try {
      let payload = { ...deepseekForm };
      if (!payload.base_url) payload.base_url = DEEPSEEK_DEFAULT_BASE_URL;
      const res = await fetch(getApiUrl("/api/models"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.code === 200) {
        setShowAdd(false);
        fetchModels();
      } else setError(data.message || "Add failed");
    } catch {
      setError("Network error");
    }
    setAdding(false);
  };

  const fetchArkModelData = async (page: number, pageSize: number) => {
    if (!arkCredential?.configured) return;
    setLoading(true);
    setError("");
    try {
      const endpoint = arkModelForm.endpoint;
      const res = await fetch(
        getApiUrl(
          `/api/models/provider/ark/models?endpoint=${endpoint}&pageNumber=${page}&pageSize=${pageSize}`,
        ),
      );
      const data = await res.json();
      if (data.code === 200) {
        setArkModelList(data.models);
        setArkModelPage(data.pageNumber || page);
        setArkModelTotal(data.total || 0);
        setArkModelForm((f) => ({
          ...f,
          extra: { region: data.metadata?.region || "" },
        }));
      } else {
        setArkModelList([]);
        setArkModelPage(1);
        setArkModelTotal(0);
        setError(data.message || "Failed to fetch models");
      }
    } catch {
      setArkModelList([]);
      setArkModelPage(1);
      setArkModelTotal(0);
      setError("Network error");
    }
    setLoading(false);
  };
  useEffect(() => {
    if (showAdd && providerTab === "ark") {
      fetchArkModelData(1, arkModelPageSize);
    }
  }, [arkModelForm.endpoint]);
  useEffect(() => {
    if (showAdd && providerTab === "ark" && arkCredential?.configured) {
      fetchArkModelData(arkModelPage, arkModelPageSize);
    }
  }, [
    showAdd,
    providerTab,
    arkCredential,
    arkModelForm.endpoint,
    arkModelPage,
    arkModelPageSize,
  ]);

  const handleTestModelConnection = async () => {
    setTesting(true);
    const payload =
      providerTab === "ark"
        ? { ...arkModelForm, provider: "ark" }
        : { ...deepseekForm, provider: "deepseek" };
    if (!payload.base_url)
      payload.base_url =
        providerTab === "ark"
          ? ARK_DEFAULT_BASE_URL
          : DEEPSEEK_DEFAULT_BASE_URL;
    try {
      const res = await fetch(getApiUrl("/api/models/test"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.code === 200 && data.success) {
        console.log("Test successful");
      } else {
        console.error("Test failed", data.message);
      }
    } catch {
      console.error("Network error");
    }
    setTesting(false);
  };

  function maskAk(ak: string) {
    if (!ak || ak.length <= 8) return ak;
    return ak.slice(0, 4) + "******" + ak.slice(-4);
  }

  return (
    <Box>
      {loading ? (
        <Typography>Loading...</Typography>
      ) : error ? (
        <Typography color="error">{error}</Typography>
      ) : (
        <Box
          component="table"
          sx={{
            width: "100%",
            border: "1px solid #e5e7eb",
            borderCollapse: "collapse",
            fontSize: 13,
          }}
        >
          <thead>
            <tr style={{ background: "#f1f5f9" }}>
              <th
                style={{
                  border: "1px solid #e5e7eb",
                  padding: "4px 6px",
                  textAlign: "left",
                }}
              >
                Name
              </th>
              <th
                style={{
                  border: "1px solid #e5e7eb",
                  padding: "4px 6px",
                  textAlign: "left",
                }}
              >
                Type
              </th>
              <th
                style={{
                  border: "1px solid #e5e7eb",
                  padding: "4px 6px",
                  textAlign: "left",
                }}
              >
                Model ID
              </th>
              <th
                style={{
                  border: "1px solid #e5e7eb",
                  padding: "4px 6px",
                  textAlign: "left",
                }}
              >
                Base URL
              </th>
              <th
                style={{
                  border: "1px solid #e5e7eb",
                  padding: "4px 6px",
                  textAlign: "left",
                }}
              >
                API Key
              </th>
              <th
                style={{
                  border: "1px solid #e5e7eb",
                  padding: "4px 6px",
                  textAlign: "left",
                }}
              >
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {models.map((m) => (
              <tr key={m.id}>
                <td style={{ border: "1px solid #e5e7eb", padding: "4px 6px" }}>
                  {m.name}
                </td>
                <td style={{ border: "1px solid #e5e7eb", padding: "4px 6px" }}>
                  {m.provider}
                </td>
                <td style={{ border: "1px solid #e5e7eb", padding: "4px 6px" }}>
                  {m.model}
                </td>
                <td style={{ border: "1px solid #e5e7eb", padding: "4px 6px" }}>
                  {m.base_url}
                </td>
                <td style={{ border: "1px solid #e5e7eb", padding: "4px 6px" }}>
                  {m.api_key}
                </td>
                <td style={{ border: "1px solid #e5e7eb", padding: "4px 6px" }}>
                  <Button color="error" onClick={() => handleDelete(m.id)}>
                    Delete
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Box>
      )}
      <Box
        mt={2}
        display="flex"
        justifyContent="space-between"
        alignItems="center"
      >
        <Button variant="contained" onClick={() => setShowAdd(true)}>
          Add Model
        </Button>
      </Box>

      <Dialog
        open={showAdd}
        onClose={() => setShowAdd(false)}
        fullWidth
        maxWidth={false}
        PaperProps={{ sx: { width: "90vw", height: "90vh" } }}
      >
        <DialogTitle>Add Model</DialogTitle>
        <DialogContent sx={{ p: 0 }}>
          <Box display="flex" height="calc(90vh - 100px)">
            <Box
              width={120}
              borderRight="1px solid #eee"
              p={1}
              display="flex"
              flexDirection="column"
              gap={1}
              bgcolor="#f9fafb"
            >
              {MODEL_PROVIDERS.map((p) => (
                <Button
                  key={p.value}
                  onClick={() => handleProviderTabChange(p.value as any)}
                  variant={providerTab === p.value ? "contained" : "outlined"}
                >
                  {p.label}
                </Button>
              ))}
            </Box>
            <Box
              flex={1}
              display="flex"
              flexDirection="column"
              p={2}
              overflow="hidden"
            >
              {providerTab === "ark" ? (
                <Box
                  display="flex"
                  flexDirection="column"
                  flex={1}
                  overflow="auto"
                >
                  <Box display="flex" flexDirection="column" gap={1}>
                    <TextField
                      label="Endpoint"
                      required
                      value={arkModelForm.endpoint}
                      onChange={(e) =>
                        setArkModelForm((f) => ({
                          ...f,
                          endpoint: e.target.value,
                        }))
                      }
                    />
                    <TextField
                      label="Base URL"
                      required
                      value={arkModelForm.base_url}
                      onChange={(e) =>
                        setArkModelForm((f) => ({
                          ...f,
                          base_url: e.target.value,
                        }))
                      }
                    />
                    <TextField
                      label="Name"
                      required
                      value={arkModelForm.name}
                      onChange={(e) =>
                        setArkModelForm((f) => ({ ...f, name: e.target.value }))
                      }
                    />
                    <TextField
                      label="Model"
                      required
                      value={arkModelForm.model}
                      onChange={(e) =>
                        setArkModelForm((f) => ({
                          ...f,
                          model: e.target.value,
                        }))
                      }
                    />
                    <TextField
                      label="API Key"
                      required
                      value={arkModelForm.api_key}
                      onChange={(e) =>
                        setArkModelForm((f) => ({
                          ...f,
                          api_key: e.target.value,
                        }))
                      }
                    />
                    <TextField
                      label="Region"
                      value={arkModelForm.extra.region}
                      onChange={(e) =>
                        setArkModelForm((f) => ({
                          ...f,
                          extra: { region: e.target.value },
                        }))
                      }
                    />
                    {ARK_FIELDS.map((f) =>
                      [
                        "model",
                        "region",
                        "endpoint",
                        "base_url",
                        "name",
                        "api_key",
                      ].includes(f.key) ? null : (
                        <TextField
                          key={f.key}
                          label={f.label}
                          required={f.required}
                          value={(arkModelForm as any)[f.key] || ""}
                          onChange={(e) =>
                            setArkModelForm((form) => ({
                              ...form,
                              [f.key]: e.target.value,
                            }))
                          }
                        />
                      ),
                    )}
                    {error && (
                      <Typography color="error" fontSize={12}>
                        {error}
                      </Typography>
                    )}
                  </Box>
                  <Box mt={2}>
                    <Typography fontSize={13} fontWeight={600}>
                      Select Model
                    </Typography>
                    {arkCredential && arkCredential.configured && (
                      <Box mt={1} fontSize={12}>
                        Current AK: {maskAk(arkCredential.ak || "")}
                        <Button
                          sx={{ ml: 1 }}
                          variant="outlined"
                          onClick={() => setShowEditArkCred(true)}
                        >
                          Edit
                        </Button>
                        <Button
                          sx={{ ml: 1 }}
                          color="error"
                          variant="outlined"
                          disabled={adding}
                          onClick={async () => {
                            setAdding(true);
                            setError("");
                            try {
                              const res = await fetch(
                                getApiUrl(
                                  "/api/models/provider/ark/credentials",
                                ),
                                { method: "DELETE" },
                              );
                              const data = await res.json();
                              if (data.code === 200) {
                                setArkCredential({ configured: false });
                                setArkCredForm({ ak: "", sk: "" });
                              } else setError(data.message || "Delete failed");
                            } catch {
                              setError("Network error");
                            }
                            setAdding(false);
                          }}
                        >
                          Delete
                        </Button>
                      </Box>
                    )}
                    {(!arkCredential ||
                      !arkCredential.configured ||
                      showEditArkCred) && (
                      <Box
                        mt={1}
                        p={2}
                        border="1px solid #eee"
                        borderRadius={1}
                        bgcolor="#fafafa"
                      >
                        <TextField
                          label="Access Key (AK)"
                          fullWidth
                          sx={{ mb: 1 }}
                          value={arkCredForm.ak}
                          onChange={(e) =>
                            setArkCredForm((f) => ({
                              ...f,
                              ak: e.target.value,
                            }))
                          }
                        />
                        <TextField
                          label="Secret Key (SK)"
                          fullWidth
                          sx={{ mb: 1 }}
                          value={arkCredForm.sk}
                          onChange={(e) =>
                            setArkCredForm((f) => ({
                              ...f,
                              sk: e.target.value,
                            }))
                          }
                        />
                        <Box textAlign="right">
                          {arkCredential && showEditArkCred && (
                            <Button
                              sx={{ mr: 1 }}
                              onClick={() => {
                                setShowEditArkCred(false);
                                setArkCredForm({
                                  ak: arkCredential.ak || "",
                                  sk: arkCredential.sk || "",
                                });
                              }}
                            >
                              Cancel
                            </Button>
                          )}
                          <Button
                            variant="contained"
                            onClick={handleSaveArkCredentials}
                            disabled={adding}
                          >
                            Save
                          </Button>
                        </Box>
                      </Box>
                    )}
                    {arkCredential &&
                      arkCredential.configured &&
                      !showEditArkCred && (
                        <Box mt={2}>
                          {arkModelList.length === 0 ? (
                            <Typography fontSize={12} color="text.secondary">
                              No model data available
                            </Typography>
                          ) : (
                            <Box
                              component="ul"
                              m={0}
                              p={0}
                              sx={{ listStyle: "none" }}
                            >
                              {arkModelList.map((model: any, idx: number) => {
                                const unique =
                                  model.Name ||
                                  model.DisplayName ||
                                  String(idx);
                                const modelFull =
                                  model.Name && model.PrimaryVersion
                                    ? `${model.Name}-${model.PrimaryVersion}`
                                    : model.Name || "";
                                const selected =
                                  arkModelForm.model === modelFull;
                                return (
                                  <Box
                                    key={unique}
                                    component="li"
                                    onClick={() =>
                                      setArkModelForm((f) => ({
                                        ...f,
                                        name: modelFull,
                                        model: modelFull,
                                      }))
                                    }
                                    sx={{
                                      p: 1,
                                      mb: 0.75,
                                      border: "1px solid #e5e7eb",
                                      borderRadius: 0.75,
                                      cursor: "pointer",
                                      bgcolor: selected ? "#e6f7ff" : "#fff",
                                      boxShadow: selected
                                        ? "0 0 0 2px #1890ff"
                                        : "none",
                                    }}
                                  >
                                    <Box display="flex" flexDirection="column">
                                      <Box fontSize={13} fontWeight={500}>
                                        {model.DisplayName ||
                                          model.Name ||
                                          modelFull}
                                      </Box>
                                      <Box fontSize={11} color="text.secondary">
                                        ID: {modelFull}
                                      </Box>
                                      {model.Description && (
                                        <Box
                                          mt={0.5}
                                          fontSize={11}
                                          color="text.secondary"
                                        >
                                          {model.Description}
                                        </Box>
                                      )}
                                    </Box>
                                  </Box>
                                );
                              })}
                            </Box>
                          )}
                        </Box>
                      )}
                  </Box>
                </Box>
              ) : (
                <Box
                  display="flex"
                  flexDirection="column"
                  flex={1}
                  overflow="auto"
                >
                  <Box display="flex" flexDirection="column" gap={1}>
                    <TextField
                      label="Name"
                      required
                      value={deepseekForm.name}
                      onChange={(e) =>
                        setDeepseekForm((f) => ({
                          ...f,
                          name: e.target.value,
                        }))
                      }
                    />
                    <TextField
                      label="Model ID"
                      value={deepseekForm.model}
                      onChange={(e) =>
                        setDeepseekForm((f) => ({
                          ...f,
                          model: e.target.value,
                        }))
                      }
                    />
                    <TextField
                      label="Base URL"
                      required
                      value={deepseekForm.base_url}
                      onChange={(e) =>
                        setDeepseekForm((f) => ({
                          ...f,
                          base_url: e.target.value,
                        }))
                      }
                    />
                    <TextField
                      label="API Key"
                      required
                      value={deepseekForm.api_key}
                      onChange={(e) =>
                        setDeepseekForm((f) => ({
                          ...f,
                          api_key: e.target.value,
                        }))
                      }
                    />
                  </Box>
                </Box>
              )}
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowAdd(false)}>Cancel</Button>
          <Button
            variant="outlined"
            onClick={handleTestModelConnection}
            disabled={testing}
          >
            Test Connection
          </Button>
          <Button
            variant="contained"
            onClick={
              providerTab === "ark" ? handleAddArkModel : handleAddDeepseekModel
            }
            disabled={adding}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Models;

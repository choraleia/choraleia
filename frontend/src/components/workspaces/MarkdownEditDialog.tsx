import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  IconButton,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import EditIcon from "@mui/icons-material/Edit";
import VisibilityIcon from "@mui/icons-material/Visibility";
import Editor from "../editor/Editor";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownEditDialogProps {
  open: boolean;
  title: string;
  value: string;
  onClose: () => void;
  onSave: (value: string) => void;
  placeholder?: string;
}

const MarkdownEditDialog: React.FC<MarkdownEditDialogProps> = ({
  open,
  title,
  value,
  onClose,
  onSave,
  placeholder,
}) => {
  const [editValue, setEditValue] = useState(value);
  const [viewMode, setViewMode] = useState<"edit" | "preview" | "split">("edit");

  // Reset edit value when dialog opens
  useEffect(() => {
    if (open) {
      setEditValue(value);
    }
  }, [open, value]);

  const handleSave = () => {
    onSave(editValue);
    onClose();
  };

  const handleViewModeChange = (
    _: React.MouseEvent<HTMLElement>,
    newMode: "edit" | "preview" | "split" | null
  ) => {
    if (newMode !== null) {
      setViewMode(newMode);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      PaperProps={{
        sx: {
          height: "80vh",
          maxHeight: "80vh",
        },
      }}
    >
      <DialogTitle
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          py: 1,
          px: 2,
        }}
      >
        <Typography variant="subtitle1" fontWeight={600}>
          {title}
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <ToggleButtonGroup
            value={viewMode}
            exclusive
            onChange={handleViewModeChange}
            size="small"
          >
            <ToggleButton value="edit" sx={{ px: 1.5, py: 0.5 }}>
              <EditIcon sx={{ fontSize: 16, mr: 0.5 }} />
              Edit
            </ToggleButton>
            <ToggleButton value="split" sx={{ px: 1.5, py: 0.5 }}>
              Split
            </ToggleButton>
            <ToggleButton value="preview" sx={{ px: 1.5, py: 0.5 }}>
              <VisibilityIcon sx={{ fontSize: 16, mr: 0.5 }} />
              Preview
            </ToggleButton>
          </ToggleButtonGroup>
          <IconButton size="small" onClick={onClose}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      </DialogTitle>
      <DialogContent
        sx={{
          p: 0,
          display: "flex",
          flexDirection: "row",
          overflow: "hidden",
        }}
      >
        {/* Editor Panel */}
        {(viewMode === "edit" || viewMode === "split") && (
          <Box
            sx={{
              flex: 1,
              minWidth: 0,
              height: "100%",
              borderRight: viewMode === "split" ? 1 : 0,
              borderColor: "divider",
            }}
          >
            <Editor
              filePath="instruction.md"
              value={editValue}
              onChange={(v) => setEditValue(v || "")}
              height="100%"
              options={{
                wordWrap: "on",
                minimap: { enabled: false },
                lineNumbers: "off",
                folding: false,
                scrollBeyondLastLine: false,
                placeholder: placeholder,
              }}
            />
          </Box>
        )}

        {/* Preview Panel */}
        {(viewMode === "preview" || viewMode === "split") && (
          <Box
            sx={{
              flex: 1,
              minWidth: 0,
              height: "100%",
              overflow: "auto",
              p: 2,
              bgcolor: "background.default",
              "& h1, & h2, & h3, & h4, & h5, & h6": {
                mt: 2,
                mb: 1,
                fontWeight: 600,
              },
              "& p": {
                my: 1,
                lineHeight: 1.6,
              },
              "& ul, & ol": {
                pl: 3,
                my: 1,
              },
              "& li": {
                my: 0.5,
              },
              "& code": {
                px: 0.75,
                py: 0.25,
                borderRadius: 1,
                bgcolor: "action.hover",
                fontFamily: "monospace",
                fontSize: "0.875em",
              },
              "& pre": {
                p: 2,
                borderRadius: 1,
                bgcolor: "action.hover",
                overflow: "auto",
                "& code": {
                  p: 0,
                  bgcolor: "transparent",
                },
              },
              "& blockquote": {
                borderLeft: 4,
                borderColor: "divider",
                pl: 2,
                my: 2,
                fontStyle: "italic",
                color: "text.secondary",
              },
              "& a": {
                color: "primary.main",
              },
              "& table": {
                borderCollapse: "collapse",
                width: "100%",
                my: 2,
              },
              "& th, & td": {
                border: 1,
                borderColor: "divider",
                p: 1,
              },
              "& th": {
                bgcolor: "action.hover",
                fontWeight: 600,
              },
            }}
          >
            {editValue ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {editValue}
              </ReactMarkdown>
            ) : (
              <Typography variant="body2" color="text.disabled">
                {placeholder || "No content"}
              </Typography>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 2, py: 1 }}>
        <Button onClick={onClose} size="small">
          Cancel
        </Button>
        <Button variant="contained" onClick={handleSave} size="small">
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default MarkdownEditDialog;


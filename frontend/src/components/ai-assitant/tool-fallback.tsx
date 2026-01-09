import { ToolCallMessagePartComponent } from "@assistant-ui/react";
import {
  ChevronDownIcon,
  ChevronRightIcon,
} from "./assistant-icons.tsx";
import { useEffect, useRef, useState, useMemo } from "react";
import Paper from "@mui/material/Paper";
import Box from "@mui/material/Box";
import Collapse from "@mui/material/Collapse";
import Typography from "@mui/material/Typography";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import CircularProgress from "@mui/material/CircularProgress";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import CheckIcon from "@mui/icons-material/Check";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import BuildIcon from "@mui/icons-material/Build";
import { useTheme, alpha } from "@mui/material/styles";

// Tool status type
type ToolStatus = "running" | "success" | "error";

export const ToolFallback: ToolCallMessagePartComponent = ({
  toolName,
  argsText,
  result,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [argsCopied, setArgsCopied] = useState(false);
  const [resultCopied, setResultCopied] = useState(false);
  const theme = useTheme();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Determine tool status
  const status: ToolStatus = useMemo(() => {
    if (result === undefined) return "running";
    if (typeof result === "string" && result.startsWith("Error:")) return "error";
    return "success";
  }, [result]);

  const toggleExpanded = () => setIsExpanded((p) => !p);

  // Copy to clipboard
  const copyToClipboard = async (text: string, type: "args" | "result") => {
    try {
      await navigator.clipboard.writeText(text);
      if (type === "args") {
        setArgsCopied(true);
        setTimeout(() => setArgsCopied(false), 2000);
      } else {
        setResultCopied(true);
        setTimeout(() => setResultCopied(false), 2000);
      }
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  // Format JSON for display
  const formatJson = (input: string | undefined): string => {
    if (!input) return "";
    try {
      const parsed = JSON.parse(input);
      return JSON.stringify(parsed, null, 2);
    } catch {
      // Not valid JSON, return as-is with normalized indentation
      const lines = input.replace(/\r\n?/g, "\n").split("\n");
      while (lines.length && lines[0].trim() === "") lines.shift();
      const indents = lines
        .filter((l) => l.trim() !== "")
        .map((l) => (l.match(/^(\s*)/) || [""])[0]);
      const minIndent = indents.length
        ? Math.min(...indents.map((i) => i.length))
        : 0;
      const joined =
        minIndent > 0
          ? lines.map((l) => l.slice(minIndent)).join("\n")
          : lines.join("\n");
      return joined.trimStart();
    }
  };

  const displayArgs = formatJson(argsText);
  const displayResult =
    typeof result === "string"
      ? formatJson(result)
      : result !== undefined
        ? formatJson(JSON.stringify(result, null, 2))
        : "";

  // Auto scroll to bottom on updates when expanded
  useEffect(() => {
    if (!isExpanded) return;
    const el = scrollRef.current;
    if (!el) return;
    const id = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(id);
  }, [displayArgs, displayResult, isExpanded]);

  // Status icon and color - unified with ReasoningContent style
  const getStatusConfig = () => {
    const bgColor = theme.palette.mode === "light"
      ? "#ececec"
      : theme.palette.primary.dark + "30";
    const headerBgColor = theme.palette.mode === "light"
      ? "rgba(0,0,0,0.04)"
      : "rgba(255,255,255,0.08)";

    switch (status) {
      case "running":
        return {
          icon: <CircularProgress size={14} thickness={4} sx={{ color: theme.palette.info.main }} />,
          iconColor: theme.palette.info.main,
          bgColor,
          headerBgColor,
          label: "Running",
        };
      case "success":
        return {
          icon: <CheckCircleOutlineIcon sx={{ fontSize: 16, color: theme.palette.success.main }} />,
          iconColor: theme.palette.success.main,
          bgColor,
          headerBgColor,
          label: "Completed",
        };
      case "error":
        return {
          icon: <ErrorOutlineIcon sx={{ fontSize: 16, color: theme.palette.error.main }} />,
          iconColor: theme.palette.error.main,
          bgColor,
          headerBgColor,
          label: "Error",
        };
    }
  };

  const statusConfig = getStatusConfig();

  return (
    <Paper
      elevation={0}
      sx={{
        mt: 1,
        backgroundColor: statusConfig.bgColor,
        borderColor: theme.palette.mode === "light" ? "#f0f0f0" : theme.palette.divider,
        border: "none",
        p: 0,
        overflow: "hidden",
        transition: "all 0.2s ease",
      }}
    >
      {/* Header */}
      <Box
        component="button"
        type="button"
        onClick={toggleExpanded}
        aria-expanded={isExpanded}
        sx={{
          cursor: "pointer",
          m: 0,
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 1.5,
          py: 1,
          textAlign: "left",
          backgroundColor: statusConfig.headerBgColor,
          border: "none",
          outline: "none",
          fontWeight: 500,
          color: theme.palette.mode === "light"
            ? theme.palette.primary.main
            : theme.palette.primary.light,
          "&:hover": {
            backgroundColor: theme.palette.mode === "light"
              ? "rgba(0,0,0,0.07)"
              : "rgba(255,255,255,0.12)",
          },
        }}
      >
        {/* Wrench icon on left */}
        <Box sx={{ display: "flex", alignItems: "center", color: "inherit" }}>
          <BuildIcon sx={{ fontSize: 16 }} />
        </Box>

        {/* Tool name */}
        <Typography
          component="span"
          variant="body2"
          sx={{
            fontWeight: 500,
            color: "inherit",
          }}
        >
          {toolName}
        </Typography>

        {/* Status icon on right */}
        <Box sx={{ ml: "auto", display: "flex", alignItems: "center", gap: 1 }}>
          <Tooltip title={statusConfig.label}>
            <Box sx={{ display: "flex", alignItems: "center" }}>
              {statusConfig.icon}
            </Box>
          </Tooltip>

          {/* Expand icon */}
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              color: "inherit",
            }}
          >
            {isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
          </Box>
        </Box>
      </Box>

      {/* Content */}
      <Collapse in={isExpanded} unmountOnExit timeout={150}>
        <Divider sx={{ mb: 0 }} />
        <Box
          sx={{
            px: 1.5,
            py: 1.5,
            backgroundColor: theme.palette.mode === "dark"
              ? theme.palette.primary.dark + "30"
              : undefined,
          }}
        >
          <Box ref={scrollRef} sx={{ maxHeight: 400, overflowY: "auto" }}>
            {/* Arguments section */}
            <Box sx={{ mb: displayResult ? 1.5 : 0 }}>
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 0.5 }}>
                <Typography
                  variant="caption"
                  sx={{
                    fontWeight: 600,
                    color: theme.palette.text.secondary,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                  }}
                >
                  Arguments
                </Typography>
                {displayArgs && (
                  <Tooltip title={argsCopied ? "Copied!" : "Copy arguments"}>
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        copyToClipboard(displayArgs, "args");
                      }}
                      sx={{ p: 0.25 }}
                    >
                      {argsCopied ? (
                        <CheckIcon sx={{ fontSize: 14, color: "success.main" }} />
                      ) : (
                        <ContentCopyIcon sx={{ fontSize: 14 }} />
                      )}
                    </IconButton>
                  </Tooltip>
                )}
              </Box>
              <Box
                component="pre"
                sx={{
                  m: 0,
                  p: 1,
                  bgcolor: alpha(theme.palette.background.default, 0.5),
                  borderRadius: 1,
                  border: `1px solid ${theme.palette.divider}`,
                  overflow: "auto",
                  maxHeight: 150,
                  fontSize: "0.75rem",
                  fontFamily: "monospace",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  color: theme.palette.text.primary,
                }}
              >
                {displayArgs || "(no arguments)"}
              </Box>
            </Box>

            {/* Result section */}
            {result !== undefined && (
              <Box>
                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 0.5 }}>
                  <Typography
                    variant="caption"
                    sx={{
                      fontWeight: 600,
                      color: status === "error" ? theme.palette.error.main : theme.palette.text.secondary,
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                    }}
                  >
                    {status === "error" ? "Error" : "Result"}
                  </Typography>
                  {displayResult && (
                    <Tooltip title={resultCopied ? "Copied!" : "Copy result"}>
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          copyToClipboard(displayResult, "result");
                        }}
                        sx={{ p: 0.25 }}
                      >
                        {resultCopied ? (
                          <CheckIcon sx={{ fontSize: 14, color: "success.main" }} />
                        ) : (
                          <ContentCopyIcon sx={{ fontSize: 14 }} />
                        )}
                      </IconButton>
                    </Tooltip>
                  )}
                </Box>
                <Box
                  component="pre"
                  sx={{
                    m: 0,
                    p: 1,
                    bgcolor: status === "error"
                      ? alpha(theme.palette.error.main, 0.05)
                      : alpha(theme.palette.background.default, 0.5),
                    borderRadius: 1,
                    border: `1px solid ${status === "error" ? alpha(theme.palette.error.main, 0.3) : theme.palette.divider}`,
                    overflow: "auto",
                    maxHeight: 200,
                    fontSize: "0.75rem",
                    fontFamily: "monospace",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    color: status === "error" ? theme.palette.error.main : theme.palette.text.primary,
                  }}
                >
                  {displayResult || "(empty result)"}
                </Box>
              </Box>
            )}
          </Box>
        </Box>
      </Collapse>
    </Paper>
  );
};

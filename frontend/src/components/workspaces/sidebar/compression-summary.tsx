// Compression Summary component - displays compressed message summary in chat
import React, { useState } from "react";
import {
  Box,
  Typography,
  Chip,
  IconButton,
  Collapse,
  Paper,
  Tooltip,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import CompressIcon from "@mui/icons-material/Compress";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";

export interface CompressionSummaryProps {
  summary: string;
  keyTopics?: string[];
  keyDecisions?: string[];
  messageCount: number;
  compressedAt?: string;
  onViewOriginal?: () => void;
}

export default function CompressionSummary({
  summary,
  keyTopics,
  keyDecisions,
  messageCount,
  compressedAt,
  onViewOriginal,
}: CompressionSummaryProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Paper
      elevation={0}
      sx={{
        p: 2,
        mb: 2,
        backgroundColor: "action.hover",
        borderRadius: 2,
        border: "1px dashed",
        borderColor: "divider",
      }}
    >
      {/* Header */}
      <Box display="flex" alignItems="center" gap={1} mb={1}>
        <CompressIcon fontSize="small" color="primary" />
        <Typography variant="subtitle2" color="primary">
          Compressed History
        </Typography>
        <Chip
          label={`${messageCount} messages`}
          size="small"
          variant="outlined"
          sx={{ ml: "auto", height: 20, fontSize: 11 }}
        />
        <Tooltip title={expanded ? "Collapse" : "Expand details"}>
          <IconButton
            size="small"
            onClick={() => setExpanded(!expanded)}
            sx={{ ml: 0.5 }}
          >
            {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      </Box>

      {/* Key Topics */}
      {keyTopics && keyTopics.length > 0 && (
        <Box display="flex" flexWrap="wrap" gap={0.5} mb={1}>
          {keyTopics.map((topic, idx) => (
            <Chip
              key={idx}
              label={topic}
              size="small"
              sx={{
                height: 20,
                fontSize: 11,
                backgroundColor: "primary.dark",
                color: "primary.contrastText",
              }}
            />
          ))}
        </Box>
      )}

      {/* Summary */}
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{
          fontSize: 13,
          lineHeight: 1.6,
          display: "-webkit-box",
          WebkitLineClamp: expanded ? "none" : 3,
          WebkitBoxOrient: "vertical",
          overflow: expanded ? "visible" : "hidden",
        }}
      >
        {summary}
      </Typography>

      {/* Expanded Details */}
      <Collapse in={expanded}>
        <Box sx={{ mt: 2 }}>
          {/* Key Decisions */}
          {keyDecisions && keyDecisions.length > 0 && (
            <Box mb={1.5}>
              <Typography variant="caption" color="text.secondary" fontWeight={500}>
                Key Decisions:
              </Typography>
              <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2 }}>
                {keyDecisions.map((decision, idx) => (
                  <li key={idx}>
                    <Typography variant="body2" color="text.secondary" fontSize={12}>
                      {decision}
                    </Typography>
                  </li>
                ))}
              </Box>
            </Box>
          )}

          {/* Metadata */}
          <Box display="flex" alignItems="center" gap={2} mt={1}>
            {compressedAt && (
              <Typography variant="caption" color="text.disabled">
                Compressed: {new Date(compressedAt).toLocaleDateString()}
              </Typography>
            )}
            {onViewOriginal && (
              <Typography
                variant="caption"
                color="primary"
                sx={{ cursor: "pointer", "&:hover": { textDecoration: "underline" } }}
                onClick={onViewOriginal}
              >
                View original messages
              </Typography>
            )}
          </Box>
        </Box>
      </Collapse>

      {/* Info hint when collapsed */}
      {!expanded && (keyDecisions?.length || 0) > 0 && (
        <Box display="flex" alignItems="center" gap={0.5} mt={1}>
          <InfoOutlinedIcon sx={{ fontSize: 14, color: "text.disabled" }} />
          <Typography variant="caption" color="text.disabled">
            {keyDecisions?.length} decisions recorded. Click expand for details.
          </Typography>
        </Box>
      )}
    </Paper>
  );
}


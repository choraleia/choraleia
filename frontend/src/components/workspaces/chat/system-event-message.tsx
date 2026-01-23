// System Event Message component - displays system notifications in chat
import React from "react";
import {
  Box,
  Typography,
  Paper,
  IconButton,
  Collapse,
} from "@mui/material";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import CompressIcon from "@mui/icons-material/Compress";
import PsychologyIcon from "@mui/icons-material/Psychology";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import CloseIcon from "@mui/icons-material/Close";

export interface SystemEventData {
  type: string;
  message?: string;
  data?: Record<string, unknown>;
}

export interface SystemEventMessageProps {
  event: SystemEventData;
  onDismiss?: () => void;
  onAction?: (action: string) => void;
}

// Get icon based on event type
function getEventIcon(type: string) {
  switch (type) {
    case "compression_started":
    case "compression_completed":
      return <CompressIcon fontSize="small" />;
    case "memory_extracted":
    case "memory_stored":
      return <PsychologyIcon fontSize="small" />;
    case "analysis_completed":
      return <AutoFixHighIcon fontSize="small" />;
    case "warning":
      return <WarningAmberIcon fontSize="small" color="warning" />;
    case "success":
      return <CheckCircleOutlineIcon fontSize="small" color="success" />;
    default:
      return <InfoOutlinedIcon fontSize="small" />;
  }
}

// Get background color based on event type
function getEventColor(type: string): string {
  switch (type) {
    case "compression_completed":
    case "success":
      return "success.dark";
    case "warning":
      return "warning.dark";
    case "error":
      return "error.dark";
    default:
      return "info.dark";
  }
}

// Format event message
function formatEventMessage(event: SystemEventData): string {
  if (event.message) return event.message;

  switch (event.type) {
    case "compression_started":
      return "Compressing conversation history...";
    case "compression_completed":
      const count = event.data?.message_count || "several";
      return `Conversation compressed: ${count} messages summarized.`;
    case "memory_extracted":
      const memCount = event.data?.count || 0;
      return `Extracted ${memCount} memories from conversation.`;
    case "memory_stored":
      return "Memory stored successfully.";
    case "analysis_completed":
      return "Conversation analysis completed.";
    default:
      return event.type.replace(/_/g, " ");
  }
}

export default function SystemEventMessage({
  event,
  onDismiss,
  onAction,
}: SystemEventMessageProps) {
  const [visible, setVisible] = React.useState(true);

  if (!visible) return null;

  const handleDismiss = () => {
    setVisible(false);
    onDismiss?.();
  };

  return (
    <Paper
      elevation={0}
      sx={{
        py: 1,
        px: 1.5,
        my: 1,
        mx: 2,
        backgroundColor: "action.selected",
        borderRadius: 1,
        borderLeft: "3px solid",
        borderLeftColor: getEventColor(event.type),
      }}
    >
      <Box display="flex" alignItems="center" gap={1}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 24,
            height: 24,
            borderRadius: "50%",
            backgroundColor: "action.hover",
          }}
        >
          {getEventIcon(event.type)}
        </Box>

        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ flex: 1, fontSize: 13 }}
        >
          {formatEventMessage(event)}
        </Typography>

        {/* Action buttons based on event type */}
        {event.type === "compression_completed" && event.data?.key_topics && (
          <Box display="flex" gap={0.5}>
            {(event.data.key_topics as string[]).slice(0, 3).map((topic, idx) => (
              <Typography
                key={idx}
                variant="caption"
                sx={{
                  px: 0.75,
                  py: 0.25,
                  borderRadius: 1,
                  backgroundColor: "primary.dark",
                  color: "primary.contrastText",
                  fontSize: 10,
                }}
              >
                {topic}
              </Typography>
            ))}
          </Box>
        )}

        {onDismiss && (
          <IconButton size="small" onClick={handleDismiss} sx={{ ml: 0.5 }}>
            <CloseIcon fontSize="small" sx={{ fontSize: 16 }} />
          </IconButton>
        )}
      </Box>
    </Paper>
  );
}

// Helper component for displaying multiple system events
export function SystemEventList({
  events,
  onDismiss,
}: {
  events: SystemEventData[];
  onDismiss?: (index: number) => void;
}) {
  return (
    <Box>
      {events.map((event, idx) => (
        <SystemEventMessage
          key={idx}
          event={event}
          onDismiss={onDismiss ? () => onDismiss(idx) : undefined}
        />
      ))}
    </Box>
  );
}


import React, { useEffect, useState, useRef, useCallback } from "react";
import {
  Box,
  Typography,
  CircularProgress,
  IconButton,
  Tooltip,
  Tabs,
  Tab,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import LanguageIcon from "@mui/icons-material/Language";
import FiberManualRecordIcon from "@mui/icons-material/FiberManualRecord";
import {
  BrowserInstance,
  BrowserWSMessage,
  ScreenshotPayload,
  connectBrowserWS,
  listBrowsers,
} from "../../api/browser";

interface BrowserPreviewProps {
  conversationId: string;
  browserId?: string; // Specific browser to show, or show all if not provided
}

const BrowserPreview: React.FC<BrowserPreviewProps> = ({
  conversationId,
  browserId,
}) => {
  const [browsers, setBrowsers] = useState<BrowserInstance[]>([]);
  const [screenshots, setScreenshots] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isUnmountedRef = useRef(false);

  // Connect WebSocket
  const connectWS = useCallback(() => {
    if (!conversationId || isUnmountedRef.current) return;

    // Clear any pending reconnect timeout
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Cleanup existing connection
    if (wsRef.current) {
      wsRef.current.onclose = null; // Prevent triggering onclose handler
      wsRef.current.onerror = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    const ws = connectBrowserWS(
      conversationId,
      (msg: BrowserWSMessage) => {
        if (isUnmountedRef.current) return;
        console.log("[BrowserPreview] WS message received:", msg.type, msg.payload);
        switch (msg.type) {
          case "browser_list":
            setBrowsers(msg.payload || []);
            setLoading(false);
            break;
          case "screenshot":
            const payload = msg.payload as ScreenshotPayload;
            console.log("[BrowserPreview] Screenshot received for browser:", payload.browser_id, "tabs:", payload.tabs?.length);
            setScreenshots((prev) => ({
              ...prev,
              [payload.browser_id]: payload.data,
            }));
            // Update browser info including tabs
            setBrowsers((prev) =>
              prev.map((b) =>
                b.id === payload.browser_id
                  ? {
                      ...b,
                      current_url: payload.url,
                      current_title: payload.title,
                      tabs: payload.tabs || b.tabs,
                      active_tab: payload.active_tab ?? b.active_tab,
                    }
                  : b
              )
            );
            break;
          case "state_change":
            // Refresh browser list
            listBrowsers(conversationId)
              .then(setBrowsers)
              .catch(console.error);
            break;
        }
      },
      () => {
        if (isUnmountedRef.current) return;
        setError("WebSocket connection error");
        // Clear any pending timeout before setting new one
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
        }
        // Reconnect after 3 seconds
        reconnectTimeoutRef.current = setTimeout(connectWS, 3000);
      },
      () => {
        if (isUnmountedRef.current) return;
        // Clear any pending timeout before setting new one
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
        }
        // Reconnect after 3 seconds on close
        reconnectTimeoutRef.current = setTimeout(connectWS, 3000);
      }
    );

    wsRef.current = ws;
  }, [conversationId]);

  // Initial load and WebSocket connection
  useEffect(() => {
    isUnmountedRef.current = false;

    if (!conversationId) {
      setLoading(false);
      return;
    }

    // Fetch initial browser list
    listBrowsers(conversationId)
      .then((data) => {
        if (!isUnmountedRef.current) {
          setBrowsers(data || []);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error("Failed to fetch browsers:", err);
        if (!isUnmountedRef.current) {
          setLoading(false);
        }
      });

    // Connect WebSocket for real-time updates
    connectWS();

    return () => {
      isUnmountedRef.current = true;
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, [conversationId, connectWS]);

  // Manual refresh
  const handleRefresh = useCallback(() => {
    if (!conversationId) return;
    listBrowsers(conversationId)
      .then(setBrowsers)
      .catch(console.error);
  }, [conversationId]);

  // Filter browsers if specific ID provided
  const displayBrowsers = browserId
    ? browsers.filter((b) => b.id === browserId)
    : browsers;

  if (loading) {
    return (
      <Box
        display="flex"
        alignItems="center"
        justifyContent="center"
        height="100%"
        flexDirection="column"
        gap={2}
      >
        <CircularProgress size={32} />
        <Typography variant="body2" color="text.secondary">
          Loading browser preview...
        </Typography>
      </Box>
    );
  }

  if (displayBrowsers.length === 0) {
    return (
      <Box
        display="flex"
        alignItems="center"
        justifyContent="center"
        height="100%"
        flexDirection="column"
        gap={2}
      >
        <LanguageIcon sx={{ fontSize: 48, color: "text.disabled" }} />
        <Typography variant="body1" color="text.secondary">
          No active browsers
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Browser previews will appear here when AI starts a browser
        </Typography>
      </Box>
    );
  }

  return (
    <Box display="flex" flexDirection="column" height="100%" overflow="hidden">
      {/* Header */}
      <Box
        display="flex"
        alignItems="center"
        justifyContent="space-between"
        px={1.5}
        py={0.5}
        borderBottom={(theme) => `1px solid ${theme.palette.divider}`}
      >
        <Box display="flex" alignItems="center" gap={1}>
          <LanguageIcon fontSize="small" color="primary" />
          <Typography variant="subtitle2">
            Browser Preview ({displayBrowsers.length})
          </Typography>
        </Box>
        <Tooltip title="Refresh">
          <IconButton size="small" onClick={handleRefresh}>
            <RefreshIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Browser Grid */}
      <Box
        flex={1}
        overflow="auto"
        p={1}
        display="grid"
        gridTemplateColumns={
          displayBrowsers.length === 1
            ? "1fr"
            : "repeat(auto-fit, minmax(300px, 1fr))"
        }
        gap={1}
        alignContent="start"
      >
        {displayBrowsers.map((browser) => (
          <BrowserCard
            key={browser.id}
            browser={browser}
            screenshot={screenshots[browser.id]}
          />
        ))}
      </Box>
    </Box>
  );
};

// Individual browser card
interface BrowserCardProps {
  browser: BrowserInstance;
  screenshot?: string;
}

const BrowserCard: React.FC<BrowserCardProps> = ({ browser, screenshot }) => {
  // Get status indicator color
  const getStatusDotColor = (status: BrowserInstance["status"]) => {
    switch (status) {
      case "ready":
        return "#4caf50"; // green
      case "busy":
        return "#ff9800"; // orange
      case "starting":
        return "#2196f3"; // blue
      case "error":
        return "#f44336"; // red
      case "closed":
        return "#9e9e9e"; // grey
      default:
        return "#9e9e9e";
    }
  };

  // Get status tooltip text
  const getStatusTooltip = (status: BrowserInstance["status"]) => {
    switch (status) {
      case "ready":
        return "Ready";
      case "busy":
        return "Processing...";
      case "starting":
        return "Starting...";
      case "error":
        return "Error";
      case "closed":
        return "Closed";
      default:
        return status;
    }
  };

  return (
    <Box
      border={(theme) => `1px solid ${theme.palette.divider}`}
      borderRadius={1}
      overflow="hidden"
      display="flex"
      flexDirection="column"
      bgcolor="background.paper"
    >
      {/* Browser Header with Status Indicator */}
      <Box
        display="flex"
        alignItems="center"
        gap={0.5}
        px={1}
        py={0.5}
        bgcolor="action.hover"
        borderBottom={(theme) => `1px solid ${theme.palette.divider}`}
      >
        {/* Status dot indicator */}
        <Tooltip title={getStatusTooltip(browser.status)}>
          <Box display="flex" alignItems="center">
            {browser.status === "starting" || browser.status === "busy" ? (
              <CircularProgress
                size={10}
                thickness={6}
                sx={{ color: getStatusDotColor(browser.status) }}
              />
            ) : (
              <FiberManualRecordIcon
                sx={{
                  fontSize: 12,
                  color: getStatusDotColor(browser.status),
                }}
              />
            )}
          </Box>
        </Tooltip>

        <Typography
          variant="caption"
          noWrap
          flex={1}
          fontWeight={500}
          title={browser.current_title || browser.current_url || "about:blank"}
        >
          {browser.current_title || browser.current_url || "New Tab"}
        </Typography>

        {browser.current_url && (
          <Tooltip title="Open in external browser">
            <IconButton
              size="small"
              onClick={() => window.open(browser.current_url, "_blank")}
              sx={{ p: 0.25 }}
            >
              <OpenInNewIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {/* Tabs bar - show if there are tabs */}
      {browser.tabs && browser.tabs.length > 0 && (
        <Box
          sx={{
            borderBottom: 1,
            borderColor: "divider",
            bgcolor: "background.default",
          }}
        >
          <Tabs
            value={browser.active_tab || 0}
            variant="scrollable"
            scrollButtons="auto"
            sx={{
              minHeight: 28,
              "& .MuiTab-root": {
                minHeight: 28,
                py: 0,
                px: 1,
                fontSize: 11,
                textTransform: "none",
              },
            }}
          >
            {browser.tabs.map((tab, index) => (
              <Tab
                key={tab.id || index}
                label={
                  <Box display="flex" alignItems="center" gap={0.5} maxWidth={120}>
                    <LanguageIcon sx={{ fontSize: 12 }} />
                    <Typography variant="caption" noWrap>
                      {tab.title || tab.url || "New Tab"}
                    </Typography>
                  </Box>
                }
                sx={{
                  opacity: index === (browser.active_tab || 0) ? 1 : 0.7,
                }}
              />
            ))}
          </Tabs>
        </Box>
      )}

      {/* Screenshot - 16:9 aspect ratio container */}
      <Box
        position="relative"
        bgcolor="grey.900"
        sx={{
          // 16:9 aspect ratio (720/1280 = 0.5625)
          paddingTop: "56.25%",
          width: "100%",
        }}
      >
        <Box
          position="absolute"
          top={0}
          left={0}
          right={0}
          bottom={0}
          display="flex"
          alignItems="center"
          justifyContent="center"
        >
          {browser.status === "starting" ? (
            <Box textAlign="center">
              <CircularProgress size={24} />
              <Typography variant="caption" display="block" color="text.secondary" mt={1}>
                Starting browser...
              </Typography>
            </Box>
          ) : screenshot ? (
            <img
              src={`data:image/png;base64,${screenshot}`}
              alt="Browser screenshot"
              style={{
                width: "100%",
                height: "100%",
                objectFit: "contain",
              }}
            />
          ) : (
            <Box textAlign="center">
              <LanguageIcon sx={{ fontSize: 32, color: "text.disabled" }} />
              <Typography variant="caption" display="block" color="text.secondary" mt={1}>
                Waiting for screenshot...
              </Typography>
            </Box>
          )}
        </Box>

        {/* Status overlay for busy/error */}
        {browser.status === "busy" && (
          <Box
            position="absolute"
            top={8}
            right={8}
            bgcolor="rgba(0,0,0,0.6)"
            borderRadius={1}
            px={1}
            py={0.5}
          >
            <Box display="flex" alignItems="center" gap={0.5}>
              <CircularProgress size={12} sx={{ color: "white" }} />
              <Typography variant="caption" color="white">
                Processing...
              </Typography>
            </Box>
          </Box>
        )}

        {browser.status === "error" && browser.error_message && (
          <Box
            position="absolute"
            bottom={0}
            left={0}
            right={0}
            bgcolor="error.dark"
            px={1}
            py={0.5}
          >
            <Typography variant="caption" color="white">
              {browser.error_message}
            </Typography>
          </Box>
        )}
      </Box>

      {/* URL bar */}
      <Box
        px={1}
        py={0.5}
        bgcolor="action.hover"
        borderTop={(theme) => `1px solid ${theme.palette.divider}`}
      >
        <Typography
          variant="caption"
          color="text.secondary"
          noWrap
          display="block"
          title={browser.current_url}
        >
          {browser.current_url || "about:blank"}
        </Typography>
      </Box>
    </Box>
  );
};

export default BrowserPreview;


import React, { useState, useEffect, useRef, useImperativeHandle } from "react";
import {
  Box,
  Tabs,
  Tab,
  Typography,
  Menu as MuiMenu,
  MenuItem,
} from "@mui/material"; // remove IconButton
import CloseIcon from "@mui/icons-material/Close";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import RefreshIcon from "@mui/icons-material/Refresh";
import LinkOffIcon from "@mui/icons-material/LinkOff";
import ComputerIcon from "@mui/icons-material/Computer";
import LanIcon from "@mui/icons-material/Lan";
import ViewInArIcon from "@mui/icons-material/ViewInAr";
import HomeIcon from "@mui/icons-material/Home";
import TerminalComponent, { cleanupTerminal } from "./Terminal";
import Toolbar from "./Toolbar.tsx";
import AssetTree, { AssetTreeHandle } from "./AssetTree";

// Get icon for tab based on asset type
function getTabIcon(assetType?: string): React.ReactNode {
  switch (assetType) {
    case "local":
      return <ComputerIcon sx={{ fontSize: 16 }} />;
    case "ssh":
      return <LanIcon sx={{ fontSize: 16 }} />;
    case "docker_host":
    case "docker_container":
      return <ViewInArIcon sx={{ fontSize: 16 }} />;
    default:
      return <HomeIcon sx={{ fontSize: 16 }} />;
  }
}

// Keep consistent data structure with App
interface TabPane {
  key: string;
  label: string;
  content: string;
  closable: boolean;
  hostInfo: {
    ip: string;
    port: number;
    name: string;
  };
  assetId?: string;
  meta?: {
    assetType?: string;
    assetName?: string;
    // Keep extra fields optional and shallow to avoid leaking secrets.
    host?: string;
    port?: number;
    // Docker container specific
    containerId?: string;
    containerName?: string;
  };
}

export interface AssetPageHandle {
  getCurrentTerminalStatus: () =>
    | {
        name: string;
        ip: string;
        port: number;
        connected: boolean;
        connectionTime?: number;
      }
    | undefined;
  getTotalTerminals: () => number;
  getActiveConnectionsCount: () => number;
  getActiveTabKey: () => string; // expose current active tab key
}

interface AssetPageProps {
  assetsVisible: boolean;
}

const AssetPage = React.forwardRef<AssetPageHandle, AssetPageProps>(
  ({ assetsVisible }, ref) => {
    // tabs & terminal connection states migrated from App
    const [activeTabKey, setActiveTabKey] = useState<string>("welcome");
    const [tabs, setTabs] = useState<TabPane[]>([
      {
        key: "welcome",
        label: "Welcome",
        content:
          "Please double-click a host in the left list to establish a connection.",
        closable: false,
        hostInfo: { ip: "", port: 0, name: "" },
      },
    ]);
    const [terminalStates, setTerminalStates] = useState<
      Map<string, { connected: boolean; connectionTime?: number }>
    >(new Map());
    const assetTreeRef = useRef<AssetTreeHandle>(null);

    // Right-click menu
    const [tabMenuAnchor, setTabMenuAnchor] = useState<HTMLElement | null>(
      null,
    );
    const [tabMenuItems, setTabMenuItems] = useState<
      {
        key: string;
        label: string;
        icon?: React.ReactNode;
        danger?: boolean;
        onClick: () => void;
      }[]
    >([]);

    // Close tab
    const handleTabClose = (targetKey: string) => {
      if (targetKey !== "welcome") cleanupTerminal(targetKey);
      const newTabs = tabs.filter((t) => t.key !== targetKey);
      setTabs(newTabs);
      if (activeTabKey === targetKey)
        setActiveTabKey(newTabs[newTabs.length - 1]?.key || "welcome");
    };

    // Build tab context menu
    const buildTabContextMenu = (tabKey: string) => {
      const tab = tabs.find((t) => t.key === tabKey);
      if (!tab) return [] as any[];
      const items: any[] = [];
      if (tab.key !== "welcome") {
        items.push(
          {
            key: "reload",
            label: "Reconnect",
            icon: <RefreshIcon fontSize="small" />,
            onClick: () => {},
          },
          {
            key: "copy-info",
            label: "Copy Connection Info",
            icon: <ContentCopyIcon fontSize="small" />,
            onClick: () => {
              const info = `${tab.hostInfo.name} (${tab.hostInfo.ip}:${tab.hostInfo.port})`;
              navigator.clipboard.writeText(info);
            },
          },
          {
            key: "disconnect",
            label: "Disconnect",
            icon: <LinkOffIcon fontSize="small" />,
            onClick: () => {},
          },
        );
      }
      if (tab.closable)
        items.push({
          key: "close",
          label: "Close Tab",
          icon: <CloseIcon fontSize="small" />,
          onClick: () => handleTabClose(tabKey),
        });
      const otherClosable = tabs.filter((t) => t.key !== tabKey && t.closable);
      if (otherClosable.length > 0)
        items.push({
          key: "close-others",
          label: "Close Other Tabs",
          onClick: () => {
            otherClosable.forEach(
              (t) => t.key !== "welcome" && cleanupTerminal(t.key),
            );
            const nt = tabs.filter((t) => t.key === tabKey || !t.closable);
            setTabs(nt);
            if (!nt.find((t) => t.key === activeTabKey))
              setActiveTabKey(tabKey);
          },
        });
      const closableAll = tabs.filter((t) => t.closable);
      if (closableAll.length > 0)
        items.push({
          key: "close-all",
          label: "Close All Tabs",
          onClick: () => {
            closableAll.forEach(
              (t) => t.key !== "welcome" && cleanupTerminal(t.key),
            );
            const nt = tabs.filter((t) => !t.closable);
            setTabs(nt);
            setActiveTabKey("welcome");
          },
        });
      return items;
    };

    // Terminal connection state update
    const handleTerminalConnectionChange = (
      tabKey: string,
      connected: boolean,
    ) => {
      setTerminalStates((prev) => {
        const next = new Map(prev);
        const prevState = next.get(tabKey);
        next.set(tabKey, {
          connected,
          connectionTime: connected
            ? prevState?.connectionTime || Date.now()
            : prevState?.connectionTime,
        });
        return next;
      });
    };

    // Methods exposed to parent component
    useImperativeHandle(
      ref,
      () => ({
        getCurrentTerminalStatus: () => {
          const tab = tabs.find((t) => t.key === activeTabKey);
          if (!tab || tab.key === "welcome") return undefined;
          const state = terminalStates.get(activeTabKey) || {
            connected: false,
          };
          return {
            name: tab.hostInfo.name,
            ip: tab.hostInfo.ip,
            port: tab.hostInfo.port,
            connected: state.connected,
            connectionTime: state.connectionTime,
          };
        },
        getTotalTerminals: () => tabs.filter((t) => t.key !== "welcome").length,
        getActiveConnectionsCount: () => {
          let c = 0;
          terminalStates.forEach((s) => {
            if (s.connected) c++;
          });
          return c;
        },
        getActiveTabKey: () => activeTabKey,
      }),
      [tabs, activeTabKey, terminalStates],
    );

    // Listen to asset connect event
    useEffect(() => {
      const handler = (e: Event) => {
        const { asset, node } = (e as CustomEvent).detail;
        const timestamp = Date.now();
        const rand = Math.floor(Math.random() * 10000);
        const key = `host-${asset.id}-${timestamp}-${rand}`;
        setTabs((prev) => {
          const same = prev.filter(
            (t) => t.assetId === asset.id && t.key !== "welcome",
          );
          const num = same.length + 1;
          const tabLabel = num === 1 ? asset.name : `${asset.name} (${num})`;
          const newTab: TabPane = {
            key,
            label: tabLabel,
            content: `Connecting to ${asset.name}...`,
            closable: true,
            hostInfo: {
              ip: node.ip || "",
              port: node.port || 0,
              name: asset.name,
            },
            assetId: asset.id,
            meta: {
              assetType: asset.type,
              assetName: asset.name,
              host: node.ip || "",
              port: node.port || 0,
            },
          };
          return [...prev, newTab];
        });
        setActiveTabKey(key);
      };
      window.addEventListener("asset-connect", handler as any);
      return () => window.removeEventListener("asset-connect", handler as any);
    }, []);

    // Listen to docker container connect event
    useEffect(() => {
      const handler = (e: Event) => {
        const { dockerHostAssetId, container } = (e as CustomEvent).detail;
        const timestamp = Date.now();
        const rand = Math.floor(Math.random() * 10000);
        const key = `docker-${dockerHostAssetId}-${container.id}-${timestamp}-${rand}`;
        setTabs((prev) => {
          const same = prev.filter(
            (t) => t.key.startsWith(`docker-${dockerHostAssetId}-${container.id}`) && t.key !== "welcome",
          );
          const num = same.length + 1;
          const tabLabel = num === 1 ? container.name : `${container.name} (${num})`;
          const newTab: TabPane = {
            key,
            label: tabLabel,
            content: `Connecting to container ${container.name}...`,
            closable: true,
            hostInfo: {
              ip: "docker",
              port: 0,
              name: container.name,
            },
            assetId: dockerHostAssetId,
            meta: {
              assetType: "docker_container",
              assetName: container.name,
              containerId: container.id,
              containerName: container.name,
            },
          };
          return [...prev, newTab];
        });
        setActiveTabKey(key);
      };
      window.addEventListener("docker-container-connect", handler as any);
      return () => window.removeEventListener("docker-container-connect", handler as any);
    }, []);

    // Trigger event when asset panel visibility changes
    useEffect(() => {
      window.dispatchEvent(new Event("asset-tree-visible"));
    }, [assetsVisible]);

    return (
      <Box display="flex" height="100%" flex={1} minHeight={0}>
        {/* Left asset tree */}
        {assetsVisible && <AssetTree ref={assetTreeRef} />}
        <Box flex={1} display="flex" flexDirection="row" minHeight={0}>
          <Box flex={1} display="flex" flexDirection="column" minHeight={0}>
            <Tabs
              value={activeTabKey}
              onChange={(_, v) => setActiveTabKey(v)}
              variant="scrollable"
              sx={{ minHeight: 36 }}
            >
              {tabs.map((tab) => (
                <Tab
                  key={tab.key}
                  value={tab.key}
                  sx={{ minHeight: 36, py: 0.5 }}
                  label={
                    <Box
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setTabMenuItems(buildTabContextMenu(tab.key));
                        setTabMenuAnchor(e.currentTarget);
                      }}
                      display="flex"
                      alignItems="center"
                      gap={0.5}
                    >
                      {getTabIcon(tab.meta?.assetType)}
                      <span style={{ fontSize: 12, verticalAlign: "middle" }}>
                        {tab.label}
                      </span>
                      {tab.closable && (
                        <Box
                          component="span"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            handleTabClose(tab.key);
                          }}
                          sx={(theme) => ({
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 16,
                            height: 16,
                            cursor: "pointer",
                            borderRadius: 1,
                            ml: 0.5,
                            color: theme.palette.text.secondary,
                            "&:hover": {
                              bgcolor: theme.palette.action.hover,
                              color: theme.palette.text.primary,
                            },
                            "& svg": { fontSize: 14 },
                          })}
                        >
                          <CloseIcon fontSize="inherit" />
                        </Box>
                      )}
                    </Box>
                  }
                />
              ))}
            </Tabs>
            <Box
              flex={1}
              overflow="hidden"
              display="flex"
              minHeight={0}
              position="relative"
            >
              {tabs.map((tab) => (
                <Box
                  key={tab.key}
                  sx={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    flexDirection: "column",
                    visibility: tab.key === activeTabKey ? "visible" : "hidden",
                    pointerEvents: tab.key === activeTabKey ? "auto" : "none",
                  }}
                  overflow="hidden"
                  minHeight={0}
                >
                  {tab.key === "welcome" ? (
                    <Box
                      flex={1}
                      display="flex"
                      alignItems="center"
                      justifyContent="center"
                    >
                      {tab.content}
                    </Box>
                  ) : (
                    <Box
                      flex={1}
                      display="flex"
                      flexDirection="column"
                      overflow="hidden"
                      minHeight={0}
                    >
                      <TerminalComponent
                        tabKey={tab.key}
                        assetId={tab.assetId || ""}
                        containerId={tab.meta?.containerId}
                        hostInfo={tab.hostInfo}
                        isActive={activeTabKey === tab.key}
                        onConnectionStateChange={(c) =>
                          handleTerminalConnectionChange(tab.key, c)
                        }
                      />
                    </Box>
                  )}
                </Box>
              ))}
            </Box>
          </Box>
          {/* Right side toolbar */}
          <Toolbar tabs={tabs} activeTabKey={activeTabKey} />
        </Box>

        {/* Tab context menu */}
        <MuiMenu
          open={Boolean(tabMenuAnchor)}
          anchorEl={tabMenuAnchor}
          onClose={() => setTabMenuAnchor(null)}
        >
          {tabMenuItems.map((item) => (
            <MenuItem
              key={item.key}
              onClick={() => {
                item.onClick();
                setTabMenuAnchor(null);
              }}
            >
              {item.label}
            </MenuItem>
          ))}
        </MuiMenu>
      </Box>
    );
  },
);

export default AssetPage;

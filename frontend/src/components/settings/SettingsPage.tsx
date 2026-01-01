import React, { useState } from "react";
import { Box, List, ListItemButton, ListItemIcon, ListItemText, Typography } from "@mui/material";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import TuneIcon from "@mui/icons-material/Tune";
import InfoIcon from "@mui/icons-material/Info";
import Models from "./models";

type SettingsMenu = "models" | "general" | "about";

interface MenuItem {
  id: SettingsMenu;
  label: string;
  icon: React.ReactNode;
}

const MENU_ITEMS: MenuItem[] = [
  { id: "models", label: "Models", icon: <SmartToyIcon fontSize="small" /> },
  { id: "general", label: "General", icon: <TuneIcon fontSize="small" /> },
  { id: "about", label: "About", icon: <InfoIcon fontSize="small" /> },
];

export const SettingsPage: React.FC = () => {
  const [selectedMenu, setSelectedMenu] = useState<SettingsMenu>("models");

  const renderContent = () => {
    switch (selectedMenu) {
      case "models":
        return <Models />;
      case "general":
        return (
          <Box p={3}>
            <Typography variant="h6" mb={2}>General Settings</Typography>
            <Typography color="text.secondary">Coming soon...</Typography>
          </Box>
        );
      case "about":
        return (
          <Box p={3}>
            <Typography variant="h6" mb={2}>About</Typography>
            <Typography color="text.secondary">Choraleia - AI-powered terminal application</Typography>
          </Box>
        );
      default:
        return null;
    }
  };

  return (
    <Box display="flex" height="100%" overflow="hidden">
      {/* Left: Settings Menu */}
      <Box
        sx={{
          width: 180,
          borderRight: "1px solid",
          borderColor: "divider",
          bgcolor: "#fafafa",
          flexShrink: 0,
        }}
      >
        <Box p={1.5} borderBottom="1px solid" borderColor="divider">
          <Typography fontSize={14} fontWeight={600}>
            Settings
          </Typography>
        </Box>
        <List dense disablePadding>
          {MENU_ITEMS.map((item) => (
            <ListItemButton
              key={item.id}
              selected={selectedMenu === item.id}
              onClick={() => setSelectedMenu(item.id)}
              sx={{
                py: 1,
                px: 1.5,
                "&.Mui-selected": {
                  bgcolor: "action.selected",
                  "&:hover": { bgcolor: "action.selected" },
                },
              }}
            >
              <ListItemIcon sx={{ minWidth: 32 }}>{item.icon}</ListItemIcon>
              <ListItemText
                primary={item.label}
                primaryTypographyProps={{ fontSize: 13 }}
              />
            </ListItemButton>
          ))}
        </List>
      </Box>

      {/* Right: Content */}
      <Box flex={1} overflow="auto">
        {renderContent()}
      </Box>
    </Box>
  );
};

export default SettingsPage;


// filepath: /home/blue/codes/choraleia/frontend/src/components/assets/TerminalSearchBar.tsx
import React, { useState, useRef, useEffect } from "react";
import { Box, InputBase, IconButton, Typography } from "@mui/material";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import CloseIcon from "@mui/icons-material/Close";

interface TerminalSearchBarProps {
  open: boolean;
  onClose: () => void;
  onFindNext: (query: string) => boolean;
  onFindPrevious: (query: string) => boolean;
}

const TerminalSearchBar: React.FC<TerminalSearchBarProps> = ({
  open,
  onClose,
  onFindNext,
  onFindPrevious,
}) => {
  const [query, setQuery] = useState("");
  const [resultInfo, setResultInfo] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when opened
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [open]);

  // Handle keyboard shortcuts
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "Enter") {
        if (e.shiftKey) {
          handleFindPrevious();
        } else {
          handleFindNext();
        }
      } else if (e.key === "F3") {
        e.preventDefault();
        if (e.shiftKey) {
          handleFindPrevious();
        } else {
          handleFindNext();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, query]);

  const handleFindNext = () => {
    if (!query) return;
    const found = onFindNext(query);
    setResultInfo(found ? "" : "No results");
  };

  const handleFindPrevious = () => {
    if (!query) return;
    const found = onFindPrevious(query);
    setResultInfo(found ? "" : "No results");
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    setResultInfo("");
    // Auto search on input
    if (e.target.value) {
      const found = onFindNext(e.target.value);
      setResultInfo(found ? "" : "No results");
    }
  };

  if (!open) return null;

  return (
    <Box
      sx={{
        position: "absolute",
        top: 8,
        right: 8,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        gap: 0.25,
        bgcolor: "background.paper",
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1,
        px: 1,
        py: 0.25,
        boxShadow: 2,
      }}
    >
      <InputBase
        inputRef={inputRef}
        value={query}
        onChange={handleInputChange}
        placeholder="Search..."
        size="small"
        sx={{
          fontSize: 12,
          width: 160,
          "& .MuiInputBase-input": {
            py: 0.5,
            px: 0.5,
          },
        }}
      />
      {resultInfo && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontSize: 10, whiteSpace: "nowrap", mx: 0.5 }}
        >
          {resultInfo}
        </Typography>
      )}
      <IconButton
        size="small"
        onClick={handleFindPrevious}
        disabled={!query}
        title="Previous (Shift+Enter)"
        sx={{ p: 0.25 }}
      >
        <KeyboardArrowUpIcon sx={{ fontSize: 18 }} />
      </IconButton>
      <IconButton
        size="small"
        onClick={handleFindNext}
        disabled={!query}
        title="Next (Enter)"
        sx={{ p: 0.25 }}
      >
        <KeyboardArrowDownIcon sx={{ fontSize: 18 }} />
      </IconButton>
      <IconButton
        size="small"
        onClick={onClose}
        title="Close (Esc)"
        sx={{ p: 0.25 }}
      >
        <CloseIcon sx={{ fontSize: 16 }} />
      </IconButton>
    </Box>
  );
};

export default TerminalSearchBar;


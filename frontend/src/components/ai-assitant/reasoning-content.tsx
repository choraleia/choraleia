import { FC, useEffect, useRef, useState } from "react";
import { ChevronDownIcon, ChevronRightIcon, BrainIcon } from "./assistant-icons.tsx";
import { cn } from "./lib/utils.ts";
import Paper from "@mui/material/Paper";
import Box from "@mui/material/Box";
import Collapse from "@mui/material/Collapse";
import Typography from "@mui/material/Typography";
import Divider from "@mui/material/Divider";
import { useTheme } from "@mui/material/styles";

interface ReasoningContentProps {
  text?: string;
  className?: string;
}

export const ReasoningContent: FC<ReasoningContentProps> = ({ text, className }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const theme = useTheme();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  if (!text || !text.trim()) return null;

  // Normalize indentation: remove leading blank lines and common indent
  const normalizeIndentation = (input: string): string => {
    const lines = input.replace(/\r\n?/g, "\n").split("\n");
    while (lines.length && lines[0].trim() === "") lines.shift();
    const indents = lines.filter(l => l.trim() !== "").map(l => (l.match(/^(\s*)/) || [""])[0]);
    const minIndentLength = indents.length ? Math.min(...indents.map(i => i.length)) : 0;
    return minIndentLength > 0 ? lines.map(l => l.slice(minIndentLength)).join("\n") : lines.join("\n");
  };

  const displayText = normalizeIndentation(text).trimStart();

  const toggleExpanded = () => setIsExpanded(prev => !prev);

  // Auto-scroll to bottom when text updates and expanded
  useEffect(() => {
    if (!isExpanded) return;
    const el = scrollRef.current;
    if (!el) return;
    // use requestAnimationFrame to ensure DOM updated
    const id = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(id);
  }, [displayText, isExpanded]);

  return (
    <Paper
      elevation={0}
      variant="outlined"
      sx={{
        mt: 1,
        backgroundColor: theme.palette.mode === "light" ? "#f9f9f9" : theme.palette.primary.dark + "20",
        borderColor: theme.palette.mode === "light" ? "#f0f0f0" : theme.palette.divider,
        p: 0,
        overflow: "hidden",
      }}
      className={cn(className)}
    >
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
          backgroundColor: theme.palette.mode === 'light' ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.06)',
          border: "none",
          outline: "none",
          fontSize: theme.typography.fontSize,
          fontWeight: 500,
          color: theme.palette.mode === "light" ? theme.palette.primary.main : theme.palette.primary.light,
          '&:hover': {
            backgroundColor: theme.palette.mode === 'light' ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.10)',
          },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', color: 'inherit' }}>
          <BrainIcon />
        </Box>
        <Typography component="span" variant="body2" sx={{ fontWeight: 500, color: 'inherit' }}>
          AI Reasoning Process
        </Typography>
        <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', color: 'inherit' }}>
          {isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
        </Box>
      </Box>
      <Collapse in={isExpanded} unmountOnExit timeout={150}>
        <Divider sx={{ mb: 0 }} />
        <Box
          sx={{
            px: 1.5,
            py: 1.5,
            backgroundColor: theme.palette.mode === 'dark' ? theme.palette.primary.dark + '30' : undefined,
          }}
        >
          {/* Scroll container with max height 400px */}
          <Box ref={scrollRef} sx={{ maxHeight: 400, overflowY: 'auto' }}>
            <Typography
              component="div"
              variant="body2"
              sx={{
                whiteSpace: 'pre-wrap',
                lineHeight: 1.6,
                color: theme.palette.text.secondary,
                fontFamily: theme.typography.fontFamily,
                fontSize: theme.typography.body2.fontSize,
              }}
            >
              {displayText}
            </Typography>
          </Box>
        </Box>
      </Collapse>
    </Paper>
  );
};

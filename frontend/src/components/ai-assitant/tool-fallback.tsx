import { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { ToolIcon, ChevronDownIcon, ChevronRightIcon } from "./assistant-icons.tsx";
import { useEffect, useRef, useState } from "react";
import Paper from "@mui/material/Paper";
import Box from "@mui/material/Box";
import Collapse from "@mui/material/Collapse";
import Typography from "@mui/material/Typography";
import Divider from "@mui/material/Divider";
import { useTheme } from "@mui/material/styles";

export const ToolFallback: ToolCallMessagePartComponent = ({
  toolName,
  argsText,
  result,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const theme = useTheme();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const toggleExpanded = () => setIsExpanded((p) => !p);

  // normalize indentation similar to reasoning-content
  const normalize = (input: string | undefined): string => {
    if (!input) return "";
    const lines = input.replace(/\r\n?/g, "\n").split("\n");
    while (lines.length && lines[0].trim() === "") lines.shift();
    const indents = lines.filter((l) => l.trim() !== "").map((l) => (l.match(/^(\s*)/) || [""])[0]);
    const minIndent = indents.length ? Math.min(...indents.map((i) => i.length)) : 0;
    const joined = minIndent > 0 ? lines.map((l) => l.slice(minIndent)).join("\n") : lines.join("\n");
    return joined.trimStart();
  };

  const displayArgs = normalize(argsText);
  const displayResult = typeof result === "string" ? normalize(result) : result !== undefined ? normalize(JSON.stringify(result, null, 2)) : "";

  // auto scroll to bottom on updates when expanded
  useEffect(() => {
    if (!isExpanded) return;
    const el = scrollRef.current;
    if (!el) return;
    const id = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(id);
  }, [displayArgs, displayResult, isExpanded]);

  return (
    <Paper
      elevation={0}
      variant="outlined"
      sx={{
        mt: 1, // unified with reasoning-content
        backgroundColor: theme.palette.mode === "light" ? "#f9f9f9" : theme.palette.background.paper,
        borderColor: theme.palette.mode === "light" ? "#f0f0f0" : theme.palette.divider,
        p: 0,
        overflow: "hidden",
      }}
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
          border: 'none',
          outline: 'none',
          fontSize: theme.typography.fontSize,
          fontWeight: 500,
          color: theme.palette.mode === 'light' ? theme.palette.primary.main : theme.palette.primary.light,
          '&:hover': { backgroundColor: theme.palette.mode === 'light' ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.10)' },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', color: 'inherit' }}>
          <ToolIcon />
        </Box>
        <Typography component="span" variant="body2" sx={{ fontWeight: 500, color: 'inherit' }}>
          Tool Call: {toolName}
        </Typography>
        <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', color: 'inherit' }}>
          {isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
        </Box>
      </Box>
      <Collapse in={isExpanded} unmountOnExit timeout={150}>
        <Divider sx={{ mb: 0 }} />
        <Box sx={{ px: 1.5, py: 1.5 }}>
          <Box ref={scrollRef} sx={{ maxHeight: 400, overflowY: 'auto' }}>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>Arguments:</Typography>
            <Typography component="pre" variant="body2" sx={{ whiteSpace: 'pre-wrap', m: 0, fontFamily: theme.typography.fontFamily }}>
              {displayArgs || '(none)'}
            </Typography>
            {result !== undefined && (
              <>
                <Divider sx={{ my: 1 }} />
                <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>Result:</Typography>
                <Typography component="pre" variant="body2" sx={{ whiteSpace: 'pre-wrap', m: 0, fontFamily: theme.typography.fontFamily }}>
                  {displayResult || '(empty)'}
                </Typography>
              </>
            )}
          </Box>
        </Box>
      </Collapse>
    </Paper>
  );
};

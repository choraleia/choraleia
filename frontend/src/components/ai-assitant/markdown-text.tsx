"use client";

import "@assistant-ui/react-markdown/styles/dot.css";

import {
  type CodeHeaderProps,
  MarkdownTextPrimitive,
  unstable_memoizeMarkdownComponents as memoizeMarkdownComponents,
  useIsMarkdownCodeBlock,
} from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";
import { type FC, memo, useState } from "react";

import { TooltipIconButton } from "./tooltip-icon-button.tsx";
import { CheckIcon, CopyIcon } from "./assistant-icons.tsx";
import { Box, Typography, Link as MuiLink, Divider } from "@mui/material";

const MarkdownTextImpl = () => {
  return (
    <MarkdownTextPrimitive
      remarkPlugins={[remarkGfm]}
      className="aui-md"
      components={defaultComponents}
    />
  );
};

export const MarkdownText = memo(MarkdownTextImpl);

const CodeHeader: FC<CodeHeaderProps> = ({ language, code }) => {
  const { isCopied, copyToClipboard } = useCopyToClipboard();
  const onCopy = () => {
    if (!code || isCopied) return;
    copyToClipboard(code);
  };

  return (
    <Box
      sx={(theme) => ({
        mt: 1.5,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 1,
        px: 2,
        py: 1,
        fontWeight: 600,
        bgcolor:
          theme.palette.mode === "dark"
            ? theme.palette.grey[900]
            : theme.palette.grey[800],
        color: theme.palette.common.white,
        borderTopLeftRadius: theme.shape.borderRadius,
        borderTopRightRadius: theme.shape.borderRadius,
        border: `1px solid ${theme.palette.divider}`,
        borderBottom: "none",
      })}
    >
      <Box component="span" sx={{ textTransform: "lowercase", fontSize: "0.75em" }}>
        {language}
      </Box>
      <TooltipIconButton tooltip="Copy" onClick={onCopy}>
        {!isCopied && <CopyIcon />}
        {isCopied && <CheckIcon />}
      </TooltipIconButton>
    </Box>
  );
};

const useCopyToClipboard = ({
  copiedDuration = 3000,
}: {
  copiedDuration?: number;
} = {}) => {
  const [isCopied, setIsCopied] = useState<boolean>(false);

  const copyToClipboard = (value: string) => {
    if (!value) return;

    navigator.clipboard.writeText(value).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), copiedDuration);
    });
  };

  return { isCopied, copyToClipboard };
};

const defaultComponents = memoizeMarkdownComponents({
  h1: ({ className, ...props }) => (
    <Typography
      component="h1"
      variant="h4"
      sx={(theme) => ({
        mb: 2,
        mt: 0,
        fontWeight: 800,
        scrollMarginTop: theme.spacing(5),
        letterSpacing: "-0.5px",
      })}
      className={className}
      {...props}
    />
  ),
  h2: ({ className, ...props }) => (
    <Typography
      component="h2"
      variant="h5"
      sx={(theme) => ({
        mt: 3,
        mb: 1.5,
        fontWeight: 600,
        scrollMarginTop: theme.spacing(5),
      })}
      className={className}
      {...props}
    />
  ),
  h3: ({ className, ...props }) => (
    <Typography
      component="h3"
      variant="h6"
      sx={(theme) => ({ mt: 2.5, mb: 1, fontWeight: 600, scrollMarginTop: theme.spacing(5) })}
      className={className}
      {...props}
    />
  ),
  h4: ({ className, ...props }) => (
    <Typography
      component="h4"
      variant="subtitle1"
      sx={{ mt: 2, mb: 1, fontWeight: 600 }}
      className={className}
      {...props}
    />
  ),
  h5: ({ className, ...props }) => (
    <Typography
      component="h5"
      variant="subtitle2"
      sx={{ my: 1.5, fontWeight: 600 }}
      className={className}
      {...props}
    />
  ),
  h6: ({ className, ...props }) => (
    <Typography
      component="h6"
      variant="subtitle2"
      sx={{ my: 1.5, fontWeight: 600, opacity: 0.85 }}
      className={className}
      {...props}
    />
  ),
  p: ({ className, ...props }) => (
    <Typography
      component="p"
      variant="body2"
      sx={{ mt: 1.5, mb: 1.5, lineHeight: 1.5 }}
      className={className}
      {...props}
    />
  ),
  a: ({ className, ...props }) => (
    <MuiLink
      underline="hover"
      sx={{ fontWeight: 500 }}
      className={className}
      {...props}
    />
  ),
  blockquote: ({ className, ...props }) => (
    <Box
      component="blockquote"
      sx={(theme) => ({
        borderLeft: `4px solid ${theme.palette.divider}`,
        pl: 2,
        py: 0.5,
        my: 2,
        fontStyle: "italic",
        color: theme.palette.text.secondary,
        backgroundColor: theme.palette.action.hover,
        borderRadius: theme.shape.borderRadius,
      })}
      className={className}
      {...props}
    />
  ),
  ul: ({ className, ...props }) => (
    <Box
      component="ul"
      sx={{ my: 2, pl: 3, listStyle: "disc", "& > li": { mt: 0.5 } }}
      className={className}
      {...props}
    />
  ),
  ol: ({ className, ...props }) => (
    <Box
      component="ol"
      sx={{ my: 2, pl: 3, listStyle: "decimal", "& > li": { mt: 0.5 } }}
      className={className}
      {...props}
    />
  ),
  hr: ({ className, ...props }) => (
    <Divider sx={{ my: 2 }} className={className} {...props} />
  ),
  table: ({ className, ...props }) => (
    <Box
      component="table"
      sx={(theme) => ({
        my: 2,
        width: "100%",
        borderCollapse: "separate",
        borderSpacing: 0,
        overflowX: "auto",
      })}
      className={className}
      {...props}
    />
  ),
  th: ({ className, ...props }) => {
    const { align, ...rest } = props as any;
    return (
      <Box
        component="th"
        sx={(theme) => ({
          bgcolor: theme.palette.action.hover,
          px: 2,
          py: 1,
          textAlign: align || "left",
          fontWeight: 700,
          border: `1px solid ${theme.palette.divider}`,
          '&:first-of-type': { borderTopLeftRadius: theme.shape.borderRadius },
          '&:last-of-type': { borderTopRightRadius: theme.shape.borderRadius },
        })}
        className={className}
        {...rest}
      />
    );
  },
  td: ({ className, ...props }) => {
    const { align, ...rest } = props as any;
    return (
      <Box
        component="td"
        sx={(theme) => ({
          px: 2,
          py: 1,
            textAlign: align || "left",
          border: `1px solid ${theme.palette.divider}`,
        })}
        className={className}
        {...rest}
      />
    );
  },
  tr: ({ className, ...props }) => (
    <Box
      component="tr"
      sx={{ m: 0, p: 0, '&:last-child td': { borderBottom: 'none' } }}
      className={className}
      {...props}
    />
  ),
  sup: ({ className, ...props }) => (
    <Box
      component="sup"
      sx={{ '& a': { fontSize: '0.65em', textDecoration: 'none' } }}
      className={className}
      {...props}
    />
  ),
  pre: ({ className, ...props }) => (
    <Box
      component="pre"
      sx={(theme) => ({
        overflowX: "auto",
        m: 0,
        p: 2,
        fontFamily: 'monospace',
        color: theme.palette.text.primary,
        backgroundColor:
          theme.palette.mode === 'dark'
            ? theme.palette.grey[900]
            : theme.palette.grey[100],
        border: `1px solid ${theme.palette.divider}`,
        borderBottomLeftRadius: theme.shape.borderRadius,
        borderBottomRightRadius: theme.shape.borderRadius,
      })}
      className={className}
      {...props}
    />
  ),
  code: function Code({ className, ...props }) {
    const isCodeBlock = useIsMarkdownCodeBlock();
    if (isCodeBlock) {
      return <code className={className} {...props} />;
    }
    return (
      <Box
        component="code"
        sx={(theme) => ({
          fontFamily: 'monospace',
          px: 0.75,
          py: 0.25,
          borderRadius: theme.shape.borderRadius,
          backgroundColor: theme.palette.action.hover,
          border: `1px solid ${theme.palette.divider}`,
          fontSize: '0.85em',
          fontWeight: 600,
        })}
        className={className}
        {...props}
      />
    );
  },
  CodeHeader,
});

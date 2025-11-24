// Icon wrapper components replacing lucide-react with MUI equivalents
// All icons sized to 16px to match previous lucide size usage.
import * as React from "react";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import CheckIconMui from "@mui/icons-material/Check";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ChevronLeftIconMui from "@mui/icons-material/ChevronLeft";
import ChevronRightIconMui from "@mui/icons-material/ChevronRight";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import EditIcon from "@mui/icons-material/Edit";
import RefreshIcon from "@mui/icons-material/Refresh";
import SendIcon from "@mui/icons-material/Send";
import PsychologyIcon from "@mui/icons-material/Psychology";
import AddIconMui from "@mui/icons-material/Add";
import ComputerIconMui from "@mui/icons-material/Computer";
import CloseIconMui from "@mui/icons-material/Close";
import BuildIcon from "@mui/icons-material/Build";
import DeleteIconMui from "@mui/icons-material/Delete";
import type { SvgIconProps } from "@mui/material/SvgIcon";

const sx = { fontSize: 16 } as const;

export const ArrowDownIcon = (props: SvgIconProps) => (
  <ArrowDownwardIcon sx={sx} {...props} />
);
export const CheckIcon = (props: SvgIconProps) => (
  <CheckIconMui sx={sx} {...props} />
);
export const ChevronDownIcon = (props: SvgIconProps) => (
  <ExpandMoreIcon sx={sx} {...props} />
);
export const ChevronLeftIcon = (props: SvgIconProps) => (
  <ChevronLeftIconMui sx={sx} {...props} />
);
export const ChevronRightIcon = (props: SvgIconProps) => (
  <ChevronRightIconMui sx={sx} {...props} />
);
export const ChevronUpIcon = (props: SvgIconProps) => (
  <ExpandLessIcon sx={sx} {...props} />
);
export const CopyIcon = (props: SvgIconProps) => (
  <ContentCopyIcon sx={sx} {...props} />
);
export const PencilIcon = (props: SvgIconProps) => (
  <EditIcon sx={sx} {...props} />
);
export const RefreshCwIcon = (props: SvgIconProps) => (
  <RefreshIcon sx={sx} {...props} />
);
export const SendHorizontalIcon = (props: SvgIconProps) => (
  <SendIcon sx={sx} {...props} />
);
export const BrainIcon = (props: SvgIconProps) => (
  <PsychologyIcon sx={sx} {...props} />
);
export const AddIcon = (props: SvgIconProps) => (
  <AddIconMui sx={sx} {...props} />
);
export const ComputerIcon = (props: SvgIconProps) => (
  <ComputerIconMui sx={sx} {...props} />
);
export const CloseIcon = (props: SvgIconProps) => (
  <CloseIconMui sx={sx} {...props} />
);
export const ToolIcon = (props: SvgIconProps) => (
  <BuildIcon sx={sx} {...props} />
);
export const DeleteIcon = (props: SvgIconProps) => (
  <DeleteIconMui sx={sx} {...props} />
);

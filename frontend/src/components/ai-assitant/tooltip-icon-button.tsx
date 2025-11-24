"use client";

import { forwardRef } from "react";
import Tooltip from "@mui/material/Tooltip";
import IconButton, { IconButtonProps } from "@mui/material/IconButton";

import { cn } from "./lib/utils.ts";

export type TooltipIconButtonProps = Omit<IconButtonProps, "color"> & {
  tooltip: string;
  side?: "top" | "bottom" | "left" | "right";
  // legacy variant prop from previous Button implementation; ignored but accepted to avoid TS errors
  variant?: string;
};

export const TooltipIconButton = forwardRef<
  HTMLButtonElement,
  TooltipIconButtonProps
>(
  (
    {
      children,
      tooltip,
      side = "bottom",
      className,
      variant: _variant,
      ...rest
    },
    ref,
  ) => {
    const placementMap: Record<string, any> = {
      top: "top",
      bottom: "bottom",
      left: "left",
      right: "right",
    };
    const iconBtn = (
      <IconButton
        aria-label={tooltip}
        ref={ref}
        {...rest}
        className={cn("p-0", className)}
        sx={{
          width: 24,
          height: 24,
          padding: "4px",
          "& .MuiSvgIcon-root": { fontSize: 16 },
        }}
      >
        {children}
      </IconButton>
    );
    // Wrap disabled button in span per MUI guidelines so Tooltip receives events
    const wrapped = rest.disabled ? (
      <span style={{ display: "inline-flex" }}>{iconBtn}</span>
    ) : (
      iconBtn
    );
    return (
      <Tooltip
        title={tooltip}
        placement={placementMap[side] || "bottom"}
        enterDelay={0}
        leaveDelay={0}
      >
        {wrapped}
      </Tooltip>
    );
  },
);

TooltipIconButton.displayName = "TooltipIconButton";

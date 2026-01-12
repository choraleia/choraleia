import React, { useRef, useState } from "react";

interface PaneResizerProps {
  direction: "horizontal" | "vertical";
  onResize: (delta: number) => void;
  onResizeEnd?: () => void;
}

export const PaneResizer: React.FC<PaneResizerProps> = ({ direction, onResize, onResizeEnd }) => {
  const lastPosRef = useRef<number>(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    lastPosRef.current = direction === "horizontal" ? e.clientX : e.clientY;
    setIsDragging(true);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const currentPos = direction === "horizontal" ? moveEvent.clientX : moveEvent.clientY;
      const delta = currentPos - lastPosRef.current;
      lastPosRef.current = currentPos;
      if (delta !== 0) {
        onResize(delta);
      }
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setIsDragging(false);
      // Dispatch resize end event to notify terminals
      window.dispatchEvent(new CustomEvent("pane-resize-end"));
      onResizeEnd?.();
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = direction === "horizontal" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
  };

  const isHorizontal = direction === "horizontal";
  const isActive = isDragging || isHovered;

  return (
    <div
      style={{
        position: "relative",
        flexShrink: 0,
        [isHorizontal ? "width" : "height"]: "1px",
        [isHorizontal ? "height" : "width"]: "100%",
      }}
    >
      {/* Visible line */}
      <div
        style={{
          position: "absolute",
          // Center the line when active
          top: isHorizontal ? 0 : (isActive ? "-1px" : 0),
          left: isHorizontal ? (isActive ? "-1px" : 0) : 0,
          width: isHorizontal ? (isActive ? "3px" : "1px") : "100%",
          height: isHorizontal ? "100%" : (isActive ? "3px" : "1px"),
          backgroundColor: isActive ? "#3b82f6" : undefined,
          transition: "all 0.1s ease",
          pointerEvents: "none",
        }}
        className={isActive ? "" : "bg-gray-300 dark:bg-gray-600"}
      />
      {/* Hit area - larger invisible area for easier grabbing */}
      <div
        style={{
          position: "absolute",
          [isHorizontal ? "width" : "height"]: "12px",
          [isHorizontal ? "height" : "width"]: "100%",
          [isHorizontal ? "left" : "top"]: "-6px",
          [isHorizontal ? "top" : "left"]: 0,
          cursor: isHorizontal ? "col-resize" : "row-resize",
          zIndex: 20,
        }}
        onMouseDown={handleMouseDown}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      />
    </div>
  );
};

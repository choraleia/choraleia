import React, { useCallback, useRef, useState, useMemo } from "react";
import { Box } from "@mui/material";
import { PaneContainer, TabContentRenderer } from "./PaneContainer";
import { PaneResizer } from "./PaneResizer";
import { Pane, isLeafPane, SplitDirection } from "../../../state/workspaces";

interface PaneTreeRendererProps {
  pane: Pane;
  activePaneId: string;
  workspaceId: string;
  workspaceName: string;
  runtimeType: string;
  dockerAssetId?: string;
  containerName?: string;
  containerId?: string;
  containerMode?: string;
  conversationId?: string;
  onTabChange: (paneId: string, tabId: string) => void;
  onCloseTab: (paneId: string, tabId: string) => void;
  onSplitPane: (paneId: string, tabId: string, direction: SplitDirection) => void;
  onPaneFocus: (paneId: string) => void;
  onResizePanes: (paneId: string, sizes: number[]) => void;
  onAddTerminal?: (paneId: string) => void;
  onEditorChange?: (paneId: string, tabId: string, content: string) => void;
  onEditorSave?: (paneId: string, tabId: string) => void;
  renderTabContent: TabContentRenderer;
}

// Separate component for branch pane to manage local resize state
const BranchPaneRenderer: React.FC<PaneTreeRendererProps & {
  children: Pane[];
  sizes: number[];
  direction: "horizontal" | "vertical";
}> = ({
  pane,
  children,
  sizes: propSizes,
  direction,
  activePaneId,
  workspaceId,
  workspaceName,
  runtimeType,
  dockerAssetId,
  containerName,
  containerId,
  containerMode,
  conversationId,
  onTabChange,
  onCloseTab,
  onSplitPane,
  onPaneFocus,
  onResizePanes,
  onAddTerminal,
  onEditorChange,
  onEditorSave,
  renderTabContent,
}) => {
  const isHorizontal = direction === "horizontal";
  const containerRef = useRef<HTMLDivElement>(null);

  // Use ref to track if we're currently dragging
  const isDraggingRef = useRef(false);

  // Local sizes state - initialized from props
  const [localSizes, setLocalSizes] = useState<number[]>(propSizes);
  const localSizesRef = useRef<number[]>(propSizes);

  // Only sync from props when NOT dragging and pane ID changes or sizes actually differ significantly
  const prevPaneIdRef = useRef(pane.id);
  const prevSizesRef = useRef(propSizes);

  // Check if sizes are meaningfully different (more than 0.1% difference)
  const sizesAreDifferent = useMemo(() => {
    if (prevSizesRef.current.length !== propSizes.length) return true;
    return propSizes.some((size, i) => Math.abs(size - prevSizesRef.current[i]) > 0.1);
  }, [propSizes]);

  // Only update local sizes when pane changes or external sizes differ significantly
  React.useEffect(() => {
    if (!isDraggingRef.current) {
      if (prevPaneIdRef.current !== pane.id || sizesAreDifferent) {
        setLocalSizes(propSizes);
        localSizesRef.current = propSizes;
        prevPaneIdRef.current = pane.id;
        prevSizesRef.current = propSizes;
      }
    }
  }, [pane.id, propSizes, sizesAreDifferent]);

  // Handle resize (incremental delta)
  const handleResize = useCallback((index: number, delta: number) => {
    if (!containerRef.current) return;
    isDraggingRef.current = true;

    const containerSize = isHorizontal
      ? containerRef.current.offsetWidth
      : containerRef.current.offsetHeight;

    if (containerSize === 0) return;

    const deltaPercent = (delta / containerSize) * 100;
    const minSize = 10; // Minimum 10% per pane

    const newSizes = [...localSizesRef.current];
    const newCurrent = newSizes[index] + deltaPercent;
    const newNext = newSizes[index + 1] - deltaPercent;

    // Check bounds
    if (newCurrent >= minSize && newNext >= minSize) {
      newSizes[index] = newCurrent;
      newSizes[index + 1] = newNext;
      localSizesRef.current = newSizes;
      setLocalSizes([...newSizes]); // Create new array to trigger re-render
    }
  }, [isHorizontal]);

  // Commit sizes to global state on drag end
  const handleResizeEnd = useCallback(() => {
    isDraggingRef.current = false;
    prevSizesRef.current = localSizesRef.current;
    onResizePanes(pane.id, localSizesRef.current);
  }, [pane.id, onResizePanes]);

  return (
    <Box
      ref={containerRef}
      display="flex"
      flexDirection={isHorizontal ? "row" : "column"}
      height="100%"
      width="100%"
      overflow="hidden"
      sx={{ minWidth: 0, minHeight: 0 }}
    >
      {children.map((child, index) => (
        <React.Fragment key={child.id}>
          <Box
            sx={{
              // Use flex grow with the size ratio, allowing proportional distribution
              flex: `${localSizes[index]} 1 0%`,
              minWidth: 0,
              minHeight: 0,
              overflow: "hidden",
              position: "relative",
            }}
          >
            <PaneTreeRenderer
              pane={child}
              activePaneId={activePaneId}
              workspaceId={workspaceId}
              workspaceName={workspaceName}
              runtimeType={runtimeType}
              dockerAssetId={dockerAssetId}
              containerName={containerName}
              containerId={containerId}
              containerMode={containerMode}
              conversationId={conversationId}
              onTabChange={onTabChange}
              onCloseTab={onCloseTab}
              onSplitPane={onSplitPane}
              onPaneFocus={onPaneFocus}
              onResizePanes={onResizePanes}
              onAddTerminal={onAddTerminal}
              onEditorChange={onEditorChange}
              onEditorSave={onEditorSave}
              renderTabContent={renderTabContent}
            />
          </Box>
          {index < children.length - 1 && (
            <PaneResizer
              direction={direction}
              onResize={(delta) => handleResize(index, delta)}
              onResizeEnd={handleResizeEnd}
            />
          )}
        </React.Fragment>
      ))}
    </Box>
  );
};

export const PaneTreeRenderer: React.FC<PaneTreeRendererProps> = (props) => {
  const { pane, renderTabContent, ...restProps } = props;

  // If it's a leaf pane, render PaneContainer
  if (isLeafPane(pane)) {
    return (
      <PaneContainer
        pane={pane}
        isActive={pane.id === props.activePaneId}
        workspaceId={props.workspaceId}
        workspaceName={props.workspaceName}
        runtimeType={props.runtimeType}
        dockerAssetId={props.dockerAssetId}
        containerName={props.containerName}
        containerId={props.containerId}
        containerMode={props.containerMode}
        conversationId={props.conversationId}
        onTabChange={props.onTabChange}
        onCloseTab={props.onCloseTab}
        onSplitPane={props.onSplitPane}
        onPaneFocus={props.onPaneFocus}
        onAddTerminal={props.onAddTerminal}
        onEditorChange={props.onEditorChange}
        onEditorSave={props.onEditorSave}
        renderTabContent={renderTabContent}
      />
    );
  }

  // It's a branch pane
  const children = pane.children || [];
  const sizes = pane.sizes || children.map(() => 100 / children.length);
  const direction = pane.direction || "horizontal";

  return (
    <BranchPaneRenderer
      {...props}
      children={children}
      sizes={sizes}
      direction={direction}
    />
  );
};

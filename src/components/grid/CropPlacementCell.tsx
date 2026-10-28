import React, { useRef, useCallback } from "react";
import { Trash2 } from "lucide-react";
import { calculateCropImageDimensions, getCellPixelPosition } from "../../utilities";
import { getGroundImagePath } from "../../types/greenhouse";
import { CropImage } from "../shared";
import type { LockedPlacement, SelectedCropForPlacement } from "../../types/greenhouse";
import type { FocusVisual } from "../../hooks/usePlacementFocus";
import { BARE_PLACEMENT_STYLE, FOCUS_RING, FOCUS_TRANSITION, LOCKED_GLOW, REMOVE_HOVER_GLOW, TARGET_GLOW, focusFade, shadows } from "./placementStyles";
import { BareGround } from "./BareGround";

interface BaseCellStyleParams {
  position: [number, number];
  size: number;
  cellSize: number;
  gap: number;
  groundType: string;
}

function getBaseCellStyle(params: BaseCellStyleParams): React.CSSProperties {
  const { position, size, cellSize, gap, groundType } = params;
  const { totalWidth, totalHeight } = calculateCropImageDimensions(size, cellSize, gap);
  const pixelPos = getCellPixelPosition(position[0], position[1], cellSize, gap);
  
  return {
    position: "absolute",
    top: pixelPos.top,
    left: pixelPos.left,
    width: totalWidth,
    height: totalHeight,
    backgroundImage: `url(${getGroundImagePath(groundType)})`,
    backgroundSize: `${cellSize}px ${cellSize}px`,
    backgroundPosition: "top left",
    backgroundRepeat: "repeat",
    borderRadius: 4,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  };
}

export interface LockedPlacementCellProps {
  placement: LockedPlacement;
  cellSize: number;
  gap: number;
  isDragging: boolean;
  isHovered: boolean;
  isPlacementMode?: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onClick?: () => void;
  onCancelDrag?: () => void;
  /** Highlighted or faded from the list below the grid. */
  focus?: FocusVisual;
  /** Inputs hidden: draw only the ground (a focused one still shows). */
  hidden?: boolean;
}

// px; less movement between mousedown and mouseup counts as a click.
const CLICK_THRESHOLD = 5;

export const LockedPlacementCell: React.FC<LockedPlacementCellProps> = ({
  placement,
  cellSize,
  gap,
  isDragging,
  isHovered,
  isPlacementMode = false,
  onMouseDown,
  onMouseEnter,
  onMouseLeave,
  onClick,
  onCancelDrag,
  focus = null,
  hidden = false,
}) => {
  const mouseDownPosRef = useRef<{ x: number; y: number } | null>(null);
  const hasDraggedRef = useRef(false);
  
  const { imageWidth, imageHeight } = calculateCropImageDimensions(placement.size, cellSize, gap);
  
  const baseStyle = getBaseCellStyle({
    position: placement.position,
    size: placement.size,
    cellSize,
    gap,
    groundType: placement.ground,
  });
  
  const bare = hidden && !isDragging && !isHovered && focus !== "focused";
  const style: React.CSSProperties = {
    ...baseStyle,
    ...(bare ? BARE_PLACEMENT_STYLE : {}),
    ...focusFade(isDragging ? null : focus),
    boxShadow: shadows(focus === "focused" && !isDragging && FOCUS_RING, isHovered ? REMOVE_HOVER_GLOW : !bare && LOCKED_GLOW),
    zIndex: isDragging ? 20 : focus === "focused" ? 12 : 10,
    cursor: isDragging ? "grabbing" : (isPlacementMode ? "crosshair" : "grab"),
    ...(isDragging ? { opacity: 0.8 } : {}),
    transform: isDragging ? undefined : "scale(1)",
    transition: isDragging ? "none" : `transform 0.15s ease, ${FOCUS_TRANSITION}`,
  };

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    mouseDownPosRef.current = { x: e.clientX, y: e.clientY };
    hasDraggedRef.current = false;
    
    onMouseDown(e);
  }, [onMouseDown]);

  const handleMouseMove = useCallback(() => {
    if (mouseDownPosRef.current && !hasDraggedRef.current) {
      hasDraggedRef.current = true;
    }
  }, []);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (mouseDownPosRef.current && onClick) {
      const dx = Math.abs(e.clientX - mouseDownPosRef.current.x);
      const dy = Math.abs(e.clientY - mouseDownPosRef.current.y);
      
      if (dx < CLICK_THRESHOLD && dy < CLICK_THRESHOLD) {
        e.stopPropagation();
        // Cancel the pending drag before opening the info modal.
        onCancelDrag?.();
        onClick();
      }
    }
    
    mouseDownPosRef.current = null;
    hasDraggedRef.current = false;
  }, [onClick, onCancelDrag]);

  return (
    <div
      style={style}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onContextMenu={(e) => e.preventDefault()}
      title={`${placement.crop} - Click for info, drag to move, right-click to remove`}
    >
      {bare ? (
        <BareGround ground={placement.ground} size={placement.size} cellSize={cellSize} gap={gap} />
      ) : (
        <CropImage
          cropId={placement.crop}
          cropName={placement.crop}
          width={imageWidth}
          height={imageHeight}
          showGround={false}
          groundType={placement.ground}
          hasGroundContext={true}
          showFallback={false}
        />
      )}
      
      {/* Trash icon on hover */}
      {isHovered && (
        <div className="absolute top-0.5 right-0.5 bg-red-500 rounded-bl-md p-0.5" data-gif-exclude="true">
          <Trash2 className="w-3 h-3 text-white" />
        </div>
      )}
    </div>
  );
};

export interface PlacementPreviewProps {
  position: [number, number];
  crop: SelectedCropForPlacement;
  isValid: boolean;
  cellSize: number;
  gap: number;
}

export const PlacementPreview: React.FC<PlacementPreviewProps> = ({
  position,
  crop,
  isValid,
  cellSize,
  gap,
}) => {
  const { imageWidth, imageHeight } = calculateCropImageDimensions(crop.size, cellSize, gap);
  
  const baseStyle = getBaseCellStyle({
    position,
    size: crop.size,
    cellSize,
    gap,
    groundType: crop.ground,
  });
  
  const style: React.CSSProperties = {
    ...baseStyle,
    zIndex: 15,
    opacity: 0.7,
    border: isValid ? "2px solid #22c55e" : "2px solid #ef4444",
    boxShadow: isValid 
      ? "0 0 12px rgba(34, 197, 94, 0.5)" 
      : "0 0 12px rgba(239, 68, 68, 0.5)",
    pointerEvents: "none",
  };

  return (
    <div style={style}>
      <CropImage
        cropId={crop.id}
        cropName={crop.name}
        width={imageWidth}
        height={imageHeight}
        showGround={false}
        groundType={crop.ground}
        hasGroundContext={true}
        showFallback={false}
      />
    </div>
  );
};


export interface CropCellProps {
  id: string;
  name: string;
  position: [number, number];
  size: number;
  groundType: string;
  cellSize: number;
  gap: number;
  isLocked?: boolean;
  onClick?: () => void;
  title?: string;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  /** Highlighted or faded from the list below the grid. */
  focus?: FocusVisual;
  /** Inputs hidden: draw only the ground (a focused one still shows). */
  hidden?: boolean;
}

export const CropCell: React.FC<CropCellProps> = ({
  id,
  name,
  position,
  size,
  groundType,
  cellSize,
  gap,
  isLocked = false,
  onClick,
  title,
  onMouseEnter,
  onMouseLeave,
  focus = null,
  hidden = false,
}) => {
  const { imageWidth, imageHeight } = calculateCropImageDimensions(size, cellSize, gap);
  const bare = hidden && focus !== "focused";

  const baseStyle = getBaseCellStyle({
    position,
    size,
    cellSize,
    gap,
    groundType,
  });

  const style: React.CSSProperties = {
    ...baseStyle,
    ...focusFade(focus),
    borderWidth: 2,
    borderStyle: "solid",
    borderColor: "transparent",
    ...(bare ? BARE_PLACEMENT_STYLE : {}),
    boxShadow: shadows(focus === "focused" && FOCUS_RING, isLocked && !bare && LOCKED_GLOW),
    zIndex: focus === "focused" ? 12 : undefined,
    cursor: onClick ? "pointer" : undefined,
    transition: FOCUS_TRANSITION,
  };

  const handleClick = (e: React.MouseEvent) => {
    if (onClick) {
      e.stopPropagation();
      onClick();
    }
  };

  return (
    <div
      style={style}
      title={title ?? `${name} (${position[0]}, ${position[1]})${size > 1 ? ` - ${size}x${size}` : ""}${isLocked ? " (Locked)" : ""} - Click for info`}
      className={`hover:z-10 ${onClick ? "hover:brightness-110" : ""}`}
      onClick={handleClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {bare ? (
        <BareGround ground={groundType} size={size} cellSize={cellSize} gap={gap} />
      ) : (
        <CropImage
          cropId={id}
          cropName={name}
          width={imageWidth}
          height={imageHeight}
          showGround={false}
          groundType={groundType}
          hasGroundContext={true}
          showFallback={false}
        />
      )}
    </div>
  );
};

export interface MutationCellProps {
  id: string;
  name: string;
  position: [number, number];
  size: number;
  groundType: string;
  cellSize: number;
  gap: number;
  /** Targets hidden: draw only the ground (a focused one still shows). */
  hidden?: boolean;
  onClick?: () => void;
  title?: string;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  /** Highlighted or faded from the list below the grid. */
  focus?: FocusVisual;
}

export const MutationCell: React.FC<MutationCellProps> = ({
  id,
  name,
  position,
  size,
  groundType,
  cellSize,
  gap,
  hidden = false,
  onClick,
  title,
  onMouseEnter,
  onMouseLeave,
  focus = null,
}) => {
  const { imageWidth, imageHeight } = calculateCropImageDimensions(size, cellSize, gap);
  // A target picked from the list below always shows, even with targets hidden.
  const bare = hidden && focus !== "focused";

  const baseStyle = getBaseCellStyle({
    position,
    size,
    cellSize,
    gap,
    groundType,
  });

  const style: React.CSSProperties = {
    ...baseStyle,
    ...(bare ? BARE_PLACEMENT_STYLE : {}),
    ...focusFade(focus),
    boxShadow: shadows(focus === "focused" && FOCUS_RING, !bare && TARGET_GLOW),
    zIndex: focus === "focused" ? 12 : 5, // above crops
    cursor: onClick ? "pointer" : undefined,
    transition: FOCUS_TRANSITION,
  };

  const handleClick = (e: React.MouseEvent) => {
    if (onClick) {
      e.stopPropagation();
      onClick();
    }
  };

  return (
    <div
      style={style}
      title={title ?? `${name} (${position[0]}, ${position[1]})${size > 1 ? ` - ${size}x${size}` : ""} - Click for info`}
      className={`hover:z-10 ${onClick ? "hover:brightness-110" : ""}`}
      onClick={handleClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {bare ? (
        <BareGround ground={groundType} size={size} cellSize={cellSize} gap={gap} />
      ) : (
        <CropImage
          cropId={id}
          cropName={name}
          width={imageWidth}
          height={imageHeight}
          showGround={false}
          groundType={groundType}
          hasGroundContext={true}
          showFallback={true}
          fallbackText={name}
        />
      )}
    </div>
  );
};
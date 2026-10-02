import React, { useState, type CSSProperties } from "react";
import { getCropImagePath, getGroundImagePath } from "../../types/greenhouse";
import { CROP_IMAGE_GLOW_FILTER, needsCropGlow } from "../../constants";

export type CropImageSize = "xs" | "sm" | "md" | "lg" | "xl" | "full" | "custom";

export interface CropImageProps {
  cropId: string;
  cropName: string;
  
  showGround?: boolean;
  groundType?: string;
  hasGroundContext?: boolean; // the parent renders the ground tile
  
  size?: CropImageSize;
  width?: number | string;
  height?: number | string;
  
  needsGlow?: boolean; // auto-detected when omitted
  applyPixelated?: boolean;
  
  className?: string;
  imageClassName?: string;
  style?: CSSProperties;
  imageStyle?: CSSProperties;
  
  showFallback?: boolean; // show initials if the image fails
  fallbackText?: string;
  fallbackClassName?: string;
  
  draggable?: boolean;
  
  onError?: () => void;
  onClick?: () => void;
}

const SIZE_PRESETS: Record<Exclude<CropImageSize, "custom" | "full">, { width: number; height: number }> = {
  xs: { width: 24, height: 24 }, // Small icons
  sm: { width: 32, height: 32 }, // Palette tiles
  md: { width: 48, height: 48 }, // List items
  lg: { width: 64, height: 64 }, // Grid cells
  xl: { width: 96, height: 96 }, // Large previews
};

/** Crop or mutation icon with optional ground tile, glow, size preset and initials fallback. */
export const CropImage: React.FC<CropImageProps> = ({
  cropId,
  cropName,
  showGround = false,
  groundType = "farmland",
  hasGroundContext = false,
  size = "md",
  width,
  height,
  needsGlow: glowOverride,
  applyPixelated = true,
  className = "",
  imageClassName = "",
  style = {},
  imageStyle = {},
  showFallback = true,
  fallbackText,
  fallbackClassName = "",
  draggable = false,
  onError,
  onClick,
}) => {
  const [imageError, setImageError] = useState(false);
  
  let finalWidth: number | string;
  let finalHeight: number | string;
  
  if (width !== undefined || height !== undefined) {
    finalWidth = width ?? height ?? "100%";
    finalHeight = height ?? width ?? "100%";
  } else if (size === "full") {
    finalWidth = "100%";
    finalHeight = "100%";
  } else if (size === "custom") {
    finalWidth = style.width ?? "100%";
    finalHeight = style.height ?? "100%";
  } else {
    const preset = SIZE_PRESETS[size];
    finalWidth = preset.width;
    finalHeight = preset.height;
  }
  
  // Glow only when a ground tile is shown, by this component or its parent.
  const shouldGlow = glowOverride ?? ((showGround || hasGroundContext) && needsCropGlow(cropId, groundType));
  
  const containerStyle: CSSProperties = {
    ...style,
    width: finalWidth,
    height: finalHeight,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    ...(showGround && {
      backgroundImage: `url(${getGroundImagePath(groundType)})`,
      backgroundSize: "cover",
      backgroundPosition: "center",
      backgroundRepeat: "no-repeat",
    }),
  };
  
  const finalImageStyle: CSSProperties = {
    ...imageStyle,
    maxWidth: "100%",
    maxHeight: "100%",
    objectFit: "contain",
    ...(applyPixelated && { imageRendering: "pixelated" as any }),
    ...(shouldGlow && { filter: CROP_IMAGE_GLOW_FILTER }),
  };
  
  const handleError = () => {
    setImageError(true);
    onError?.();
  };
  
  if (imageError && showFallback) {
    return (
      <div
        className={`flex items-center justify-center ${className}`}
        style={containerStyle}
        onClick={onClick}
      >
        <span className={`text-xs font-medium text-slate-400 ${fallbackClassName}`}>
          {fallbackText ?? cropName?.slice(0, 2).toUpperCase() ?? "??"}
        </span>
      </div>
    );
  }
  
  if (imageError && !showFallback) {
    return null;
  }
  
  return (
    <div
      className={className}
      style={containerStyle}
      onClick={onClick}
    >
      <img
        src={getCropImagePath(cropId)}
        alt={cropName || cropId}
        className={`object-contain pointer-events-none ${imageClassName}`}
        style={finalImageStyle}
        onError={handleError}
        draggable={draggable}
      />
    </div>
  );
};

/** Small ("sm") preset for palette tiles. */
export const CropImageTile: React.FC<Omit<CropImageProps, "size">> = (props) => {
  return <CropImage {...props} size="sm" />;
};

/** Medium ("md") preset for list items. */
export const CropImageListItem: React.FC<Omit<CropImageProps, "size">> = (props) => {
  return <CropImage {...props} size="md" />;
};

/** Large ("lg") preset for grid cells; shows ground by default. */
export const CropImageGridCell: React.FC<Omit<CropImageProps, "size" | "showGround"> & { showGround?: boolean }> = ({ showGround = true, ...props }) => {
  return <CropImage {...props} size="lg" showGround={showGround} />;
};

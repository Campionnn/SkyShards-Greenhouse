import React from "react";

/** Width of the margin on each side of the grid that holds a compass letter. */
export const COMPASS_GUTTER = 14;

/** Pixels a grid wrapped in a CompassFrame loses across its width (pass to useFitCellSize as `reserve`). */
export const COMPASS_RESERVE = COMPASS_GUTTER * 2;

const SIDES = [
  { letter: "N", name: "North", className: "top-0 left-1/2 -translate-x-1/2 text-rose-400/90", style: { height: COMPASS_GUTTER } },
  { letter: "S", name: "South", className: "bottom-0 left-1/2 -translate-x-1/2 text-slate-500", style: { height: COMPASS_GUTTER } },
  { letter: "W", name: "West", className: "left-0 top-1/2 -translate-y-1/2 text-slate-500", style: { width: COMPASS_GUTTER } },
  { letter: "E", name: "East", className: "right-0 top-1/2 -translate-y-1/2 text-slate-500", style: { width: COMPASS_GUTTER } },
] as const;

/**
 * Puts N / E / S / W on the four sides of a layout grid. The top of the
 * greenhouse grid is always north, so directional mechanics read the same in game.
 */
export const CompassFrame: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = "" }) => (
  <div className={`relative w-fit ${className}`} style={{ padding: COMPASS_GUTTER }}>
    {children}
    {SIDES.map(({ letter, name, className: pos, style }) => (
      <span
        key={letter}
        title={`${name}${letter === "N" ? " (the top of the grid is always north)" : ""}`}
        aria-label={name}
        className={`absolute flex items-center justify-center text-[10px] font-semibold leading-none select-none cursor-default ${pos}`}
        style={style}
      >
        {letter}
      </span>
    ))}
  </div>
);

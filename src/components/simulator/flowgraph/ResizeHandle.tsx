import React, { useRef } from "react";

// A thin draggable divider between two panels. Drag to resize (pointer capture, so it keeps
// tracking outside the handle), double-click to reset, arrow keys for keyboard users. The width
// lives in the caller (and is remembered there); the handle only reports deltas.

export const ResizeHandle: React.FC<{
  /** Which side of the handle the resized panel is on. */
  side: "left" | "right";
  width: number;
  min: number;
  max: number;
  onResize: (w: number) => void;
  onReset: () => void;
  label: string;
  className?: string;
}> = ({ side, width, min, max, onResize, onReset, label, className = "" }) => {
  const drag = useRef<{ x: number; w: number } | null>(null);
  const clamp = (w: number) => Math.round(Math.min(max, Math.max(min, w)));
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      tabIndex={0}
      title={`${label}: drag to resize, double-click to reset`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, w: width };
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const dx = e.clientX - drag.current.x;
        onResize(clamp(drag.current.w + (side === "left" ? dx : -dx)));
      }}
      onPointerUp={(e) => {
        drag.current = null;
        e.currentTarget.releasePointerCapture(e.pointerId);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 40 : 10;
        if (e.key === "ArrowLeft") onResize(clamp(width + (side === "left" ? -step : step)));
        else if (e.key === "ArrowRight") onResize(clamp(width + (side === "left" ? step : -step)));
        else return;
        e.preventDefault();
      }}
      className={`group relative z-10 w-0 shrink-0 cursor-col-resize outline-none ${className}`}
    >
      {/* Wide invisible hit area; a 2px line that lights up on hover / drag / focus. */}
      <span className="absolute inset-y-0 -left-[5px] w-[10px]" />
      <span className="pointer-events-none absolute inset-y-0 -left-px w-[2px] bg-transparent transition-colors duration-150 group-hover:bg-emerald-400/60 group-focus-visible:bg-emerald-400/80 group-active:bg-emerald-400" />
    </div>
  );
};

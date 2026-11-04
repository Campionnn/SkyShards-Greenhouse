import React from "react";

/** Explains the list entries: hover or click to find them on the grid; while one is pinned, how to let go. */
export const FindOnGridHint: React.FC<{ pinned: boolean; className?: string }> = ({ pinned, className = "" }) => (
  <span className={`text-[11px] hidden sm:inline ${pinned ? "text-slate-400" : "text-slate-500"} ${className}`}>
    {pinned ? "Click anywhere else to clear" : "Hover or click to find on the grid"}
  </span>
);

import React from "react";
import { cn } from "../ui/cn";

/** Explains the list entries: hover or click to find them on the grid; while one is pinned, how to let go. */
export const FindOnGridHint: React.FC<{ pinned: boolean; className?: string }> = ({ pinned, className }) => (
  <span className={cn("hidden text-meta sm:inline", pinned ? "text-fg-muted" : "text-fg-meta", className)}>
    {pinned ? "Click anywhere else to clear" : "Hover or click to find on the grid"}
  </span>
);

import React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../ui/cn";

/** Small "Details" button for the collapsible solver details. */
export const DetailsToggle: React.FC<{ open: boolean; onToggle: () => void; className?: string }> = ({ open, onToggle, className }) => (
  <button
    type="button"
    onClick={onToggle}
    aria-expanded={open}
    className={cn(
      "focus-ring inline-flex h-7 shrink-0 cursor-pointer items-center gap-0.5 rounded-control px-1.5 text-secondary text-fg-muted transition-colors duration-(--duration-hover) hover:bg-surface-hover hover:text-fg pointer-coarse:h-11",
      className,
    )}
    title={open ? "Hide solver details" : "Show solver details"}
  >
    {open ? "Less" : "Details"}
    <ChevronDown aria-hidden className={cn("size-3.5 transition-transform duration-(--duration-ink)", open && "rotate-180")} />
  </button>
);

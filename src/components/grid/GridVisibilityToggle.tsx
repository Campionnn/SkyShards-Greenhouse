import React, { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "../ui/cn";
import { Popover } from "../ui/Popover";
import { Switch } from "../ui/kit";

/**
 * What the grid draws: one compact "Show" control that opens two switches, "Input crops" and
 * "Target mutations". A hidden placement shows only its ground, so with both off the grid shows
 * just the ground. Props are the same as the old pair of Shown / Hidden segments.
 */
export const GridVisibilityToggle: React.FC<{
  inputsVisible: boolean;
  onInputsVisibleChange: (visible: boolean) => void;
  targetsVisible: boolean;
  onTargetsVisibleChange: (visible: boolean) => void;
  className?: string;
}> = ({ inputsVisible, onInputsVisibleChange, targetsVisible, onTargetsVisibleChange, className }) => {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const all = inputsVisible && targetsVisible;
  const summary = all ? "All" : inputsVisible ? "Inputs" : targetsVisible ? "Targets" : "Ground only";
  return (
    <div className={cn("flex items-center", className)}>
      <button
        ref={setAnchor}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Show on the grid: ${summary}`}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "hit-area focus-ring inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-control px-2 text-secondary transition-colors duration-(--duration-hover) hover:bg-surface-hover",
          all ? "text-fg-muted hover:text-fg" : "text-warn",
        )}
        title="Which placements the grid draws"
      >
        {all ? <Eye aria-hidden className="size-3.5" /> : <EyeOff aria-hidden className="size-3.5" />}
        Show <span className="font-semibold">{summary}</span>
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} label="Show on the grid" align="end" width={220} className="space-y-2 p-3">
        <Switch checked={inputsVisible} onChange={onInputsVisibleChange} label="Inputs" showLabel className="w-full justify-between" labelSide="start" />
        <Switch checked={targetsVisible} onChange={onTargetsVisibleChange} label="Targets" showLabel className="w-full justify-between" labelSide="start" />
        <p className="text-meta text-fg-meta">Hidden ones show only their ground.</p>
      </Popover>
    </div>
  );
};

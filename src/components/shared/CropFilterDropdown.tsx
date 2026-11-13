import React, { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { CropFilterCategory } from "../../types/greenhouse";
import { defaultGetFilterColor } from "./cropFilterColor";
import { cn } from "../ui/cn";
import { MenuItem, Popover } from "../ui/Popover";

export interface FilterOption {
  value: CropFilterCategory;
  label: string;
}

export interface CropFilterDropdownProps {
  value: CropFilterCategory;
  onChange: (value: CropFilterCategory) => void;
  options: FilterOption[];
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  getFilterColor?: (value: CropFilterCategory) => string;
  className?: string;
}


/** Crop filter dropdown shared by the Calculator and Designer: a field trigger and a kit menu. */
export const CropFilterDropdown: React.FC<CropFilterDropdownProps> = ({ value, onChange, options, isOpen, onToggle, onClose, getFilterColor = defaultGetFilterColor, className }) => {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const currentLabel = options.find((opt) => opt.value === value)?.label || "All";
  return (
    <div className={cn("relative shrink-0", className)}>
      <button
        ref={setAnchor}
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={`Filter: ${currentLabel}`}
        onClick={onToggle}
        className="focus-ring inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-control border border-line-control bg-surface-well pr-2 pl-2.5 text-body text-fg transition-colors duration-(--duration-hover) hover:border-fg-meta"
      >
        <span className="max-w-28 truncate">{currentLabel}</span>
        <ChevronDown aria-hidden className={cn("size-3.5 text-fg-meta transition-transform duration-(--duration-ink)", isOpen && "rotate-180")} />
      </button>
      <Popover anchor={anchor} open={isOpen} onClose={onClose} label="Filter" role="menu" width={200} align="end" className="max-h-72 overflow-y-auto overscroll-contain scrollbar-dark">
        {options.map((option) => (
          <MenuItem
            key={option.value}
            checked={value === option.value}
            onSelect={() => {
              onChange(option.value);
              onClose();
            }}
          >
            <span className={getFilterColor(option.value)}>{option.label}</span>
          </MenuItem>
        ))}
      </Popover>
    </div>
  );
};

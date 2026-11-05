import React from "react";
import { Search, X } from "lucide-react";
import { cn } from "../ui/cn";
import { IconButton, KitInput } from "../ui/kit";

export interface CropSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

/** Crop search input shared by the Calculator, Designer and Wiki. */
export const CropSearchInput: React.FC<CropSearchInputProps> = ({ value, onChange, placeholder = "Search...", className }) => (
  <div className={cn("relative min-w-0", className)}>
    <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-meta" />
    <KitInput type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder.replace(/\.{3}|…$/, "")} className="w-full pr-8 pl-8 [&::-webkit-search-cancel-button]:hidden" />
    {value && (
      <IconButton aria-label="Clear the search" className="absolute top-1/2 right-0.5 -translate-y-1/2" onClick={() => onChange("")}>
        <X />
      </IconButton>
    )}
  </div>
);

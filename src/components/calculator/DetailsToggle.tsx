import React from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

/** Small "Details" button for the collapsible solver details. */
export const DetailsToggle: React.FC<{ open: boolean; onToggle: () => void; className?: string }> = ({ open, onToggle, className = "" }) => (
  <button
    type="button"
    onClick={onToggle}
    aria-expanded={open}
    className={`flex items-center gap-0.5 text-[11px] text-slate-400 hover:text-slate-200 cursor-pointer flex-shrink-0 ${className}`}
    title={open ? "Hide solver details" : "Show solver details"}
  >
    {open ? "Less" : "Details"}
    {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
  </button>
);

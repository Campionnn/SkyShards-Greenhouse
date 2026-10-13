import React from "react";
import { Calculator, ClipboardPaste, FolderOpen, Palette } from "lucide-react";
import { SOURCE_LABEL, type HandoffSource } from "../../utilities";

const SOURCE_ICON: Record<HandoffSource, React.ReactNode> = {
  calculator: <Calculator className="w-3.5 h-3.5 text-emerald-400" />,
  designer: <Palette className="w-3.5 h-3.5 text-blue-400" />,
  saved: <FolderOpen className="w-3.5 h-3.5 text-slate-400" />,
  link: <ClipboardPaste className="w-3.5 h-3.5 text-amber-400" />,
};

/** "[icon] Saved layout": where a layout card came from. Shared by the Designer's Load modal and the Simulator's layout picker. */
export const LayoutSourceBadge: React.FC<{ from: HandoffSource; children?: React.ReactNode }> = ({ from, children }) => (
  <div className="flex items-center gap-1.5 text-[11px] text-slate-500 min-w-0">
    {SOURCE_ICON[from]}
    <span className="truncate">
      {SOURCE_LABEL[from]}
      {children}
    </span>
  </div>
);

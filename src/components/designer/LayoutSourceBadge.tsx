import React from "react";
import { Calculator, ClipboardPaste, FolderOpen, Palette } from "lucide-react";
import { SOURCE_LABEL, type HandoffSource } from "../../utilities";

const SOURCE_ICON: Record<HandoffSource, React.ReactNode> = {
  calculator: <Calculator />,
  designer: <Palette />,
  saved: <FolderOpen />,
  link: <ClipboardPaste />,
};

/**
 * "[icon] Saved layout · Modified Nov 9, 2026": where a layout card came from, as a neutral icon and meta
 * text. It wraps rather than cutting the date off. Shared by the Designer's Load dialog and the
 * Simulator's layout picker.
 */
export const LayoutSourceBadge: React.FC<{ from: HandoffSource; children?: React.ReactNode }> = ({ from, children }) => (
  <div className="flex min-w-0 items-start gap-1.5 text-meta text-fg-meta [&>svg]:mt-px [&>svg]:size-3.5 [&>svg]:shrink-0">
    {SOURCE_ICON[from]}
    <span className="min-w-0">
      {SOURCE_LABEL[from]}
      {children}
    </span>
  </div>
);

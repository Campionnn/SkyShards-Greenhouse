import React, { useRef } from "react";
import { cn } from "../ui/cn";
import { useFitToViewport } from "./calculatorLayout";

/**
 * A side column of the Calculator: the aside stretches to the row (and doesn't size it), and its
 * content sits in a sticky wrapper sized to the visible part of the column, so the rail stays in
 * view while the page scrolls and anything taller scrolls inside it.
 */
export const StickyRail: React.FC<{ label: string; className?: string; innerClassName?: string; children: React.ReactNode }> = ({ label, className, innerClassName, children }) => {
  const outer = useRef<HTMLElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  useFitToViewport(outer, inner);
  return (
    <aside ref={outer} aria-label={label} className={cn("min-w-0 self-stretch contain-size", className)}>
      <div ref={inner} className={cn("sticky top-4 flex min-h-0 flex-col", innerClassName)}>
        {children}
      </div>
    </aside>
  );
};

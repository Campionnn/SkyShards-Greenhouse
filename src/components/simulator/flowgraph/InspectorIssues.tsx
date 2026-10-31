import React, { useState } from "react";
import { ChevronRight, CircleAlert, TriangleAlert } from "lucide-react";
import type { ScenarioIssue } from "../../../simulator";
import { KitButton } from "../../ui/kit";
import type { InspectorTab } from "./context";
import { Popover } from "./InspectorPopover";

// The top bar's problems button: what the simulator reports for this plot (validateScenario),
// errors first, each clickable to its step.

export interface PlotIssue extends ScenarioIssue {
  /** Step index the issue belongs to, if any. */
  step: number | null;
  /** Exit index within that step ("› Exit 2" in the path), if the issue is about one exit. */
  exit: number | null;
  /** Inspector tab that shows it. */
  tab: InspectorTab;
}

export const IssuesButton: React.FC<{
  issues: PlotIssue[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Step names for the rows ("3. Chorus"). */
  stepName: (i: number) => string | null;
  onPick: (issue: PlotIssue) => void;
}> = ({ issues, open, onOpenChange, stepName, onPick }) => {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const errors = issues.filter((i) => i.level === "error");
  const sorted = [...errors, ...issues.filter((i) => i.level !== "error")];
  const label = errors.length ? `${errors.length} problem${errors.length === 1 ? "" : "s"}` : `${issues.length} warning${issues.length === 1 ? "" : "s"}`;
  const warnings = issues.length - errors.length;
  const heading = [errors.length && `${errors.length} problem${errors.length === 1 ? "" : "s"}`, warnings && `${warnings} warning${warnings === 1 ? "" : "s"}`].filter(Boolean).join(" · ");
  if (!issues.length) return null;
  return (
    <>
      <KitButton
        ref={setAnchor}
        variant={errors.length ? "danger" : "neutral"}
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={label}
        title={label}
        className={errors.length ? "" : "border-warn/25 text-warn hover:bg-warn/10"}
      >
        {errors.length ? <CircleAlert /> : <TriangleAlert />}
        <span className="hidden xl:inline">{label}</span>
        <span className="tabular-nums xl:hidden">{issues.length}</span>
      </KitButton>
      <Popover anchor={anchor} open={open} onClose={() => onOpenChange(false)} label="Problems in this flow" align="end" width={400} className="p-1.5">
        <div className="flex items-center justify-between px-2 pt-1 pb-2">
          <span className="text-body font-semibold text-fg">{heading}</span>
          <span className="text-meta text-fg-meta">Click one to go to its step</span>
        </div>
        <ul className="max-h-[min(360px,calc(100vh-120px))] overflow-y-auto overscroll-contain scrollbar-dark">
          {sorted.map((issue, k) => {
            const err = issue.level === "error";
            const where = issue.step !== null ? stepName(issue.step) : null;
            return (
              <li key={k}>
                <button
                  type="button"
                  onClick={() => onPick(issue)}
                  className="group flex w-full cursor-pointer items-start gap-2.5 rounded-control px-2 py-2 text-left transition-colors duration-150 hover:bg-fg-muted/10 focus-visible:bg-fg-muted/10 focus-visible:outline-none"
                >
                  <span className={`mt-px grid h-5 w-5 shrink-0 place-items-center rounded-inner ${err ? "bg-problem/15 text-problem" : "bg-warn/10 text-warn"}`}>
                    {err ? <CircleAlert className="h-3 w-3" /> : <TriangleAlert className="h-3 w-3" />}
                  </span>
                  <span className="min-w-0 flex-1 text-body leading-snug">
                    <span className="block text-fg-body">{issue.message}</span>
                    <span className="mt-0.5 block truncate text-meta text-fg-meta" title={issue.path}>
                      {where ?? issue.path.replace(/^Plot \d+ › /, "")}
                    </span>
                  </span>
                  {where && <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-meta transition-colors duration-150 group-hover:text-fg-body" />}
                </button>
              </li>
            );
          })}
        </ul>
      </Popover>
    </>
  );
};

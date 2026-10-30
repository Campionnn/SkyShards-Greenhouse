import React, { useState } from "react";
import { ChevronRight, CircleAlert, TriangleAlert } from "lucide-react";
import type { ScenarioIssue } from "../../../simulator";
import { KitButton } from "../../ui/kit";
import { Popover } from "./InspectorPopover";

// The top bar's problems button: what the simulator reports for this plot (validateScenario),
// errors first, each clickable to its step.

export interface PlotIssue extends ScenarioIssue {
  /** Step index the issue belongs to, if any. */
  step: number | null;
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
        className={errors.length ? "" : "border-amber-400/25 text-amber-200 hover:bg-amber-400/10"}
      >
        {errors.length ? <CircleAlert /> : <TriangleAlert />}
        <span className="hidden xl:inline">{label}</span>
        <span className="tabular-nums xl:hidden">{issues.length}</span>
      </KitButton>
      <Popover anchor={anchor} open={open} onClose={() => onOpenChange(false)} label="Problems in this flow" align="end" width={400} className="p-1.5">
        <div className="flex items-center justify-between px-2 pt-1 pb-2">
          <span className="text-[12.5px] font-semibold text-slate-100">{heading}</span>
          <span className="text-[11px] text-slate-500">Click one to go to its step</span>
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
                  className="group flex w-full cursor-pointer items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors duration-150 hover:bg-slate-400/10 focus-visible:bg-slate-400/10 focus-visible:outline-none"
                >
                  <span className={`mt-px grid h-5 w-5 shrink-0 place-items-center rounded-md ${err ? "bg-red-500/15 text-red-300" : "bg-amber-400/10 text-amber-300"}`}>
                    {err ? <CircleAlert className="h-3 w-3" /> : <TriangleAlert className="h-3 w-3" />}
                  </span>
                  <span className="min-w-0 flex-1 text-[12.5px] leading-snug">
                    <span className="block text-slate-200">{issue.message}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-slate-500" title={issue.path}>
                      {where ?? issue.path.replace(/^Plot \d+ › /, "")}
                    </span>
                  </span>
                  {where && <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-600 transition-colors duration-150 group-hover:text-slate-300" />}
                </button>
              </li>
            );
          })}
        </ul>
      </Popover>
    </>
  );
};

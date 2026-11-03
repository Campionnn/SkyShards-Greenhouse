import React, { useRef } from "react";
import type { FlowViewer } from "../../../hooks/useFlowViewer";
import { EVERY } from "../../../leaderboard/tiers";
import { cn } from "../../ui/cn";
import { surface } from "../../ui/surface";
import { everyTime } from "./statsSummary";

/**
 * The login frequency: the grid's frequencies as a radio group (one Tab stop, arrows move and
 * pick). There is no free number: the flows are only simulated at these, so any other value would
 * snap to the nearest one anyway.
 */

/** The seven simulated frequencies as radios with a roving tabindex. */
export const EveryRadios: React.FC<{ viewer: FlowViewer; className?: string; label?: string }> = ({ viewer, className, label = "Online every N cycles" }) => {
  const box = useRef<HTMLDivElement>(null);
  const at = EVERY.indexOf(viewer.every);
  const pick = (i: number) => {
    const n = EVERY[(i + EVERY.length) % EVERY.length];
    viewer.setEvery(n);
    box.current?.querySelector<HTMLButtonElement>(`[data-every="${n}"]`)?.focus();
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = at < 0 ? 0 : at;
    const next = e.key === "ArrowRight" || e.key === "ArrowDown" ? i + 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? EVERY.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    pick(next);
  };
  return (
    <div ref={box} role="radiogroup" aria-label={label} onKeyDown={onKeyDown} className={cn(surface.well, "inline-grid grid-flow-col auto-cols-fr gap-0.5 p-0.5", className)}>
      {EVERY.map((n, i) => {
        const on = viewer.every === n;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={on}
            data-every={n}
            tabIndex={on || (at < 0 && i === 0) ? 0 : -1}
            title={`Every ${n} cycle${n === 1 ? "" : "s"} · about every ${everyTime(viewer, n)}`}
            onClick={() => viewer.setEvery(n)}
            className={cn(
              "focus-ring h-7 min-w-7 cursor-pointer rounded-inner px-1.5 text-secondary font-semibold tabular-nums transition-colors duration-(--duration-hover) pointer-coarse:h-11",
              on ? "bg-surface-hover text-fg forced-colors:bg-[Highlight] forced-colors:text-[HighlightText]" : "text-fg-meta hover:text-fg-body",
            )}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
};

/**
 * "Online every [1 2 3 4 6 8 12] ≈ 1h 45m": only the frequencies the flows were simulated at (any
 * other number would just snap to one of them), and the time between logins at the viewer's speed.
 */
export const FrequencyPicker: React.FC<{ viewer: FlowViewer; className?: string }> = ({ viewer, className }) => (
  <div className={cn("flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1", className)} data-testid="frequency-picker">
    <span className="text-secondary whitespace-nowrap text-fg-meta">Online every</span>
    <EveryRadios viewer={viewer} />
    <span className="shrink-0 px-1.5 text-secondary whitespace-nowrap tabular-nums text-fg-muted" title={`One cycle ≈ ${everyTime(viewer, 1)} at your growth speed`}>
      ≈ {everyTime(viewer)}
    </span>
  </div>
);

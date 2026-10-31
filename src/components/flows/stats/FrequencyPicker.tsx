import React, { useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { FlowViewer } from "../../../hooks/useFlowViewer";
import { EVERY } from "../../../leaderboard/tiers";
import { cn } from "../../ui/cn";
import { KitInput } from "../../ui/kit";
import { Popover } from "../../ui/Popover";
import { surface } from "../../ui/surface";
import { everyTime } from "./statsSummary";

/**
 * "Online every [1 2 3 4 6 8 12] ≈ 1h 45m ▾": the grid's login frequencies as a radio group (one
 * Tab stop, arrows move and pick), and a popover for any other number (1–48) with the note that
 * the list uses the nearest simulated frequency.
 */

const clampEvery = (n: number) => Math.max(1, Math.min(48, Math.round(n)));

/** The note shown when the typed frequency isn't one the flows were simulated at (F112). */
export const SnapNote: React.FC<{ viewer: FlowViewer; className?: string }> = ({ viewer, className }) =>
  viewer.every !== viewer.stats.every ? (
    <p className={cn("text-secondary text-warn", className)}>
      Flows were simulated at every {EVERY.join(", ")} cycles: showing the nearest, every {viewer.every}.
    </p>
  ) : null;

/** Any number from 1 to 48; commits on Enter or when the field loses focus. */
export const EveryNumberInput: React.FC<{ viewer: FlowViewer; className?: string; id?: string }> = ({ viewer, className, id }) => {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const n = Number(draft);
    if (draft.trim() !== "" && Number.isFinite(n)) viewer.setEvery(clampEvery(n));
    setDraft(null);
  };
  return (
    <KitInput
      id={id}
      type="number"
      inputMode="numeric"
      min={1}
      max={48}
      step={1}
      value={draft ?? String(viewer.stats.every)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
      }}
      aria-label="Every N cycles (1 to 48)"
      className={cn("w-16 tabular-nums", className)}
    />
  );
};

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

export const FrequencyPicker: React.FC<{ viewer: FlowViewer; className?: string }> = ({ viewer, className }) => {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const snapped = viewer.every !== viewer.stats.every;
  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1", className)} data-testid="frequency-picker">
      <span className="text-secondary whitespace-nowrap text-fg-meta">Online every</span>
      <EveryRadios viewer={viewer} />
      <button
        ref={setAnchor}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Login frequency: about every ${everyTime(viewer)}. Any number`}
        onClick={() => setOpen((o) => !o)}
        className="focus-ring inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-control px-1.5 text-secondary whitespace-nowrap text-fg-muted transition-colors duration-(--duration-hover) hover:bg-surface-hover pointer-coarse:h-11"
      >
        <span className={cn("tabular-nums", snapped && "text-warn")}>
          {snapped ? `typed ${viewer.stats.every} · ` : ""}≈ {everyTime(viewer)}
        </span>
        <ChevronDown aria-hidden className={cn("size-3 shrink-0 text-fg-meta transition-transform duration-(--duration-ink)", open && "rotate-180")} />
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} label="Login frequency" width={280} align="end" initialFocus="first">
        <div className="space-y-2 p-2">
          <label className="flex items-center gap-2 text-secondary text-fg-muted">
            Every
            <EveryNumberInput viewer={viewer} />
            cycles
          </label>
          <p className="text-secondary text-fg-muted">
            One cycle ≈ <span className="tabular-nums text-fg-body">{everyTime(viewer, 1)}</span> at your growth speed.
          </p>
          <SnapNote viewer={viewer} />
        </div>
      </Popover>
    </div>
  );
};

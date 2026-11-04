import React from "react";
import { ArrowLeft, CheckCircle2, Loader2, Trophy } from "lucide-react";
import { SegmentedControl } from "../ui";
import type { FromNothingPreview } from "./fromNothingPreview";
import { nameOf } from "./format";
import { buttonClass } from "./styles";

const kitLines = (kit: Readonly<Record<string, number>>) =>
  Object.entries(kit)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

/** Finding the starting items before the preview opens (a borrow run in a worker). */
export const FromNothingPreparing: React.FC<{ progress: number; onCancel: () => void }> = ({ progress, onCancel }) => (
  <section className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-slate-300" data-testid="from-nothing-preparing">
    <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-300" />
    <span>Finding your flow's starting items... {Math.round(progress * 100)}%</span>
    <button type="button" className={`${buttonClass.neutral} ml-auto`} onClick={onCancel}>
      Cancel
    </button>
  </section>
);

/**
 * The banner over the simulator while it shows "from nothing": which part runs (the builder making
 * the starting items, or the flow from exactly those), the starting items (with the builder's
 * progress towards them), and the way back to the user's own flows.
 */
export const FromNothingBanner: React.FC<{
  preview: FromNothingPreview;
  /** The running simulation's inventory (the builder's progress towards the starting items). */
  inventory: Readonly<Record<string, number>> | null;
  onPart: (part: FromNothingPreview["part"]) => void;
  onExit: () => void;
}> = ({ preview, inventory, onPart, onExit }) => {
  const lines = kitLines(preview.kit);
  const builder = preview.part === "builder" && !!preview.builder;
  const done = builder && !!inventory && lines.every(([item, n]) => (inventory[item] ?? 0) >= n);
  return (
    <section className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2" data-testid="from-nothing-banner" aria-label="From nothing preview">
      <div className="flex flex-wrap items-center gap-2">
        <Trophy className="w-4 h-4 text-amber-300 flex-shrink-0" />
        <h2 className="text-sm font-medium text-slate-100">From nothing, as the Ironman board runs it</h2>
        <button type="button" className={`${buttonClass.primary} ml-auto`} onClick={onExit}>
          <ArrowLeft className="w-3.5 h-3.5" /> Back to my flow
        </button>
      </div>
      {preview.builder ? (
        <SegmentedControl
          size="xs"
          className="max-w-xl"
          value={preview.part}
          onChange={onPart}
          options={[
            { value: "builder", label: "1 · Builder makes the starting items", title: "The site's starting-items builder, from an empty inventory" },
            { value: "flow", label: "2 · Your flow from exactly those", title: "Your flow, strict ironman, starting with exactly the starting items" },
          ]}
        />
      ) : null}
      <p className="text-xs text-slate-300 leading-relaxed">
        {!preview.builder
          ? "Your flow needs no starting items, so from nothing is simply your flow from an empty inventory (strict ironman: nothing is lent)."
          : builder
            ? "The site's builder (a fixed Rose Dragon flow with free Dead Plants and Fermento) farms from an empty inventory until it owns your flow's starting items. Then part 2 starts."
            : "Your flow, strict ironman: it starts with exactly these items and nothing is lent. On the board it starts the day the builder finishes."}
      </p>
      {lines.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]" data-testid="from-nothing-kit">
          <span className="text-slate-500">Starting items</span>
          {lines.map(([item, n]) => {
            const have = builder && inventory ? Math.max(0, Math.floor(inventory[item] ?? 0)) : null;
            const ok = have !== null && have >= n;
            return (
              <span key={item} className={`rounded border px-1.5 py-0.5 tabular-nums ${ok ? "border-emerald-500/40 text-emerald-200" : "border-slate-600/50 text-slate-300"}`}>
                {have !== null ? `${Math.min(have, n).toLocaleString("en-US")} / ` : ""}
                {n.toLocaleString("en-US")} {nameOf(item)}
              </span>
            );
          })}
          {done && (
            <button type="button" className="flex items-center gap-1 text-emerald-300 hover:underline" onClick={() => onPart("flow")}>
              <CheckCircle2 className="w-3.5 h-3.5" /> all made: run part 2
            </button>
          )}
        </div>
      )}
      <p className="text-[11px] text-slate-500">
        Max stats, online every {preview.every} cycle{preview.every === 1 ? "" : "s"}, your own random seed. Your flows are untouched and nothing here is saved.
      </p>
    </section>
  );
};

import React, { useMemo } from "react";
import { Crosshair, Eye, EyeOff } from "lucide-react";
import type { FlowStep } from "../../../simulator";
import { CropImage } from "../../shared";
import { useContextMenu } from "../../ui/contextMenuContext";
import { InfoHint } from "../../ui/InfoHint";
import { KitButton } from "../../ui/kit";
import { nameOf } from "../format";
import { layoutToPlacements, withWatch } from "../scenarioEdit";
import { useFlowEditor } from "./context";

// Which of a step's target cells the uptime (sustainability) check records. `watch` undefined =
// every target (it follows layout edits); a list pins those anchors; [] checks none.

const GRID = 10;
const GAP = 3;

/** Picks the step's checked target cells. Same props as the old editor's picker. */
export const WatchPicker: React.FC<{ step: FlowStep; onChange: (watch: string[] | undefined) => void; cell?: number }> = ({ step, onChange, cell = 31 }) => {
  const openMenu = useContextMenu();
  const placements = useMemo(() => {
    try {
      return layoutToPlacements(step.layout);
    } catch {
      return null;
    }
  }, [step.layout]);
  if (!placements) return <p className="text-secondary text-problem">This step's layout could not be read.</p>;

  const targets = placements.targets.map((t) => ({ key: `${t.position[0]},${t.position[1]}`, id: t.cropId, row: t.position[0], col: t.position[1], size: t.size }));
  const all = targets.map((t) => t.key);
  const watched = new Set(step.watch ?? all);
  const count = targets.filter((t) => watched.has(t.key)).length;
  const toggle = (key: string) => {
    const next = all.filter((k) => (k === key ? !watched.has(k) : watched.has(k)));
    onChange(next.length === all.length ? undefined : next);
  };
  const targetMenu = (e: React.MouseEvent, t: (typeof targets)[number]) => {
    const on = watched.has(t.key);
    const same = targets.filter((x) => x.id === t.id).map((x) => x.key);
    openMenu(e, [
      { heading: `${nameOf(t.id)} · ${t.key}` },
      { label: on ? "Don't check this cell" : "Check this cell", icon: on ? <EyeOff /> : <Eye />, onSelect: () => toggle(t.key) },
      { label: "Check only this cell", icon: <Crosshair />, disabled: on && count === 1, onSelect: () => onChange(all.length === 1 ? undefined : [t.key]) },
      ...(same.length > 1 ? [{ label: `Check only ${nameOf(t.id)} (${same.length})`, icon: <Crosshair />, onSelect: () => onChange(same.length === all.length ? undefined : same) }] : []),
      { separator: true },
      { label: "Check all", icon: <Eye />, disabled: step.watch === undefined, onSelect: () => onChange(undefined) },
      { label: "Check none", icon: <EyeOff />, disabled: count === 0, onSelect: () => onChange([]) },
    ]);
  };
  const span = (n: number) => n * cell + (n - 1) * GAP;
  const at = (n: number) => n * (cell + GAP);
  const empty = targets.length === 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1.5 text-secondary text-fg-meta">
        <span>Click a target to include or exclude it from the uptime check.</span>
        <InfoHint title="Checked targets">
          A checked cell loses uptime whenever it sits empty without the requirements for its mutation, is blocked by something else, or its mutation stands there dried out.
        </InfoHint>
      </div>
      <div className="flex items-center gap-2">
        {empty ? (
          <span className="flex-1 text-secondary text-fg-meta">This step has no target cells. Add targets in its layout to check their uptime.</span>
        ) : (
          <span className="flex-1 text-body tabular-nums text-fg-body">
            {count} of {targets.length} checked{step.watch === undefined && <span className="text-fg-meta"> (all, the default)</span>}
          </span>
        )}
        <KitButton disabled={empty || step.watch === undefined} onClick={() => onChange(undefined)}>
          All
        </KitButton>
        <KitButton disabled={empty || count === 0} onClick={() => onChange([])}>
          None
        </KitButton>
      </div>
      <div className="self-start rounded-container border border-line bg-surface-well p-1.5">
        <div className="relative" style={{ width: span(GRID), height: span(GRID) }}>
          {Array.from({ length: GRID * GRID }, (_, k) => (
            <div key={k} className="absolute rounded-inner bg-surface-control" style={{ top: at(Math.floor(k / GRID)), left: at(k % GRID), width: cell, height: cell }} />
          ))}
          {placements.inputs.map((p) => (
            <div
              key={p.id}
              className="pointer-events-none absolute flex items-center justify-center rounded-inner opacity-35 grayscale-[35%]"
              style={{ top: at(p.position[0]), left: at(p.position[1]), width: span(p.size), height: span(p.size) }}
            >
              <CropImage cropId={p.cropId} cropName={nameOf(p.cropId)} width={span(p.size) * 0.78} height={span(p.size) * 0.78} showFallback={false} />
            </div>
          ))}
          {targets.map((t) => {
            const on = watched.has(t.key);
            return (
              <button
                key={t.key}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(t.key)}
                onContextMenu={(e) => targetMenu(e, t)}
                title={`${nameOf(t.id)} at (${t.key}) - ${on ? "checked" : "not checked"}`}
                className={`absolute flex cursor-pointer items-center justify-center rounded-inner transition-[box-shadow,background-color,opacity] duration-150 active:scale-[0.96] ${
                  on
                    ? "bg-select/15 ring-2 ring-inset ring-select/90 hover:bg-select/25"
                    : "bg-surface-well opacity-55 outline-[1.5px] outline-offset-[-1.5px] outline-dashed outline-line-control hover:opacity-90"
                }`}
                style={{ top: at(t.row), left: at(t.col), width: span(t.size), height: span(t.size) }}
              >
                <CropImage cropId={t.id} cropName={nameOf(t.id)} width={span(t.size) * 0.68} height={span(t.size) * 0.68} showFallback={false} />
                {on && (
                  <span className="absolute -top-1 -right-1 grid h-3.5 w-3.5 place-items-center rounded-full bg-select text-surface-page">
                    <Eye className="h-2.5 w-2.5" strokeWidth={2.5} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export const TargetsTab: React.FC = () => {
  const api = useFlowEditor();
  const i = api.selected;
  if (i === null || !api.plot.flow.steps[i]) return null;
  const step = api.plot.flow.steps[i];
  return <WatchPicker step={step} onChange={(watch) => api.editStep(i, (s) => withWatch(s, watch))} />;
};

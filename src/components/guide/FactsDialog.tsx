/**
 * "What's on the plot": optional facts, entered by tapping the farm picture.
 *
 * Tap a paid input to mark it missing, a Blastberry to mark it primed, a target cell to say a
 * mutation is standing there (and at what stage). Anything not reported stays unknown, and the
 * card says the decision assumes the farm is complete.
 */
import React, { useState } from "react";
import { Trash2 } from "lucide-react";
import type { GameData } from "../../simulator/data/types";
import { emptyFacts, itemName, type Farm, type PlotFacts } from "../../guide";
import { FarmPicture, type PickTarget } from "./FarmPicture";
import { Dialog, NumberField } from "./primitives";
import { buttonClass } from "./format";

const same = (a: { row: number; col: number }, b: { row: number; col: number }) => a.row === b.row && a.col === b.col;

/** "6× Startlevine, 1× Chloronite". */
function missingSummary(cells: { row: number; col: number }[], farm: Farm, name: (id: string) => string): string {
  const counts = new Map<string, number>();
  for (const c of cells) {
    const id = farm.layout.plants.find((p) => same(p, c))?.kindId;
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts].map(([id, n]) => `${n}× ${name(id)}`).join(", ");
}

export const FactsDialog: React.FC<{
  open: boolean;
  plotId: number;
  farm: Farm;
  facts: PlotFacts | undefined;
  data: GameData;
  onSave: (facts: PlotFacts | undefined) => void;
  onClose: () => void;
}> = ({ open, plotId, farm, facts, data, onSave, onClose }) => {
  const [draft, setDraft] = useState<PlotFacts>(() => facts ?? emptyFacts());
  const [mode, setMode] = useState<"missing" | "primed">("missing");
  const name = (id: string) => itemName(data, id);
  const hasBlastberry = farm.layout.plants.some((p) => p.kindId === "blastberry");
  const isDevourer = farm.products.some((p) => p.item === "devourer");

  const toggle = (list: { row: number; col: number }[], cell: { row: number; col: number }) =>
    list.some((c) => same(c, cell)) ? list.filter((c) => !same(c, cell)) : [...list, { row: cell.row, col: cell.col }];

  const pick = (t: PickTarget) => {
    if (t.kind === "slot") {
      const existing = draft.standing.find((s) => same(s, t));
      setDraft({
        ...draft,
        standing: existing ? draft.standing.filter((s) => !same(s, t)) : [...draft.standing, { row: t.row, col: t.col, kind: t.id, stage: 1, fullyGrown: false }],
      });
      return;
    }
    if (mode === "primed" && t.id === "blastberry") {
      setDraft({ ...draft, primed: toggle(draft.primed, t) });
      return;
    }
    if (t.paid) setDraft({ ...draft, missing: toggle(draft.missing, t) });
  };

  const maxStage = (kind: string) => data.mutations[kind]?.growthStages || 30;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`What's on Plot ${plotId}?`}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" className={buttonClass.ghost} onClick={() => setDraft(emptyFacts())}>
            <Trash2 className="h-3.5 w-3.5" /> Clear everything
          </button>
          <div className="flex gap-2">
            <button type="button" className={buttonClass.secondary} onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className={buttonClass.primary}
              onClick={() => {
                onSave(draft);
                onClose();
              }}
            >
              Save
            </button>
          </div>
        </div>
      }
    >
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]">
        <div>
          <p className="mb-2 text-sm text-slate-300">
            {farm.name}. Tap a <span className="text-amber-200">placed item</span> that's gone to mark it missing. Tap a{" "}
            <span className="text-cyan-200">dashed target cell</span> if something is growing there.
          </p>
          {hasBlastberry && (
            <div className="mb-2 inline-flex rounded-lg border border-slate-700 p-0.5 text-xs" role="radiogroup" aria-label="What a tap on a Blastberry means">
              {(["missing", "primed"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  onClick={() => setMode(m)}
                  className={`guide-press rounded-md px-2 py-1 ${mode === m ? "bg-slate-700 text-slate-100" : "text-slate-400"}`}
                >
                  {m === "missing" ? "Tap = missing" : "Tap Blastberry = primed ✹"}
                </button>
              ))}
            </div>
          )}
          <FarmPicture layout={farm.layout} nameOf={name} maxCell={44} facts={draft} onPick={pick} />
        </div>

        <div className="space-y-4 text-sm">
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Missing ({draft.missing.length})</h3>
            {draft.missing.length === 0 ? (
              <p className="text-xs text-slate-500">Nothing marked. The farm is assumed complete.</p>
            ) : (
              <p className="text-xs text-slate-300">{missingSummary(draft.missing, farm, name)}</p>
            )}
          </section>

          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Growing on target cells ({draft.standing.length})</h3>
            {draft.standing.length === 0 ? (
              <p className="text-xs text-slate-500">Nothing reported growing.</p>
            ) : (
              <ul className="space-y-2">
                {draft.standing.map((s) => (
                  <li key={`${s.row},${s.col}`} className="rounded-md border border-slate-700 bg-slate-800/60 p-2">
                    <p className="mb-1 text-xs font-medium text-slate-200">
                      {name(s.kind)} <span className="text-slate-500">· row {s.row + 1}, col {s.col + 1}</span>
                    </p>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
                      <label className="flex items-center gap-1">
                        Stage
                        <NumberField
                          label={`${name(s.kind)} stage`}
                          value={s.stage}
                          min={0}
                          max={maxStage(s.kind)}
                          onChange={(stage) => setDraft({ ...draft, standing: draft.standing.map((x) => (same(x, s) ? { ...x, stage } : x)) })}
                          className="w-16"
                        />
                      </label>
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={s.fullyGrown}
                          onChange={(e) => setDraft({ ...draft, standing: draft.standing.map((x) => (same(x, s) ? { ...x, fullyGrown: e.target.checked } : x)) })}
                          className="h-4 w-4 accent-violet-500"
                        />
                        Fully grown
                      </label>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {hasBlastberry && (
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Primed Blastberries ({draft.primed.length})</h3>
              <p className="text-xs text-slate-500">A placed Blastberry primes one cycle after it's placed. The Shellfruit pop waits until every one is primed.</p>
            </section>
          )}

          {isDevourer && (
            <label className="flex items-start gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-violet-500"
                checked={draft.devourerRefresh}
                onChange={(e) => setDraft({ ...draft, devourerRefresh: e.target.checked })}
              />
              A Devourer was harvested here, or one of the farm's plants decayed, since it was built.
            </label>
          )}
        </div>
      </div>
    </Dialog>
  );
};

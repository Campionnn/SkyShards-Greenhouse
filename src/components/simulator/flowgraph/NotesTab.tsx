import React, { useId } from "react";
import { Check } from "lucide-react";
import type { FlowUiColor } from "../../../simulator";
import { KitInput, KitLabel, KitTextarea } from "../../ui/kit";
import { useFlowEditor } from "./context";
import { FRAME_COLORS, withStepUi } from "./model";

// Editor-only notes: free text on the step and the frame (labelled box) it sits in. These live
// in FlowStep.ui, so editing them never restarts the run.

const FRAME_SWATCH: Record<FlowUiColor, string> = {
  slate: "bg-slate-400",
  emerald: "bg-emerald-400",
  sky: "bg-sky-400",
  violet: "bg-violet-400",
  amber: "bg-amber-400",
  rose: "bg-rose-400",
};

export const NotesTab: React.FC = () => {
  const api = useFlowEditor();
  const listId = useId();
  const i = api.selected;
  if (i === null || !api.plot.flow.steps[i]) return null;
  const step = api.plot.flow.steps[i];
  const ui = step.ui;
  const frames = [...new Set(api.plot.flow.steps.map((s) => s.ui?.frame?.trim()).filter((f): f is string => !!f))].sort();
  // A frame's colour is its first member's; show what this step's frame actually draws in.
  const frameColor = ui?.frame ? (api.plot.flow.steps.find((s) => s.ui?.frame === ui.frame && s.ui?.frameColor)?.ui?.frameColor ?? "slate") : (ui?.frameColor ?? "slate");
  const patch = (p: Parameters<typeof withStepUi>[1], mergeKey?: string) => api.editStep(i, (s) => withStepUi(s, p), { uiOnly: true, mergeKey });
  // Every member gets the colour, so it holds whichever member comes first.
  const setFrameColor = (c: FlowUiColor) =>
    api.edit(
      (p) => ({ ...p, flow: { ...p.flow, steps: p.flow.steps.map((s, k) => (k === i || (ui?.frame && s.ui?.frame === ui.frame) ? withStepUi(s, { frameColor: c }) : s)) } }),
      { uiOnly: true }
    );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <KitLabel>Note</KitLabel>
        <KitTextarea
          rows={5}
          value={ui?.note ?? ""}
          placeholder="Why this step exists, what to watch out for..."
          aria-label="Step note"
          onChange={(e) => patch({ note: e.target.value }, `note:${step.id}`)}
          className="w-full resize-y"
        />
        <p className="text-[11px] text-slate-500">Shown on the step's node. Notes and frames are only for you: they never change the simulation.</p>
      </div>
      <div className="flex flex-col gap-2">
        <KitLabel>Frame</KitLabel>
        <KitInput
          value={ui?.frame ?? ""}
          list={listId}
          placeholder="No frame"
          aria-label="Frame name"
          onChange={(e) => patch({ frame: e.target.value }, `frame:${step.id}`)}
          className="w-full"
        />
        <datalist id={listId}>
          {frames.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
        <p className="text-[11px] text-slate-500">Steps with the same frame name are drawn inside one labelled box.</p>
        {frames.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {frames.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => patch({ frame: f === ui?.frame ? undefined : f })}
                aria-pressed={f === ui?.frame}
                className={`cursor-pointer rounded-md px-2 py-0.5 text-[11.5px] transition-colors duration-150 active:scale-[0.97] ${
                  f === ui?.frame ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-400/10 text-slate-400 hover:text-slate-200"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        )}
        <div className="mt-1 flex items-center gap-3">
          <span className="text-[12px] text-slate-400">Colour</span>
          <div className="flex gap-1.5" role="radiogroup" aria-label="Frame colour">
            {FRAME_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={frameColor === c}
                aria-label={c}
                title={ui?.frame ? c : "Give the step a frame first"}
                disabled={!ui?.frame}
                onClick={() => setFrameColor(c)}
                className={`grid h-6 w-6 cursor-pointer place-items-center rounded-full transition-transform duration-150 ease-snappy active:scale-[0.92] disabled:cursor-default disabled:opacity-30 ${FRAME_SWATCH[c]} ${
                  frameColor === c && ui?.frame ? "ring-2 ring-slate-100/80 ring-offset-2 ring-offset-slate-900" : ""
                }`}
              >
                {frameColor === c && ui?.frame && <Check className="h-3 w-3 text-slate-950" strokeWidth={3} />}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

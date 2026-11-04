import { decodeDesign, encodeDesign, loadLayouts, LocalStorageManager, summarizeTargets, type HandoffSource, type IncomingLayout } from "../../utilities";
import { nameOf } from "./format";

// Layouts the user can load into a step: the last Calculator result, the current Designer layout,
// saved layouts and pasted share links. Used by the layout picker and the flow editor's add menu.

export type LayoutPreview = { inputs: { cropId: string; position: [number, number] }[]; targets: { cropId: string; position: [number, number] }[] };

export interface LayoutSource extends IncomingLayout {
  key: string;
  /** Card heading; `name` is what the step gets called. */
  title: string;
  detail: string;
  preview: LayoutPreview;
}

export const previewCounts = (p: LayoutPreview) => `${p.targets.length} target${p.targets.length === 1 ? "" : "s"} · ${p.inputs.length} plant${p.inputs.length === 1 ? "" : "s"}`;

export function sourceFromCode(key: string, from: HandoffSource, code: string, title: string, name?: string, detail?: string): LayoutSource | null {
  try {
    const preview = decodeDesign(code);
    const summary = summarizeTargets(preview.targets, nameOf);
    return { key, from, code, title, name: name ?? summary ?? title, detail: detail ?? summary ?? previewCounts(preview), preview };
  } catch {
    return null;
  }
}

/** Layouts stored on this device: last Calculator result, current Designer layout, saved layouts. */
export function gatherLayoutSources(): LayoutSource[] {
  const out: LayoutSource[] = [];
  const last = LocalStorageManager.loadLastSolverLayout();
  if (last) {
    const s = sourceFromCode("calculator", "calculator", last.code, "Last Calculator result", last.name);
    if (s) out.push(s);
  }
  const di = LocalStorageManager.loadDesignerInputs() ?? [];
  const dt = LocalStorageManager.loadDesignerTargets() ?? [];
  const dg = LocalStorageManager.loadDesignerGroundTiles() ?? [];
  if (di.length || dt.length || dg.length) {
    try {
      const code = encodeDesign(di, dt, dg);
      const s = sourceFromCode("designer", "designer", code, "Current Designer layout", summarizeTargets(dt, nameOf) ?? "Designer layout");
      if (s) out.push(s);
    } catch {
      // A corrupt saved design is not offered.
    }
  }
  for (const l of [...loadLayouts()].sort((a, b) => b.modifiedAt - a.modifiedAt)) {
    try {
      const code = encodeDesign(l.inputs, l.targets, l.groundTiles ?? []);
      const s = sourceFromCode(`saved:${l.id}`, "saved", code, l.name, l.name);
      if (s) out.push(s);
    } catch {
      // A corrupt saved layout is not offered.
    }
  }
  return out;
}

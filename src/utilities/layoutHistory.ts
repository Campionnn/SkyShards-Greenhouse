// Undo / redo for the designer grid. Pure helpers over whole-layout snapshots
// (inputs, targets, ground); DesignerProvider decides when an edit starts and
// ends (a whole paint or drag stroke is one step).

import type { GroundTile } from "./designEncoding";
import type { LayoutTransform } from "./layoutTransform";

/** How many steps back the designer remembers. */
export const LAYOUT_HISTORY_LIMIT = 100;

interface HistoryPiece {
  cropId: string;
  position: [number, number];
}

export interface LayoutSnapshot<P extends HistoryPiece = HistoryPiece> {
  inputs: P[];
  targets: P[];
  groundTiles: GroundTile[];
}

/**
 * A layout before (in `past`) or after (in `future`) one edit. `transform` is
 * set when that edit was a whole-layout nudge / rotate / mirror, so undo and
 * redo can tell an owner how cell-keyed data moved.
 */
export interface HistoryEntry<P extends HistoryPiece = HistoryPiece> {
  snapshot: LayoutSnapshot<P>;
  transform?: LayoutTransform;
}

export interface LayoutHistory<P extends HistoryPiece = HistoryPiece> {
  past: HistoryEntry<P>[];
  future: HistoryEntry<P>[];
}

export const emptyHistory = <P extends HistoryPiece>(): LayoutHistory<P> => ({ past: [], future: [] });

/** Record the layout from before a new edit. A new edit drops the redo stack. */
export function recordEdit<P extends HistoryPiece>(history: LayoutHistory<P>, before: HistoryEntry<P>, limit = LAYOUT_HISTORY_LIMIT): LayoutHistory<P> {
  const past = [...history.past, before];
  return { past: past.length > limit ? past.slice(past.length - limit) : past, future: [] };
}

/** Step back: the entry to restore, and the history with `current` saved for redo. */
export function undoStep<P extends HistoryPiece>(
  history: LayoutHistory<P>,
  current: LayoutSnapshot<P>
): { history: LayoutHistory<P>; entry: HistoryEntry<P> } | null {
  const entry = history.past[history.past.length - 1];
  if (!entry) return null;
  return {
    entry,
    history: { past: history.past.slice(0, -1), future: [...history.future, { snapshot: current, transform: entry.transform }] },
  };
}

/** Step forward again: the entry to restore, and the history with `current` saved for undo. */
export function redoStep<P extends HistoryPiece>(
  history: LayoutHistory<P>,
  current: LayoutSnapshot<P>
): { history: LayoutHistory<P>; entry: HistoryEntry<P> } | null {
  const entry = history.future[history.future.length - 1];
  if (!entry) return null;
  return {
    entry,
    history: { past: [...history.past, { snapshot: current, transform: entry.transform }], future: history.future.slice(0, -1) },
  };
}

/**
 * Turns a stream of edits into undo steps. Every edit calls `touch` BEFORE it
 * changes anything, with a key that groups it: all edits of one paint / erase
 * stroke share the stroke's key, a one-off edit gets a fresh key. The first
 * touch of a key snapshots the layout right then, so the step always starts
 * from the true "before", however React batches or delays the renders that
 * follow. `commit` reports each rendered layout; the open step is recorded
 * once, the first time the layout really differs from its "before" (a stroke
 * that changed nothing records nothing).
 */
export interface EditRecorder<P extends HistoryPiece = HistoryPiece> {
  touch: (key: number, current: LayoutSnapshot<P>, transform?: LayoutTransform) => void;
  commit: (current: LayoutSnapshot<P>) => void;
  /** Record the open step if it changed anything, then close it (before undo / redo). */
  close: (current: LayoutSnapshot<P>) => void;
}

export function createEditRecorder<P extends HistoryPiece>(onRecord: (entry: HistoryEntry<P>) => void): EditRecorder<P> {
  let open: { key: number; entry: HistoryEntry<P>; recorded: boolean } | null = null;
  const settle = (current: LayoutSnapshot<P>) => {
    if (open && !open.recorded && !sameLayout(open.entry.snapshot, current)) {
      open.recorded = true;
      onRecord(open.entry);
    }
  };
  return {
    touch(key, current, transform) {
      if (open?.key === key) return;
      settle(current);
      open = { key, entry: transform ? { snapshot: current, transform } : { snapshot: current }, recorded: false };
    },
    commit: settle,
    close(current) {
      settle(current);
      open = null;
    },
  };
}

/** The transform that puts every piece back where it was. */
export function invertTransform(t: LayoutTransform): LayoutTransform {
  switch (t.kind) {
    case "nudge":
      return { kind: "nudge", dRow: -t.dRow, dCol: -t.dCol };
    case "rotate":
      return { kind: "rotate", direction: t.direction === "cw" ? "ccw" : "cw" };
    case "mirror":
      return t;
  }
}

const pieceKey = (p: HistoryPiece) => `${p.cropId}@${p.position[0]},${p.position[1]}`;
const layoutKey = (s: LayoutSnapshot) =>
  [s.inputs.map(pieceKey).sort().join(";"), s.targets.map(pieceKey).sort().join(";"), s.groundTiles.map((t) => `${t.ground}@${t.position[0]},${t.position[1]}`).sort().join(";")].join("|");

/** Same crops, targets and ground in the same cells (ids and list order are ignored). */
export function sameLayout(a: LayoutSnapshot, b: LayoutSnapshot): boolean {
  if (a.inputs === b.inputs && a.targets === b.targets && a.groundTiles === b.groundTiles) return true;
  return layoutKey(a) === layoutKey(b);
}

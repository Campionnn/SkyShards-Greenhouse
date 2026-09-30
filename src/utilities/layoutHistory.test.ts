import { describe, expect, it } from "vitest";
import { createEditRecorder, emptyHistory, invertTransform, recordEdit, redoStep, sameLayout, undoStep, type LayoutSnapshot } from "./layoutHistory";
import { transformAnchor, type LayoutTransform } from "./layoutTransform";

const piece = (cropId: string, r: number, c: number, id = `${cropId}-${r}-${c}`) => ({ id, cropId, position: [r, c] as [number, number] });
const snap = (...inputs: ReturnType<typeof piece>[]): LayoutSnapshot<ReturnType<typeof piece>> => ({ inputs, targets: [], groundTiles: [] });

describe("designer undo / redo history", () => {
  const a = snap();
  const b = snap(piece("wheat", 0, 0));
  const c = snap(piece("wheat", 0, 0), piece("carrot", 1, 1));

  it("undoes and redoes edits in order", () => {
    let h = recordEdit(emptyHistory(), { snapshot: a });
    h = recordEdit(h, { snapshot: b });
    // current layout is c
    const u1 = undoStep(h, c)!;
    expect(u1.entry.snapshot).toBe(b);
    const u2 = undoStep(u1.history, b)!;
    expect(u2.entry.snapshot).toBe(a);
    expect(undoStep(u2.history, a)).toBeNull();
    const r1 = redoStep(u2.history, a)!;
    expect(r1.entry.snapshot).toBe(b);
    const r2 = redoStep(r1.history, b)!;
    expect(r2.entry.snapshot).toBe(c);
    expect(redoStep(r2.history, c)).toBeNull();
  });

  it("a new edit after undo drops the redo stack", () => {
    const h = recordEdit(emptyHistory(), { snapshot: a });
    const u = undoStep(h, b)!;
    expect(u.history.future).toHaveLength(1);
    const edited = recordEdit(u.history, { snapshot: a });
    expect(edited.future).toHaveLength(0);
  });

  it("keeps at most `limit` steps", () => {
    let h = emptyHistory<ReturnType<typeof piece>>();
    for (let i = 0; i < 10; i++) h = recordEdit(h, { snapshot: snap(piece("wheat", i, 0)) }, 3);
    expect(h.past).toHaveLength(3);
    expect(h.past[0].snapshot.inputs[0].position).toEqual([7, 0]);
  });

  it("carries a transform so undo can hand out its inverse", () => {
    const t: LayoutTransform = { kind: "nudge", dRow: 1, dCol: 0 };
    const h = recordEdit(emptyHistory(), { snapshot: a, transform: t });
    const u = undoStep(h, b)!;
    expect(u.entry.transform).toEqual(t);
    expect(redoStep(u.history, a)!.entry.transform).toEqual(t);
  });

  it("inverse transforms put every piece back", () => {
    const all: LayoutTransform[] = [
      { kind: "nudge", dRow: -1, dCol: 2 },
      { kind: "rotate", direction: "cw" },
      { kind: "rotate", direction: "ccw" },
      { kind: "mirror", axis: "horizontal" },
      { kind: "mirror", axis: "vertical" },
    ];
    for (const t of all) {
      for (const size of [1, 2, 3]) {
        const moved = transformAnchor([2, 3], size, t);
        expect(transformAnchor(moved, size, invertTransform(t))).toEqual([2, 3]);
      }
    }
  });

  it("a whole drag stroke is one undo step that restores the layout from before it", () => {
    const recorded: LayoutSnapshot<ReturnType<typeof piece>>[] = [];
    const rec = createEditRecorder<ReturnType<typeof piece>>((e) => recorded.push(e.snapshot));
    const start = snap(piece("wheat", 9, 9));
    let layout = start;
    // Paint 5 cells in one stroke (key 1), each edit building on the last.
    for (let i = 0; i < 5; i++) {
      const next = snap(...layout.inputs, piece("carrot", 0, i));
      rec.touch(1, layout);
      layout = next;
      rec.commit(layout);
    }
    expect(recorded).toEqual([start]);
    // Erase stroke (key 2) over 3 of them.
    const beforeErase = layout;
    for (let i = 0; i < 3; i++) {
      rec.touch(2, layout);
      layout = snap(...layout.inputs.filter((p) => !(p.cropId === "carrot" && p.position[1] === i)));
      rec.commit(layout);
    }
    expect(recorded).toEqual([start, beforeErase]);
  });

  it("a stroke that changed nothing records nothing; one-off edits each record", () => {
    const recorded: unknown[] = [];
    const rec = createEditRecorder((e) => recorded.push(e));
    rec.touch(1, a);
    rec.commit(a);
    rec.close(a);
    expect(recorded).toHaveLength(0);
    rec.touch(2, a);
    rec.commit(b);
    rec.touch(3, b);
    rec.commit(c);
    expect(recorded).toHaveLength(2);
  });

  it("compares layouts by what is where, not by ids or order", () => {
    expect(sameLayout(snap(piece("wheat", 0, 0, "x"), piece("carrot", 1, 1)), snap(piece("carrot", 1, 1), piece("wheat", 0, 0, "y")))).toBe(true);
    expect(sameLayout(b, c)).toBe(false);
    expect(sameLayout({ ...a, groundTiles: [{ ground: "sand", position: [0, 0] }] }, a)).toBe(false);
  });
});

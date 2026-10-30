import dagre from "@dagrejs/dagre";
import type { ScenarioPlot } from "../../../simulator";
import { exitTarget, snap } from "./model";

// Places steps that have no saved position. Left to right in flow order along the exit graph
// (dagre, back edges reversed), so a simple loop reads as a row and branches fan out. Steps that
// no exit reaches (entered by a script's plot.goto) are packed into a grid below the graph.

export const NODE_W = 280;
/** Estimated node height: header + body + one row per exit. Real heights only matter for wires. */
export const nodeHeight = (exits: number) => 172 + Math.max(1, exits) * 30;

const GAP_X = 110;
const GAP_Y = 60;

export interface Placed {
  x: number;
  y: number;
}

/** Positions for every step (index -> position). Saved positions are kept; the rest are laid out. */
export function autoLayout(plot: ScenarioPlot, opts: { all?: boolean } = {}): Placed[] {
  const steps = plot.flow.steps;
  const keep = (i: number) => !opts.all && typeof steps[i].ui?.x === "number" && typeof steps[i].ui?.y === "number";
  if (steps.every((_, i) => keep(i))) return steps.map((s) => ({ x: s.ui!.x, y: s.ui!.y }));
  if (steps.some((_, i) => keep(i))) return placeNew(plot, keep);
  return layoutAll(plot);
}

const overlaps = (a: Placed, b: Placed) => Math.abs(a.x - b.x) < NODE_W + 20 && Math.abs(a.y - b.y) < 160;

/** Some steps are placed (the user arranged them): put each new one beside a step that leads to it, without overlapping. */
function placeNew(plot: ScenarioPlot, keep: (i: number) => boolean): Placed[] {
  const steps = plot.flow.steps;
  const out: (Placed | null)[] = steps.map((s, i) => (keep(i) ? { x: s.ui!.x, y: s.ui!.y } : null));
  const placed = () => out.filter((p): p is Placed => p !== null);
  for (let i = 0; i < steps.length; i++) {
    if (out[i]) continue;
    // A placed step with an exit here, else the step before it in flow order, else the rightmost one.
    const from =
      steps.findIndex((s, k) => out[k] !== null && s.exits.some((e) => { const t = exitTarget(plot, k, e); return t.kind === "step" && t.index === i; })) ;
    const anchorIdx = from >= 0 ? from : i > 0 && out[i - 1] ? i - 1 : -1;
    const all = placed();
    const anchor = anchorIdx >= 0 ? out[anchorIdx]! : all.reduce((a, b) => (b.x > a.x ? b : a), all[0]);
    const cand = { x: snap(anchor.x + NODE_W + GAP_X), y: snap(anchor.y) };
    while (all.some((p) => overlaps(p, cand))) cand.y += nodeHeight(steps[i].exits.length) + GAP_Y;
    out[i] = cand;
  }
  return out as Placed[];
}

function layoutAll(plot: ScenarioPlot): Placed[] {
  const steps = plot.flow.steps;

  // Which steps are reached from the start through exits.
  const reach = new Set<number>([plot.flow.startIndex]);
  const queue = [plot.flow.startIndex];
  while (queue.length) {
    const i = queue.shift()!;
    steps[i].exits.forEach((e) => {
      const t = exitTarget(plot, i, e);
      if (t.kind === "step" && !reach.has(t.index)) {
        reach.add(t.index);
        queue.push(t.index);
      }
    });
  }

  // Small flows read best as one row in flow order (what people mean by "step 1, 2, 3"): back
  // edges route around the row. Bigger graphs use dagre, so branches fan out.
  if (reach.size <= SMALL_FLOW) return rowLayout(plot, reach);

  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: "LR", nodesep: GAP_Y, ranksep: GAP_X, marginx: 0, marginy: 0, acyclicer: "greedy", ranker: "network-simplex" });
  g.setDefaultEdgeLabel(() => ({}));
  for (const i of reach) g.setNode(String(i), { width: NODE_W, height: nodeHeight(steps[i].exits.length) });
  for (const i of reach) {
    steps[i].exits.forEach((e, j) => {
      const t = exitTarget(plot, i, e);
      if (t.kind !== "step" || t.index === i || !reach.has(t.index)) return;
      // Forward edges in flow order pull the layout into reading order; back edges are light.
      const forward = t.index > i;
      g.setEdge(String(i), String(t.index), { weight: forward ? 3 : 1, minlen: 1 }, `${i}:${j}`);
    });
  }
  dagre.layout(g);

  const out: Placed[] = steps.map(() => ({ x: 0, y: 0 }));
  let maxY = 0;
  let minX = Infinity;
  for (const i of reach) {
    const n = g.node(String(i));
    out[i] = { x: snap(n.x - NODE_W / 2), y: snap(n.y - n.height / 2) };
    maxY = Math.max(maxY, n.y + n.height / 2);
    minX = Math.min(minX, n.x - NODE_W / 2);
  }
  if (!Number.isFinite(minX)) minX = 0;

  // Unreached steps: a grid under the graph.
  placeUnreached(plot, reach, out, minX, reach.size ? maxY + GAP_Y * 2.5 : 0);
  return out;
}

const SMALL_FLOW = 8;

/**
 * Reached steps in reading order: one row up to 3 steps, else two rows (left to right, then the
 * next row), so a typical flow fits the canvas at a readable zoom. Unreached ones go below.
 */
function rowLayout(plot: ScenarioPlot, reach: Set<number>): Placed[] {
  const steps = plot.flow.steps;
  const out: Placed[] = steps.map(() => ({ x: 0, y: 0 }));
  const order = steps.map((_, i) => i).filter((i) => reach.has(i));
  const cols = order.length <= 3 ? order.length : Math.ceil(order.length / 2);
  let y = 0;
  for (let r = 0; r * cols < order.length; r++) {
    const line = order.slice(r * cols, r * cols + cols);
    line.forEach((i, c) => (out[i] = { x: c * (NODE_W + GAP_X), y }));
    // Room for the lanes back-edges take between the rows.
    y += Math.max(...line.map((i) => nodeHeight(steps[i].exits.length))) + GAP_Y * 1.6;
  }
  placeUnreached(plot, reach, out, 0, y + GAP_Y);
  return out;
}

/** Steps no exit reaches (a script enters them): a grid of ≤ 6 per row, in flow order, from (x0 + 160, y0). */
function placeUnreached(plot: ScenarioPlot, reach: Set<number>, out: Placed[], x0: number, y0: number): void {
  const steps = plot.flow.steps;
  const rest = steps.map((_, i) => i).filter((i) => !reach.has(i));
  const cols = Math.min(6, Math.max(3, Math.ceil(Math.sqrt(rest.length * 1.6))));
  let rowY = y0;
  for (let r = 0; r * cols < rest.length; r++) {
    const line = rest.slice(r * cols, r * cols + cols);
    const h = Math.max(...line.map((i) => nodeHeight(steps[i].exits.length)));
    line.forEach((i, c) => (out[i] = { x: snap(x0 + 160 + c * (NODE_W + GAP_X * 0.6)), y: snap(rowY) }));
    rowY += h + GAP_Y;
  }
}

/** The plot with positions filled in for every step that had none (or all, with `all`). */
export function withLayout(plot: ScenarioPlot, opts: { all?: boolean } = {}): ScenarioPlot {
  const pos = autoLayout(plot, opts);
  return {
    ...plot,
    flow: { ...plot.flow, steps: plot.flow.steps.map((s, i) => ({ ...s, ui: { ...(s.ui ?? {}), x: pos[i].x, y: pos[i].y } })) },
  };
}

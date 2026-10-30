import type { FlowStep, FlowUiColor, PolicyOverrides, ScenarioPlot, StepLayout } from "../../../simulator";
import { exitTarget } from "./model";
import { conditionSummary, exitKind, layoutFacts, stepLabel, targetName, type ExitKind } from "./shared";
import { NODE_W, nodeHeight } from "./autoLayout";
import { overrideCount } from "./InspectorFields";

// Pure data behind the flow canvas: node data, which wires are drawn, how they are routed and
// the frames around grouped steps. No React here, so it stays cheap to reason about.

// ---- Node data ------------------------------------------------------------------------------

export type ExitRowData = {
  kind: ExitKind;
  /** One-line condition summary. */
  text: string;
  /** "3", "Finish", "Missing". */
  to: string;
  /** Full target name for the tooltip. */
  toTitle: string;
};

export type StepNodeData = {
  index: number;
  label: string;
  isStart: boolean;
  /** Plot script attached and nothing leads here: plot.goto() enters it. */
  scripted: boolean;
  layout: StepLayout;
  targets: [string, number][];
  targetSlots: number;
  plants: number;
  kinds: number;
  /** Targets checked for uptime. */
  watched: number;
  fullClear: boolean;
  overrides: number;
  overridesTitle: string;
  note: string;
  rows: ExitRowData[];
  /** Exit row lit up: -1 none, -2 every row (selected step), else the row index. */
  hotRow: number;
  /** A highlighted wire ends here. */
  inHot: boolean;
  /** Incoming wires not drawn (busy flows): shown as an "N in" badge. */
  hiddenIn: number;
};

const POLICY_NAMES: Record<string, string> = {
  spawnedHarvest: "natural spawns",
  layoutInputSpawns: "spawned layout inputs",
  baseCropUpkeep: "base crops",
  watering: "watering",
  replaceDecayed: "re-place missing plants",
  fixGround: "fix target ground",
  clearTargetBlockers: "clear spawns off targets",
  placedUpkeep: "placed items",
  onlyReplaceForEmptyTargets: "re-place only for empty targets",
  wakeSnoozling: "wake Snoozlings",
  vacuumRat: "vacuum rats",
  dischargeThunderling: "discharge Thunderlings",
  noctilumeTime: "Noctilume time",
  feedFleshtrap: "feed Fleshtraps",
  clearRoots: "break Devourer roots",
};

/** Action overrides on a step: each policy key counts once, each gate interaction key once. */
export function overrideKeys(p: PolicyOverrides | undefined): string[] {
  if (!p) return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined) continue;
    if (k === "gateInteractions" && v && typeof v === "object") {
      for (const [g, gv] of Object.entries(v)) if (gv !== undefined) out.push(POLICY_NAMES[g] ?? g);
    } else out.push(POLICY_NAMES[k] ?? k);
  }
  return out;
}

export type StepNodeBase = Omit<StepNodeData, "hotRow" | "inHot" | "hiddenIn">;

/** Everything a node shows that depends only on the plot (cheap per-render extras are added later). */
export function stepNodeBase(plot: ScenarioPlot, i: number, scripted: boolean): StepNodeBase {
  const steps = plot.flow.steps;
  const s: FlowStep = steps[i];
  const facts = layoutFacts(s);
  const slots = facts.targets.reduce((n, [, c]) => n + c, 0);
  const ov = overrideKeys(s.policies);
  return {
    index: i,
    label: stepLabel(s),
    isStart: i === plot.flow.startIndex,
    layout: s.layout,
    targets: facts.targets,
    targetSlots: slots,
    plants: facts.plants,
    kinds: facts.kinds,
    watched: s.watch === undefined ? slots : Math.min(slots, s.watch.length),
    fullClear: !!s.fullClear,
    overrides: overrideCount(s.policies),
    overridesTitle: ov.length ? `Action overrides: ${ov.join(", ")}` : "",
    note: s.ui?.note ?? "",
    rows: s.exits.map((e) => {
      const t = exitTarget(plot, i, e);
      return {
        kind: exitKind(plot, i, e),
        text: conditionSummary(e.when, e.match, steps),
        to: t.kind === "step" ? String(t.index + 1) : t.kind === "finish" ? "Finish" : "Missing",
        toTitle: `Goes to ${targetName(plot, i, t)}`,
      };
    }),
    scripted,
  };
}

// ---- Geometry -------------------------------------------------------------------------------

export type Rect = { x: number; y: number; w: number; h: number };

export const rectOf = (pos: { x: number; y: number }, size: { width: number; height: number } | undefined, exits: number): Rect => ({
  x: pos.x,
  y: pos.y,
  w: size?.width || NODE_W,
  h: size?.height || nodeHeight(exits),
});

/**
 * How a wire is drawn:
 * - bezier: a forward wire with nothing in the way.
 * - lane: an orthogonal route with rounded corners along a horizontal lane above or below the
 *   nodes it would otherwise cross (back wires, and forward wires with nodes in between).
 * - self: a loop arcing over its own node.
 */
export type Route = { type: "bezier" } | { type: "self"; top: number } | { type: "lane"; y: number; k: number };

export type WireRef = { id: string; s: number; t: number; j: number; exits: number };

const LANE_GAP = 34;
const LANE_STEP = 14;
/** How far a lane's vertical legs sit outside its sockets (26 + 9 * 6), plus a margin. */
const LANE_REACH = 26 + 9 * 6 + 12;

export function routeWires(wires: WireRef[], rects: Rect[]): Map<string, Route> {
  const out = new Map<string, Route>();
  const lanes: { id: string; side: "above" | "below"; base: number; span: number; x0: number; x1: number }[] = [];
  const gapLanes: { id: string; key: string; lo: number; hi: number; span: number }[] = [];
  for (const w of wires) {
    const s = rects[w.s];
    const t = rects[w.t];
    if (!s || !t) continue;
    if (w.s === w.t) {
      out.set(w.id, { type: "self", top: s.y - 46 });
      continue;
    }
    // Approximate socket heights: exit rows sit at the bottom of the source, the input in the header.
    const sx = s.x + s.w;
    const sy = s.y + s.h - 18 - (w.exits - 1 - w.j) * 30 - 34;
    const tx = t.x;
    const ty = t.y + 22;
    const span = Math.abs(sx - tx);
    // Source and target in different rows: run through the gap between the rows when one is free.
    const x0 = Math.min(sx, tx) - LANE_REACH;
    const x1 = Math.max(sx, tx) + LANE_REACH;
    const gap = t.y > s.y + s.h ? freeGap(rects, x0, x1, s.y + s.h, t.y) : t.y + t.h < s.y ? freeGap(rects, x0, x1, t.y + t.h, s.y) : null;
    if (gap && (tx < sx - 20 || rects.some((r, k) => k !== w.s && k !== w.t && r.x < tx && r.x + r.w > sx))) {
      gapLanes.push({ id: w.id, key: `${Math.round(gap.lo)}:${Math.round(gap.hi)}`, lo: gap.lo, hi: gap.hi, span });
      continue;
    }
    if (tx < sx - 20) {
      // Back wire: run past every node in the columns it spans, above or below, whichever is shorter.
      // The lane runs from tx - 26 - 9k to sx + 26 + 9k: clear every node in that range.
      const spanned = rects.filter((r) => r.x + r.w > tx - LANE_REACH && r.x < sx + LANE_REACH);
      const below = Math.max(...spanned.map((r) => r.y + r.h)) + LANE_GAP;
      const above = Math.min(...spanned.map((r) => r.y)) - LANE_GAP;
      const side = (below - sy) + (below - ty) <= (sy - above) + (ty - above) ? "below" : "above";
      lanes.push({ id: w.id, side, base: side === "below" ? below : above, span, x0: tx - LANE_REACH, x1: sx + LANE_REACH });
      continue;
    }
    const lo = Math.min(sy, ty);
    const hi = Math.max(sy, ty);
    const between = rects.filter((r, k) => k !== w.s && k !== w.t && r.x > sx - 10 && r.x + r.w < tx + 10 && r.y < hi + 8 && r.y + r.h > lo - 8);
    if (!between.length) {
      out.set(w.id, { type: "bezier" });
      continue;
    }
    // Clear every node under the lane's whole x-range, not just the ones in the way.
    const group = rects.filter((r) => r.x + r.w > sx - LANE_REACH && r.x < tx + LANE_REACH);
    const above = Math.min(...group.map((r) => r.y)) - LANE_GAP;
    const below = Math.max(...group.map((r) => r.y + r.h)) + LANE_GAP;
    const side = (sy - above) + (ty - above) <= (below - sy) + (below - ty) ? "above" : "below";
    lanes.push({ id: w.id, side, base: side === "below" ? below : above, span, x0: Math.min(sx, tx) - LANE_REACH, x1: Math.max(sx, tx) + LANE_REACH });
  }
  // Short wires take the inner lanes, so lanes nest instead of crossing. A lane moves outward
  // until no lane overlapping it in x sits within LANE_STEP of it.
  const placed: { side: string; y: number; x0: number; x1: number }[] = [];
  for (const l of [...lanes].sort((a, b) => a.span - b.span)) {
    const offset = (k: number) => (l.side === "below" ? k : -k) * LANE_STEP;
    let k = 0;
    let y = l.base;
    while (k < 24 && placed.some((p) => p.side === l.side && p.x0 < l.x1 && l.x0 < p.x1 && Math.abs(p.y - y) < LANE_STEP)) {
      k++;
      y = l.base + offset(k);
    }
    placed.push({ side: l.side, y, x0: l.x0, x1: l.x1 });
    out.set(l.id, { type: "lane", y, k: placed.filter((p) => p.side === l.side && p.x0 < l.x1 && l.x0 < p.x1).length - 1 });
  }
  // Lanes sharing a gap between rows: spread evenly inside it (at most LANE_STEP apart), centred.
  const byGap = new Map<string, typeof gapLanes>();
  for (const g of gapLanes) byGap.set(g.key, [...(byGap.get(g.key) ?? []), g]);
  for (const list of byGap.values()) {
    list.sort((a, b) => a.span - b.span);
    const { lo, hi } = list[0];
    const step = Math.min(LANE_STEP, (hi - lo - 12) / Math.max(1, list.length - 1));
    const first = (lo + hi) / 2 - (step * (list.length - 1)) / 2;
    list.forEach((g, k) => out.set(g.id, { type: "lane", y: first + step * k, k }));
  }
  return out;
}

/**
 * The horizontal band between y0 and y1 that no node crosses within [x0, x1], if the
 * band is at least 30px tall (room for a few lanes); else null.
 */
function freeGap(rects: Rect[], x0: number, x1: number, y0: number, y1: number): { lo: number; hi: number } | null {
  // Shrink the band by every node that pokes into it within the x-range.
  let lo = y0;
  let hi = y1;
  for (const r of rects) {
    if (r.x + r.w <= x0 || r.x >= x1 || r.y >= hi || r.y + r.h <= lo) continue;
    // A node inside the band: keep the larger free part.
    if (r.y - lo >= hi - (r.y + r.h)) hi = r.y;
    else lo = r.y + r.h;
  }
  return hi - lo >= 30 ? { lo, hi } : null;
}

/** An orthogonal polyline with rounded corners. */
function rounded(pts: [number, number][], r: number): string {
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1];
    const [cx, cy] = pts[i];
    const [nx, ny] = pts[i + 1];
    const l1 = Math.hypot(cx - px, cy - py) || 1;
    const l2 = Math.hypot(nx - cx, ny - cy) || 1;
    const rr = Math.min(r, l1 / 2, l2 / 2);
    const ax = cx - ((cx - px) / l1) * rr;
    const ay = cy - ((cy - py) / l1) * rr;
    const bx = cx + ((nx - cx) / l2) * rr;
    const by = cy + ((ny - cy) / l2) * rr;
    d += ` L${ax},${ay} Q${cx},${cy} ${bx},${by}`;
  }
  const [lx, ly] = pts[pts.length - 1];
  return `${d} L${lx},${ly}`;
}

export type WirePath = { d: string; mid: { x: number; y: number }; angle: number };

const deg = (dx: number, dy: number) => (Math.atan2(dy, dx) * 180) / Math.PI;

/** The SVG path of a wire between two sockets, plus where its direction chevron goes. */
export function wirePath(route: Route, sx: number, sy: number, tx: number, ty: number): WirePath {
  if (route.type === "self") {
    const top = Math.min(route.top, sy - 40, ty - 40);
    const r = 70;
    const cx = (sx + tx) / 2;
    return {
      d: `M${sx},${sy} C${sx + r},${sy} ${sx + r},${top} ${cx + 40},${top} L${cx - 40},${top} C${tx - r},${top} ${tx - r},${ty} ${tx},${ty}`,
      mid: { x: cx, y: top },
      angle: 180,
    };
  }
  if (route.type === "lane") {
    const off = 26 + 9 * (route.k % 6);
    const ox = sx + off;
    const ix = tx - off;
    const ly = route.y;
    const d = rounded([[sx, sy], [ox, sy], [ox, ly], [ix, ly], [ix, ty], [tx, ty]], 12);
    if (Math.abs(ix - ox) > 40) return { d, mid: { x: (ox + ix) / 2, y: ly }, angle: ix < ox ? 180 : 0 };
    return { d, mid: { x: ox, y: (sy + ly) / 2 }, angle: ly > sy ? 90 : -90 };
  }
  const dx = Math.max(60, Math.abs(tx - sx) * 0.5);
  const p1x = sx + dx;
  const p2x = tx - dx;
  // Cubic bezier at t = 0.5 and its tangent.
  const mid = { x: (sx + 3 * p1x + 3 * p2x + tx) / 8, y: (sy + 3 * sy + 3 * ty + ty) / 8 };
  return { d: `M${sx},${sy} C${p1x},${sy} ${p2x},${ty} ${tx},${ty}`, mid, angle: deg(tx + p2x - p1x - sx, ty + ty - sy - sy) };
}

// ---- Frames ---------------------------------------------------------------------------------

export type FrameTone = FlowUiColor | "script";

export const FRAME_TONE: Record<FrameTone, { border: string; fill: string; text: string }> = {
  slate: { border: "rgba(148,163,184,0.32)", fill: "rgba(148,163,184,0.035)", text: "#cbd5e1" },
  emerald: { border: "rgba(52,211,153,0.32)", fill: "rgba(52,211,153,0.035)", text: "#6ee7b7" },
  sky: { border: "rgba(56,189,248,0.3)", fill: "rgba(56,189,248,0.035)", text: "#7dd3fc" },
  violet: { border: "rgba(167,139,250,0.32)", fill: "rgba(167,139,250,0.04)", text: "#c4b5fd" },
  amber: { border: "rgba(251,191,36,0.3)", fill: "rgba(251,191,36,0.03)", text: "#fcd34d" },
  rose: { border: "rgba(251,113,133,0.3)", fill: "rgba(251,113,133,0.035)", text: "#fda4af" },
  script: { border: "rgba(56,189,248,0.28)", fill: "rgba(56,189,248,0.03)", text: "#7dd3fc" },
};

export type FrameBox = {
  key: string;
  label: string;
  sub: string;
  tone: FrameTone;
  members: number[];
  x: number;
  y: number;
  w: number;
  h: number;
};

export const FRAME_PAD = 40;

/** Frames: steps sharing ui.frame, plus (with a plot script) the steps only plot.goto() enters. */
export function frameBoxes(steps: FlowStep[], rects: Rect[], scriptOnly: Set<number> | null): FrameBox[] {
  const groups = new Map<string, number[]>();
  steps.forEach((s, i) => {
    const f = s.ui?.frame?.trim();
    if (f) groups.set(f, [...(groups.get(f) ?? []), i]);
  });
  const box = (members: number[]) => {
    const rs = members.map((i) => rects[i]).filter(Boolean);
    const x0 = Math.min(...rs.map((r) => r.x)) - FRAME_PAD;
    const y0 = Math.min(...rs.map((r) => r.y)) - FRAME_PAD;
    const x1 = Math.max(...rs.map((r) => r.x + r.w)) + FRAME_PAD;
    const y1 = Math.max(...rs.map((r) => r.y + r.h)) + FRAME_PAD;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };
  const out: FrameBox[] = [];
  for (const [name, members] of groups) {
    out.push({ key: `f:${name}`, label: name, sub: "", tone: steps[members[0]].ui?.frameColor ?? "slate", members, ...box(members) });
  }
  if (scriptOnly) {
    const members = [...scriptOnly].filter((i) => !steps[i].ui?.frame?.trim()).sort((a, b) => a - b);
    if (members.length) {
      out.push({
        key: "script",
        label: "Entered by the plot script",
        sub: `plot.goto() picks one of ${members.length === 1 ? "this step" : `these ${members.length} steps`}`,
        tone: "script",
        members,
        ...box(members),
      });
    }
  }
  return out;
}

export const snap8 = (v: number) => Math.round(v / 8) * 8;

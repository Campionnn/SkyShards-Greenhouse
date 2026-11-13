// The Designer's target checks (research/designer-v2: "Check", was Mutation Status): one source for the
// rows in Check, the card of the target in view, the ring on the grid and the header facts. Hooks and
// types only (react-refresh: components live in MutationValidator.tsx and CheckRing.tsx).
import { useMemo, useState } from "react";
import { useDesigner, useGreenhouseData, type DesignerPlacement, type MutationValidationInfo } from "../../context";

/** "row 5, col 6": a placement's top-left cell, 1-based (the grid's tooltip says the same). */
export const at = (p: Pick<DesignerPlacement, "position">) => `row ${p.position[0] + 1}, col ${p.position[1] + 1}`;

export interface TargetCheck {
  target: DesignerPlacement;
  v: MutationValidationInfo;
  /** What an invalid target lacks, short: "4 missing", "2 effects missing", "not alone"; null when valid. */
  short: string | null;
}

/** Every target with its validation (getTargetValidation, the same as the grid's red outline). */
export function useTargetChecks(): TargetCheck[] {
  const { targetPlacements, getTargetValidation } = useDesigner();
  const { mutations } = useGreenhouseData();
  return useMemo(
    () =>
      targetPlacements.map((target) => {
        const v = getTargetValidation(target.id, mutations);
        let short: string | null = null;
        if (!v.isValid) {
          const crops = v.missingRequirements.reduce((n, r) => n + Math.max(0, r.needed - r.have), 0);
          const effects = v.effectRequirements.filter((r) => !r.satisfied).length;
          short = v.ringBlocked ? "not alone" : crops ? `${crops} missing` : effects ? `${effects} effect${effects === 1 ? "" : "s"} missing` : "invalid";
        }
        return { target, v, short };
      }),
    [targetPlacements, getTargetValidation, mutations],
  );
}

/** One row of Check: an invalid target on its own, or every valid target of one mutation (×N). */
export interface CheckRow {
  key: string;
  cropId: string;
  name: string;
  items: TargetCheck[];
  valid: boolean;
  short: string | null;
}

const cellIndex = (p: DesignerPlacement) => p.position[0] * 10 + p.position[1];

/** Invalid targets first (in grid order), then one row per valid mutation (most first). */
export function buildRows(checks: TargetCheck[]): CheckRow[] {
  const invalid = checks
    .filter((c) => !c.v.isValid)
    .sort((a, b) => cellIndex(a.target) - cellIndex(b.target))
    .map<CheckRow>((c) => ({ key: c.target.id, cropId: c.target.cropId, name: c.target.cropName, items: [c], valid: false, short: c.short }));
  const groups = new Map<string, CheckRow>();
  for (const c of checks) {
    if (!c.v.isValid) continue;
    const g = groups.get(c.target.cropId);
    if (g) g.items.push(c);
    else groups.set(c.target.cropId, { key: `valid:${c.target.cropId}`, cropId: c.target.cropId, name: c.target.cropName, items: [c], valid: true, short: null });
  }
  return [...invalid, ...[...groups.values()].sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name))];
}

/** The row picked in Check (pinned by a click) and the row under the pointer. */
export function useCheckFocus() {
  const [selected, setSelected] = useState<string | null>(null);
  const [rowHover, setRowHover] = useState<string | null>(null);
  return useMemo(() => ({ selected, setSelected, rowHover, setRowHover }), [selected, rowHover]);
}
export type CheckFocus = ReturnType<typeof useCheckFocus>;

export interface ActiveCheck {
  row: CheckRow | null;
  check: TargetCheck | null;
  /** The card shows a target hovered on the grid (not a list row). */
  fromGrid: boolean;
  /** Placements ringed on the grid: the row hovered or picked in the list. */
  ring: DesignerPlacement[];
}

/**
 * The target the card explains: one hovered on the grid first, then the row under the pointer, then the
 * picked row, then the first invalid target (a broken layout explains itself). With every target valid and
 * nothing hovered or picked there is no card.
 */
export function useActiveCheck(rows: CheckRow[], focus: CheckFocus): ActiveCheck {
  const { hoveredTargetId } = useDesigner();
  return useMemo(() => {
    const byKey = (k: string | null) => (k ? (rows.find((r) => r.key === k) ?? null) : null);
    const gridRow = hoveredTargetId ? (rows.find((r) => r.items.some((i) => i.target.id === hoveredTargetId)) ?? null) : null;
    const listRow = byKey(focus.rowHover) ?? byKey(focus.selected);
    const row = gridRow ?? listRow ?? rows.find((r) => !r.valid) ?? null;
    const check = gridRow ? (gridRow.items.find((i) => i.target.id === hoveredTargetId) ?? null) : (row?.items[0] ?? null);
    return { row, check, fromGrid: !!gridRow, ring: !gridRow && listRow ? listRow.items.map((i) => i.target) : [] };
  }, [rows, focus.rowHover, focus.selected, hoveredTargetId]);
}

/** Everything Check and the ring share. The page creates it once and passes it to both. */
export interface CheckState {
  checks: TargetCheck[];
  rows: CheckRow[];
  focus: CheckFocus;
  active: ActiveCheck;
}

export function useCheckState(): CheckState {
  const checks = useTargetChecks();
  const rows = useMemo(() => buildRows(checks), [checks]);
  const focus = useCheckFocus();
  const active = useActiveCheck(rows, focus);
  return useMemo(() => ({ checks, rows, focus, active }), [checks, rows, focus, active]);
}

import React, { useEffect, useRef } from "react";
import { CircleCheck, CircleX } from "lucide-react";
import { useDesigner, useGreenhouseData } from "../../context";
import { focusKey } from "../../hooks/usePlacementFocus";
import { CropImage, EffectChips } from "../shared";
import { InfoHint } from "../ui/InfoHint";
import { KitLabel } from "../ui/kit";
import { cn } from "../ui/cn";
import { at, useCheckState, type ActiveCheck, type CheckState, type TargetCheck } from "./checkModel";

// "Check" (was Mutation Status, research/designer-v2): "x of y targets valid", one row per invalid target
// ("4 missing") and per valid mutation (×N), and the detail of the target in view: name · row r, col c ·
// valid / invalid, the named Missing / Satisfied crops with have/need, effect chips for effect targets
// (Godseed), the Lonelily ring rule. A row finds its targets on the grid (hover previews, click pins); a
// target hovered on the grid lights its row and fills the detail. Used by the Designer (the left rail, the
// phone sheet) and the simulator flow editor's layout workspace.

const ItemIcon: React.FC<{ id: string; name: string; size: number }> = ({ id, name, size }) => (
  <CropImage cropId={id} cropName={name} size="custom" width={size} height={size} showFallback className="shrink-0" />
);

const Req: React.FC<{ id: string; have: number; needed: number; ok: boolean; recipe?: boolean }> = ({ id, have, needed, ok, recipe }) => {
  const { getCropDef, getMutationDef } = useGreenhouseData();
  const name = getCropDef(id)?.name || getMutationDef(id)?.name || id.replace(/_/g, " ");
  return (
    <li className="flex min-w-0 items-center gap-1.5 text-secondary" title={recipe ? `${needed} ${name} around each` : `${name}: ${have} of ${needed} around it`}>
      <ItemIcon id={id} name={name} size={16} />
      <span className="min-w-0 flex-1 truncate text-fg-body">{name}</span>
      <span className={cn("shrink-0 tabular-nums", ok ? "text-fg-muted" : "font-semibold text-problem")}>{recipe ? `×${needed}` : `${have}/${needed}`}</span>
    </li>
  );
};

/**
 * The detail under the rows (a divider and labels, not a card inside the host's card). Shown for a
 * hovered, pinned or invalid target only (useActiveCheck).
 */
const CheckDetail: React.FC<{ active: ActiveCheck; className?: string }> = ({ active, className }) => {
  const { row, check, fromGrid } = active;
  if (!row || !check) return null;
  const { target, v } = check;
  // A pinned group of valid ones: what each has around it, not the have/need of the first.
  const many = row.valid && row.items.length > 1 && !fromGrid;
  return (
    <div aria-live="polite" className={cn("min-w-0 space-y-2 border-t border-line pt-2", className)}>
      <div className="flex min-w-0 items-center gap-1.5">
        {/* The icon only where the column has room: at 1366 "row 5, col 6 · invalid" needs the whole width. */}
        <span className="shrink-0 @max-[11rem]/check:hidden">
          <ItemIcon id={target.cropId} name={target.cropName} size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-semibold text-fg" title={target.cropName}>
            {target.cropName}
          </p>
          <p className="truncate text-meta tabular-nums text-fg-meta">
            {many ? `×${row.items.length}` : at(target)} ·{" "}
            <span className={cn("font-semibold", v.isValid ? "text-go-fg" : "text-problem")}>{v.isValid ? (many ? "all valid" : "valid") : "invalid"}</span>
          </p>
        </div>
      </div>
      {/* Lonelily (D50): a neighbour stands in its ring. */}
      {v.ringBlocked && <p className="text-secondary text-problem">Needs every surrounding cell empty: something is placed next to it.</p>}
      {/* Effect targets (Godseed, D49). */}
      {v.effectRequirements.length > 0 && (
        <div className="space-y-1.5">
          <KitLabel>
            <span className="inline-flex items-center gap-1">
              Effects
              <InfoHint title="Effect targets" width={280}>
                The {target.size}×{target.size} spot must receive every effect below from neighbouring crops: side neighbours, or relayed by Effect Spread crops and mutations.
              </InfoHint>
            </span>
          </KitLabel>
          {v.effectRequirements.some((r) => !r.satisfied) && <EffectChips effects={v.effectRequirements.filter((r) => !r.satisfied).map((r) => r.effect)} variant="missing" />}
          {v.effectRequirements.some((r) => r.satisfied) && <EffectChips effects={v.effectRequirements.filter((r) => r.satisfied).map((r) => r.effect)} variant="satisfied" />}
        </div>
      )}
      {v.missingRequirements.length > 0 && (
        <div>
          <KitLabel className="mb-1">Missing</KitLabel>
          <ul className="space-y-1">
            {v.missingRequirements.map((r) => (
              <Req key={r.crop} id={r.crop} have={r.have} needed={r.needed} ok={false} />
            ))}
          </ul>
        </div>
      )}
      {v.satisfiedRequirements.length > 0 && (
        <div>
          <KitLabel className="mb-1">{many ? "Each has" : "Satisfied"}</KitLabel>
          <ul className="space-y-1">
            {v.satisfiedRequirements.map((r) => (
              <Req key={r.crop} id={r.crop} have={r.have} needed={r.needed} ok recipe={many} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

/** "x of y targets valid" with its ✓ / ✗. */
export const CheckCount: React.FC<{ checks: TargetCheck[]; className?: string }> = ({ checks, className }) => {
  const valid = checks.filter((c) => c.v.isValid).length;
  if (!checks.length) return <span className={cn("text-secondary text-fg-meta", className)}>No targets</span>;
  const ok = valid === checks.length;
  return (
    <span className={cn("inline-flex items-center gap-1 text-secondary tabular-nums", ok ? "text-fg-muted" : "text-problem", className)}>
      {ok ? <CircleCheck aria-hidden className="size-3.5 shrink-0 text-go-fg" /> : <CircleX aria-hidden className="size-3.5 shrink-0" />}
      {valid} of {checks.length} targets valid
    </span>
  );
};

interface MutationValidatorProps {
  className?: string;
  /** Shared with the grid's ring (CheckRing): the page creates it once with useCheckState. Without it, Check keeps its own. */
  check?: CheckState;
  /** Fill the parent's height: the rows scroll and the detail stays fully visible under them. */
  fill?: boolean;
  /** The "Check" title and its "?" (default). The phone sheet's tab already says it. */
  heading?: boolean;
  /** 44px rows (the phone sheet). */
  touch?: boolean;
}

/** Check. The export keeps its old name (MutationValidator), so the flow editor's workspace and old imports work. */
export const MutationValidator: React.FC<MutationValidatorProps> = ({ check, ...props }) => (check ? <CheckPanel state={check} {...props} /> : <OwnCheck {...props} />);

/** Without a shared state (the flow editor's workspace): its own. */
const OwnCheck: React.FC<Omit<MutationValidatorProps, "check">> = (props) => {
  const state = useCheckState();
  return <CheckPanel state={state} {...props} />;
};

const CheckPanel: React.FC<Omit<MutationValidatorProps, "check"> & { state: CheckState }> = ({ state, className, fill, heading = true, touch }) => {
  const { rows, checks, focus, active } = state;
  const { placementFocus, setMode } = useDesigner();
  const pinned = placementFocus.pinned;
  const { setSelected } = focus;
  // A pin ended elsewhere (Escape, a click outside the list): the pick goes with it.
  useEffect(() => {
    if (!pinned) setSelected(null);
  }, [pinned, setSelected]);
  // A target hovered on the grid scrolls its row into view.
  const listRef = useRef<HTMLUListElement>(null);
  const gridKey = active.fromGrid ? active.row?.key : null;
  useEffect(() => {
    if (!gridKey) return;
    listRef.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(gridKey)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [gridKey]);

  return (
    <section aria-label="Check" className={cn("@container/check flex min-w-0 flex-col", fill && "min-h-0", className)}>
      {heading && (
        <div className="mb-1 flex min-w-0 shrink-0 items-center gap-1.5">
          <h2 className="text-body font-semibold text-fg">Check</h2>
          <InfoHint title="Check" width={280}>
            A target is valid when the crops it needs stand on the 8 cells around it (effect targets need their effects). Hover a row to find it on the grid; click to keep it
            lit. Hover a target on the grid to see what it has and gives.
          </InfoHint>
        </div>
      )}
      {!checks.length ? (
        <div className="space-y-1">
          <p className="text-secondary text-fg-muted">No targets yet.</p>
          <p className="text-secondary text-fg-meta">
            Place a mutation in{" "}
            <button
              type="button"
              onClick={() => setMode("targets")}
              className="hit-area focus-ring cursor-pointer rounded-inner text-fg-body underline decoration-fg-meta underline-offset-[3px] hover:text-fg"
            >
              Targets
            </button>{" "}
            mode and Check says whether its crops are around it.
          </p>
        </div>
      ) : (
        <>
          <CheckCount checks={checks} className="mb-1.5 shrink-0" />
          <ul ref={listRef} aria-label="Targets" className={cn("scrollbar-dark -mx-1 space-y-px overflow-x-hidden overscroll-contain px-1", fill && "min-h-15 shrink overflow-y-auto")}>
            {rows.map((row) => {
              const key = focusKey("target", row.cropId);
              const ip = placementFocus.itemProps(key, row.name);
              const sel = focus.selected === row.key;
              const lit = active.row?.key === row.key && (active.fromGrid || focus.rowHover === row.key);
              const toggle = () => {
                if (sel) {
                  placementFocus.clear();
                  setSelected(null);
                } else {
                  if (placementFocus.pinned !== key) ip.onClick();
                  setSelected(row.key);
                }
              };
              const t = row.items[0].target;
              return (
                <li key={row.key} data-row={row.key}>
                  <div
                    {...ip}
                    aria-pressed={sel}
                    title={row.valid ? `${row.name} ×${row.items.length}, all valid: find on the grid` : `${row.name}, ${at(t)}: ${row.short}. Find on the grid`}
                    onClick={toggle}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggle();
                      }
                    }}
                    onPointerEnter={(e) => {
                      ip.onPointerEnter(e);
                      if (e.pointerType === "mouse") focus.setRowHover(row.key);
                    }}
                    onPointerLeave={(e) => {
                      ip.onPointerLeave(e);
                      if (e.pointerType === "mouse") focus.setRowHover((h) => (h === row.key ? null : h));
                    }}
                    className={cn(
                      // A 9.5rem column (1280) tightens the gaps so "Chocoberry 4 missing" keeps its whole name.
                      "focus-ring-inset flex h-7 min-w-0 cursor-pointer items-center gap-1 rounded-control pr-1 pl-0.5 text-secondary transition-colors duration-(--duration-hover) select-none pointer-coarse:h-11 @max-[9.5rem]/check:gap-0.5 @max-[9.5rem]/check:pr-0.5",
                      touch && "h-11",
                      sel ? "bg-select/10 ring-1 ring-select ring-inset" : lit ? "bg-surface-hover" : "hover:bg-surface-hover",
                    )}
                  >
                    {row.valid ? <CircleCheck aria-label="valid" className="size-3.5 shrink-0 text-go-fg" /> : <CircleX aria-label="invalid" className="size-3.5 shrink-0 text-problem" />}
                    {/* The crop icon only where the column has room for it next to "N missing". */}
                    <span className="shrink-0 @max-[11rem]/check:hidden">
                      <ItemIcon id={row.cropId} name={row.name} size={16} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-fg-body">{row.name}</span>
                    <span className={cn("shrink-0 text-meta tabular-nums", row.valid ? "text-fg-meta" : "text-problem")}>{row.valid ? `×${row.items.length}` : row.short}</span>
                  </div>
                </li>
              );
            })}
          </ul>
          {/* fill: the detail keeps its height (up to 75% of the panel); the rows above give way and scroll. */}
          <CheckDetail active={active} className={cn("mt-2", fill && "scrollbar-dark max-h-[75%] shrink-0 overflow-y-auto overscroll-contain")} />
        </>
      )}
    </section>
  );
};

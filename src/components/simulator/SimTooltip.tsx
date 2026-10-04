import React from "react";
import {
  aloeRow,
  decayStatus,
  DECAY_EXTENSION_HOURS,
  DEVOURER_ROOT_CHANCE,
  HALT_WATER,
  isDry,
  jellybeanMultiplier,
  MAX_WATER,
  ROOT_SPREAD_CHANCE,
  THUNDERLING_MAX_CHARGE,
  type MutationDef,
  type PlantState,
  type PlotState,
  type SanityCheckResult,
  type SimConfig,
  type SlotLabel,
  type WatchStatus,
} from "../../simulator";
import { effectiveEffects, effectsGivenBy, getCellPixelPosition, getEffectName, sortEffects } from "../../utilities";
import { getRarityTextColor } from "../../utilities/rarity";
import { CropImage, EffectChips } from "../shared";
import { formatCount, formatDuration, formatRemaining, kindData, nameOf, plantIconOf } from "./format";
import { closestBlocked, describeBlocker, formatChance, occupantName } from "./sanityFormat";

export type TooltipTarget =
  /** watchStatus: uptime status at the anchor, when on a checked target. check: Sanity Check of the hovered cell, while the toggle is on. */
  | { kind: "plant"; plant: PlantState; watchStatus?: WatchStatus; check?: SanityCheckResult }
  /** check: Sanity Check of the hovered cell (any cell of a multi-cell slot), while the toggle is on. */
  | { kind: "slot"; slot: SlotLabel; ineligibleCycles: number; watched?: boolean; watchStatus?: WatchStatus; check?: SanityCheckResult }
  | { kind: "missing"; item: string; row: number; col: number }
  /** Sanity Check on an empty (non-slot) cell: which mutations could spawn here. */
  | { kind: "check"; row: number; col: number; result: SanityCheckResult };

const WIDTH = 280;
const EST_HEIGHT = 300;
const CHECK_EST_HEIGHT = 380;
const PLANT_CHECK_EST_HEIGHT = 640;
const OFFSET = 8;

// ---- Sanity Check card (display only) ----

const CANT_SHOWN = 6;

/** `anchor`: top-left of the hovered multi-cell slot, when the checked cell is one of its covered cells. */
export const SanityCheckSection: React.FC<{ result: SanityCheckResult; anchor?: { row: number; col: number } }> = ({ result, anchor }) => {
  const { shown, more } = closestBlocked(result, CANT_SHOWN);
  return (
    <div className="space-y-2" data-testid="sanity-check">
      <div className="text-[11px] uppercase tracking-wide text-cyan-300/90">
        Sanity Check · row {result.row}, col {result.col}
      </div>
      {result.occupied && (
        <p className="text-amber-300">
          {occupantName(result.occupied)}
          {result.occupied.size > 1 ? ` (${result.occupied.size}x${result.occupied.size}, top-left at ${result.occupied.row}, ${result.occupied.col})` : ""} stands here.
          Showing what could spawn once the cell is free.
        </p>
      )}
      {!result.occupied && anchor && (result.row !== anchor.row || result.col !== anchor.col) && (
        <p className="text-slate-400">
          Checking this cell on its own ({result.row}, {result.col}), not the target&apos;s top-left ({anchor.row}, {anchor.col}). Only the top-left cell rolls for the slot&apos;s target.
        </p>
      )}
      <div>
        <div className="text-[11px] text-slate-500 mb-0.5">Can spawn here now (chance per roll)</div>
        {result.canSpawn.length === 0 ? (
          <p className="text-slate-400">Nothing.</p>
        ) : (
          <ul className="space-y-0.5">
            {result.canSpawn.map((e) => (
              <li key={e.mutationId} className="flex items-center justify-between gap-2 text-emerald-300">
                <span className="truncate">{nameOf(e.mutationId)}</span>
                <span className="tabular-nums text-slate-200">{formatChance(e.chance)}</span>
              </li>
            ))}
            <li className="text-[11px] text-slate-500">
              Anything spawns: {formatChance(result.anyChance)}
              {result.denominator > result.totalWeight ? " (the rest is a blank roll)" : ""}
            </li>
          </ul>
        )}
      </div>
      <div>
        <div className="text-[11px] text-slate-500 mb-0.5">Can&apos;t spawn here</div>
        {shown.length === 0 ? (
          <p className="text-slate-400">Nothing else is held back.</p>
        ) : (
          <ul className="space-y-0.5">
            {shown.map((e) => (
              <li key={e.mutationId} className="text-slate-400">
                <span className="text-slate-300">{nameOf(e.mutationId)}</span>: {e.blockers.length > 0 ? describeBlocker(e.blockers[0], e.mutationId) : ""}
                {e.blockers.length > 1 && <span className="text-slate-500"> (+{e.blockers.length - 1} more)</span>}
              </li>
            ))}
            {more > 0 && <li className="text-[11px] text-slate-500">+{more} more</li>}
          </ul>
        )}
      </div>
    </div>
  );
};

const Row: React.FC<{ label: string; children: React.ReactNode; tone?: string }> = ({ label, children, tone }) => (
  <>
    <span className="text-slate-500">{label}</span>
    <span className={tone ?? "text-slate-200"}>{children}</span>
  </>
);

function originLabel(p: PlantState): string {
  if (p.kindId === "devourer_root") return "Devourer root";
  if (p.isDeadPlant) return "Dead Plant";
  if (p.origin === "placed") return "Placed from inventory";
  if (p.origin === "spawned") return p.isRival ? "Natural spawn (rival)" : "Natural spawn";
  return "Planted crop";
}

function statusOf(p: PlantState, m: MutationDef | undefined): { text: string; tone: string } {
  if (p.kindId === "devourer_root") return { text: "Broken by the player next time they are online", tone: "text-amber-300" };
  if (p.isDeadPlant) return { text: "Cleared (dead_plant item) next time the player is online", tone: "text-slate-300" };
  if (isDry(p))
    return { text: "Dried out - halted until watered (no effects, doesn't count for mutations or unique crops)", tone: "text-red-300" };
  if (p.gate.asleep) return { text: "Asleep - the player wakes it when online", tone: "text-amber-300" };
  if (p.gate.ratAlive) return { text: "A rat is eating it - vacuumed when online", tone: "text-amber-300" };
  if (p.kindId === "thunderling" && (p.gate.charge ?? 0) >= THUNDERLING_MAX_CHARGE)
    return { text: "Overcharged - discharged when the player is online", tone: "text-amber-300" };
  if (p.kindId === "fleshtrap" && (p.gate.hunger ?? 0) <= 0) return { text: "Hungry - fed when the player is online", tone: "text-amber-300" };
  if (p.kindId === "noctilume" && p.origin === "spawned" && p.stage < p.readyStage)
    return { text: "Grows only while the player is online (they set the time)", tone: "text-slate-300" };
  if (p.origin === "placed") return { text: "Fully grown - an input and buff source; cannot be harvested", tone: "text-slate-300" };
  if (p.lockedEffects && p.stage >= p.readyStage) return { text: "Fully grown - ready to harvest", tone: "text-emerald-300" };
  if (m?.id === "all_in_aloe") return { text: "Growing - harvestable at any stage", tone: "text-slate-300" };
  if (m?.id === "magic_jellybean" && p.origin === "spawned")
    return {
      text: p.stage >= 12 ? "Growing - harvested at 120; drops its stuff if broken now" : "Growing - harvested at 120; drops nothing if broken before 12",
      tone: "text-slate-300",
    };
  return { text: "Growing", tone: "text-slate-300" };
}

export const SimTooltip: React.FC<{
  target: TooltipTarget;
  cellSize: number;
  gap: number;
  gridWidth: number;
  gridHeight: number;
  cycleSeconds: number;
  config: SimConfig;
  /** The plot the target stands on (a plant's minimum-mutation pool is per plot). */
  plot: PlotState;
}> = ({ target, cellSize, gap, gridWidth, gridHeight, cycleSeconds, config, plot }) => {
  const row = target.kind === "plant" ? target.plant.row : target.kind === "slot" ? target.slot.row : target.row;
  const col = target.kind === "plant" ? target.plant.col : target.kind === "slot" ? target.slot.col : target.col;
  const size = target.kind === "plant" ? target.plant.size : target.kind === "slot" ? target.slot.size : target.kind === "check" ? 1 : kindData(target.item)?.size ?? 1;
  const kindId = target.kind === "plant" ? target.plant.kindId : target.kind === "slot" ? target.slot.mutationId : target.kind === "check" ? "" : target.item;

  const { top, left } = getCellPixelPosition(row, col, cellSize, gap);
  const span = size * cellSize + (size - 1) * gap;
  let x = left + span + OFFSET;
  if (x + WIDTH > gridWidth) {
    x = left - OFFSET - WIDTH;
    if (x < 0) x = Math.max(0, gridWidth - WIDTH);
  }
  const hasCheck = target.kind === "check" || (target.kind === "slot" && !!target.check);
  const plantCheck = target.kind === "plant" && !!target.check;
  const y = Math.max(0, Math.min(top, gridHeight - (plantCheck ? PLANT_CHECK_EST_HEIGHT : hasCheck ? CHECK_EST_HEIGHT : EST_HEIGHT)));

  const def = kindData(kindId);
  const m: MutationDef | undefined = def?.kind === "mutation" ? def : undefined;
  const rarity = m?.rarity;

  return (
    <div
      className="absolute z-50 pointer-events-none bg-slate-900/95 border border-slate-600/60 rounded-lg shadow-xl p-3 backdrop-blur-sm text-xs"
      style={{ top: y, left: x, width: WIDTH }}
      role="tooltip"
    >
      <div className="flex items-center gap-2 mb-2">
        {kindId && <CropImage cropId={target.kind === "plant" ? plantIconOf(target.plant) : kindId} cropName={nameOf(kindId)} size="sm" showFallback />}
        <div className="min-w-0">
          <div className={`text-sm font-medium ${rarity ? getRarityTextColor(rarity) : "text-slate-100"}`}>
            {target.kind === "check" ? "Empty cell" : target.kind === "plant" && target.plant.isDeadPlant ? "Dead Plant" : nameOf(kindId)}
          </div>
          <div className="text-[11px] text-slate-500">
            ({row}, {col}){size > 1 ? ` · ${size}x${size}` : ""}
            {rarity ? ` · ${rarity}` : ""}
          </div>
        </div>
      </div>

      {target.kind === "slot" && (
        <div className="space-y-1.5">
          <p className="text-slate-300">
            Empty target cell. {nameOf(kindId)} is expected to spawn here; nothing is placed.
          </p>
          {m && m.requirements.length > 0 && (
            <p className="text-slate-400">
              Needs {m.requirements.map((r) => `${r.count}x ${nameOf(r.crop)}`).join(", ")} in the 8 surrounding cells.
            </p>
          )}
          {target.ineligibleCycles > 0 && (
            <p className="text-amber-300">Requirements not met for the last {target.ineligibleCycles} cycles.</p>
          )}
          {target.watched === false ? (
            <p className="text-slate-500">Not checked for sustainability (pick checked targets in the flow editor).</p>
          ) : (
            <p className={target.watchStatus === "requirements" ? "text-red-300" : "text-cyan-300"}>
              Checked for sustainability
              {target.watchStatus === "requirements"
                ? ": empty without its requirements, so it is losing uptime."
                : target.watchStatus === "blocked"
                  ? ": blocked by something else, so it is losing uptime."
                  : target.watchStatus === "halted"
                    ? ": its mutation is dried out (halted until watered), so it is losing uptime."
                    : target.watchStatus === "ready"
                    ? ": ready to spawn, counted as up."
                    : "."}
            </p>
          )}
        </div>
      )}

      {(target.kind === "check" || (target.kind === "slot" && target.check)) && (
        <div className={target.kind === "slot" ? "mt-2 pt-2 border-t border-slate-600/40" : ""}>
          <SanityCheckSection result={target.kind === "check" ? target.result : target.check!} anchor={target.kind === "slot" ? target.slot : undefined} />
        </div>
      )}

      {target.kind === "missing" && (
        <p className="text-red-300">
          Missing {nameOf(kindId)}: the layout needs one here but the inventory has none. The player retries each time they are online.
        </p>
      )}

      {target.kind === "plant" && <PlantDetails p={target.plant} m={m} cycleSeconds={cycleSeconds} config={config} plot={plot} />}
      {target.kind === "plant" && target.watchStatus === "halted" && (
        <p className="mt-2 text-amber-400">
          Checked target, dried out: this cell is losing uptime (halted) until the player waters it. That is downtime, not a sustainability failure.
        </p>
      )}
      {target.kind === "plant" && target.check && (
        <div className="mt-2 pt-2 border-t border-slate-600/40">
          <SanityCheckSection result={target.check} />
        </div>
      )}
    </div>
  );
};

/** "in 2d 4h (~13 cycles), then decays" / "..., then +24h (minimum not met)" / "never decays". */
function decayText(p: PlantState, met: boolean, cycles: number): string {
  if (p.decaySecondsRemaining === null) return "never decays";
  const timer = `in ${formatDuration(p.decaySecondsRemaining)} (~${cycles} cycles)`;
  if (met) return `${timer}, then decays`;
  const ext = `+${formatCount(DECAY_EXTENSION_HOURS)}h`;
  return p.mutatesRemaining === "infinite" ? `${timer}, then ${ext} - never decays (minimum ∞)` : `${timer}, then ${ext} (minimum not met)`;
}

/** All-in Aloe harvest stage: the fixed setting, or the stage auto picked at the last session (14 before any). */
const aloeTarget = (p: PlantState, config: SimConfig): number => (config.aloeAutoHarvest ? (p.gate.aloeHarvest?.stage ?? p.readyStage) : p.readyStage);

const PlantDetails: React.FC<{ p: PlantState; m: MutationDef | undefined; cycleSeconds: number; config: SimConfig; plot: PlotState }> = ({
  p,
  m,
  cycleSeconds,
  config,
  plot,
}) => {
  const status = statusOf(p, m);
  const growing = !p.isDeadPlant && p.origin !== "placed" && p.kindId !== "devourer_root";
  const effective = effectiveEffects(p.held);
  const cancelled = sortEffects(p.held.filter((e) => !effective.has(e)));
  const dry = isDry(p);
  // A dried-out plant gives no effects but still receives them, like a designer slot.
  const gives = p.isDeadPlant || p.kindId === "devourer_root" ? [] : effectsGivenBy(p.kindId, dry);
  const needsWater = p.origin === "planted" || !!m?.requiresWatering;
  const cycles = (s: number) => Math.max(0, Math.ceil(s / cycleSeconds - 1e-9));
  const isRootPlant = p.kindId === "devourer_root";
  // Minimum-mutation counters, the kind's pool on this plot, and whether an expiring timer would decay it.
  const decay = decayStatus(plot, p);
  const decayCycles = p.decaySecondsRemaining !== null ? cycles(p.decaySecondsRemaining) : Infinity;
  // Red only when it would actually decay, not when the timer would be extended.
  const decaysSoon = decay.minimumMet && decayCycles <= 2;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        <Row label="Type">{originLabel(p)}</Row>
        <Row label="Status" tone={status.tone}>
          {status.text}
        </Row>
        {growing && p.growthStages > 0 && (
          <Row label="Stage">
            {p.stage} / {p.kindId === "all_in_aloe" ? `${p.growthStages} (harvest at ${aloeTarget(p, config)})` : p.readyStage}
            <span className="block h-1 mt-0.5 bg-slate-700 rounded overflow-hidden">
              <span className="block h-full bg-emerald-400" style={{ width: `${Math.min(100, (p.stage / Math.max(1, p.kindId === "all_in_aloe" ? aloeTarget(p, config) : p.readyStage)) * 100)}%` }} />
            </span>
          </Row>
        )}
        {p.kindId === "soggybud" && p.origin === "spawned" ? (
          <Row label="Water">
            {Math.round(p.water)} (stage = water / {config.soggybudWaterPerStage}); drawn from wet neighbours, never watered
          </Row>
        ) : (
          growing && (
            <Row label="Water" tone={dry ? "text-red-300" : undefined}>
              {needsWater ? `${Math.round(p.water)} / ${MAX_WATER}${dry ? ` (halted at ${HALT_WATER} or below)` : ""}` : "does not need water"}
            </Row>
          )
        )}
        {!isRootPlant && (
          <>
            <Row label="Decay" tone={decaysSoon ? "text-red-300" : undefined}>
              {decayText(p, decay.minimumMet, decayCycles)}
            </Row>
            <Row label="Times mutated">{formatCount(decay.timesMutated)}</Row>
            <Row label="Mutates remaining">{decay.mutatesRemaining === null ? "none (timer only)" : formatRemaining(decay.mutatesRemaining)}</Row>
            {decay.mutatesRemaining !== null && (
              <Row label="Pool">
                {decay.pooled
                  ? `combined ${formatRemaining(decay.combined)} (pooled)`
                  : decay.timesMutated === 0
                    ? "not pooled - hasn't helped yet"
                    : "not pooled - still growing"}
              </Row>
            )}
          </>
        )}
        {p.kindId === "all_in_aloe" && p.origin === "spawned" && (
          <>
            <Row label="Harvest now">
              {aloeRow(p.stage).multiplier} fragments before yield (every 9 become 1 All-in Aloe)
            </Row>
            {p.stage < p.growthStages && (
              <Row label="Next stage">{Math.round(aloeRow(p.stage).resetChance * 100)}% chance to reset to 1</Row>
            )}
            {config.aloeAutoHarvest && (
              <Row label="Auto harvest">
                {p.gate.aloeHarvest
                  ? `stage ${p.gate.aloeHarvest.stage}: ${
                      p.gate.aloeHarvest.gapCycles < 0 ? "never online again" : `next online in ${p.gate.aloeHarvest.gapCycles} cycle${p.gate.aloeHarvest.gapCycles === 1 ? "" : "s"}`
                    }, ${formatChance(p.gate.aloeHarvest.respawnChance)} respawn chance per cycle`
                  : "picked at the next session from the time offline and the respawn chance"}
              </Row>
            )}
          </>
        )}
        {p.kindId === "magic_jellybean" && p.origin === "spawned" && (
          <Row label="Drops now">
            x{jellybeanMultiplier(p.stage)} jellybeans and crop bundle, before yield
          </Row>
        )}
        {p.kindId === "blastberry" && (
          <Row label="Explosion" tone={p.gate.primed ? "text-red-300" : undefined}>
            {p.gate.primed
              ? "primed - breaking it blows up the 8 cells around it"
              : p.origin === "spawned"
                ? "primes once fully grown"
                : "primes at the next tick"}
          </Row>
        )}
        {p.kindId === "turtlellini" && <Row label="Blasts taken">{p.gate.exploded ?? 0} / 2 (1 = cracked, 2 = Shellfruit)</Row>}
        {p.kindId === "thunderling" && p.gate.charge !== undefined && (
          <Row label="Charge" tone={p.gate.charge >= THUNDERLING_MAX_CHARGE ? "text-amber-300" : undefined}>
            {p.gate.charge.toLocaleString("en-US")} / {THUNDERLING_MAX_CHARGE.toLocaleString("en-US")}
          </Row>
        )}
        {p.kindId === "fleshtrap" && p.origin === "spawned" && <Row label="Hunger">{p.gate.hunger ?? 0}</Row>}
        {p.kindId === "devourer" && p.origin === "spawned" && (
          <Row label="Roots">{p.stage < p.growthStages ? `${Math.round(DEVOURER_ROOT_CHANCE * 100)}% per tick while growing` : "none (fully grown)"}</Row>
        )}
        {p.kindId === "chorus_fruit" && p.origin === "spawned" && (
          <Row label="Teleports">
            {p.stage < p.growthStages
              ? config.chorusOverflow && config.chorusTeleportTargets === "emptyOnly"
                ? "every tick while growing (overwrites a plant if no empty cell is left)"
                : "every tick while growing"
              : "no (fully grown)"}
          </Row>
        )}
        {p.kindId === "devourer_root" && <Row label="Spreads">{Math.round(ROOT_SPREAD_CHANCE * 100)}% per tick</Row>}
      </div>

      {!p.isDeadPlant && p.kindId !== "devourer_root" && (
        <>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-0.5">Has</div>
            <EffectChips effects={effective} variant="has" emptyText="nothing" />
            {cancelled.length > 0 && <div className="mt-1 text-[11px] text-slate-500">cancelled: {cancelled.map(getEffectName).join(", ")}</div>}
            {p.lockedEffects && growing && (
              <div className="mt-1 text-[11px] text-slate-500">
                Yield locked at full growth: {p.lockedEffects.length ? p.lockedEffects.map(getEffectName).join(", ") : "no effects"}
              </div>
            )}
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-0.5">Gives</div>
            <EffectChips effects={gives} variant="gives" emptyText={dry ? "nothing while dried out" : "nothing"} />
          </div>
        </>
      )}
    </div>
  );
};

import React from "react";
import { aloeRow, type MutationDef, type PlantState, type SimConfig, type SlotLabel } from "../../simulator";
import { effectiveEffects, effectsGivenBy, getCellPixelPosition, getEffectName, sortEffects } from "../../utilities";
import { getRarityTextColor } from "../../utilities/rarity";
import { CropImage, EffectChips } from "../shared";
import { formatDuration, kindData, nameOf } from "./format";

export type TooltipTarget =
  | { kind: "plant"; plant: PlantState }
  | { kind: "slot"; slot: SlotLabel; ineligibleCycles: number }
  | { kind: "missing"; item: string; row: number; col: number };

const WIDTH = 280;
const EST_HEIGHT = 300;
const OFFSET = 8;

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
  if (p.frozen) return { text: "Frozen until the player returns", tone: "text-sky-300" };
  if (p.gate.asleep) return { text: "Asleep - the player wakes it when online", tone: "text-amber-300" };
  if (p.gate.ratAlive) return { text: "A rat is eating it - vacuumed when online", tone: "text-amber-300" };
  if (p.kindId === "fleshtrap" && (p.gate.hunger ?? 0) <= 0) return { text: "Hungry - fed when the player is online", tone: "text-amber-300" };
  if (p.kindId === "noctilume" && p.origin === "spawned" && p.stage < p.readyStage)
    return { text: "Grows only while the player is online (they set the time)", tone: "text-slate-300" };
  if (p.origin === "placed") return { text: "Fully grown - an input and buff source; cannot be harvested", tone: "text-slate-300" };
  if (p.lockedEffects && p.stage >= p.readyStage) return { text: "Fully grown - ready to harvest", tone: "text-emerald-300" };
  if (m?.id === "all_in_aloe") return { text: "Growing - harvestable at any stage", tone: "text-slate-300" };
  return { text: "Growing", tone: "text-slate-300" };
}

export const SimTooltip: React.FC<{
  target: TooltipTarget;
  cellSize: number;
  gap: number;
  gridWidth: number;
  gridHeight: number;
  stageSeconds: number;
  config: SimConfig;
}> = ({ target, cellSize, gap, gridWidth, gridHeight, stageSeconds, config }) => {
  const row = target.kind === "plant" ? target.plant.row : target.kind === "slot" ? target.slot.row : target.row;
  const col = target.kind === "plant" ? target.plant.col : target.kind === "slot" ? target.slot.col : target.col;
  const size = target.kind === "plant" ? target.plant.size : target.kind === "slot" ? target.slot.size : kindData(target.item)?.size ?? 1;
  const kindId = target.kind === "plant" ? target.plant.kindId : target.kind === "slot" ? target.slot.mutationId : target.item;

  const { top, left } = getCellPixelPosition(row, col, cellSize, gap);
  const span = size * cellSize + (size - 1) * gap;
  let x = left + span + OFFSET;
  if (x + WIDTH > gridWidth) {
    x = left - OFFSET - WIDTH;
    if (x < 0) x = Math.max(0, gridWidth - WIDTH);
  }
  const y = Math.max(0, Math.min(top, gridHeight - EST_HEIGHT));

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
        <CropImage cropId={kindId} cropName={nameOf(kindId)} size="sm" showFallback />
        <div className="min-w-0">
          <div className={`text-sm font-medium ${rarity ? getRarityTextColor(rarity) : "text-slate-100"}`}>
            {target.kind === "plant" && target.plant.isDeadPlant ? "Dead Plant" : nameOf(kindId)}
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
        </div>
      )}

      {target.kind === "missing" && (
        <p className="text-red-300">
          Missing {nameOf(kindId)}: the layout needs one here but the inventory has none. The player retries each time they are online.
        </p>
      )}

      {target.kind === "plant" && <PlantDetails p={target.plant} m={m} stageSeconds={stageSeconds} config={config} />}
    </div>
  );
};

const PlantDetails: React.FC<{ p: PlantState; m: MutationDef | undefined; stageSeconds: number; config: SimConfig }> = ({
  p,
  m,
  stageSeconds,
  config,
}) => {
  const status = statusOf(p, m);
  const growing = !p.isDeadPlant && p.origin !== "placed" && p.kindId !== "devourer_root";
  const effective = effectiveEffects(p.held);
  const cancelled = sortEffects(p.held.filter((e) => !effective.has(e)));
  const gives = p.isDeadPlant || p.kindId === "devourer_root" ? [] : effectsGivenBy(p.kindId);
  const needsWater = p.origin === "planted" || !!m?.requiresWatering;
  const cycles = (s: number) => Math.max(0, Math.ceil(s / stageSeconds - 1e-9));

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        <Row label="Type">{originLabel(p)}</Row>
        <Row label="Status" tone={status.tone}>
          {status.text}
        </Row>
        {growing && p.growthStages > 0 && (
          <Row label="Stage">
            {p.stage} / {p.kindId === "all_in_aloe" ? `${p.growthStages} (harvest at ${p.readyStage})` : p.readyStage}
            <span className="block h-1 mt-0.5 bg-slate-700 rounded overflow-hidden">
              <span className="block h-full bg-emerald-400" style={{ width: `${Math.min(100, (p.stage / Math.max(1, p.readyStage)) * 100)}%` }} />
            </span>
          </Row>
        )}
        {p.kindId === "soggybud" && p.origin === "spawned" ? (
          <Row label="Water">
            {Math.round(p.water)} (stage = water / {config.soggybudWaterPerStage}); drawn from wet neighbours, never watered
          </Row>
        ) : (
          growing && <Row label="Water">{needsWater ? `${Math.round(p.water)} / ${config.maxWater}` : "does not need water"}</Row>
        )}
        {!p.isDeadPlant && p.kindId !== "devourer_root" && (
          <Row label="Decay" tone={p.decaySecondsRemaining !== null && cycles(p.decaySecondsRemaining) <= 2 ? "text-red-300" : undefined}>
            {p.decaySecondsRemaining !== null
              ? `in ${formatDuration(p.decaySecondsRemaining)} (~${cycles(p.decaySecondsRemaining)} cycles)`
              : "never decays"}
          </Row>
        )}
        {p.kindId === "all_in_aloe" && p.origin === "spawned" && (
          <>
            <Row label="Harvest now">
              {aloeRow(p.stage).multiplier} fragments before yield (every 9 become 1 All-in Aloe)
            </Row>
            {p.stage < p.growthStages && (
              <Row label="Next stage">{Math.round(aloeRow(p.stage + 1).resetChance * 100)}% chance to reset to 1</Row>
            )}
          </>
        )}
        {p.kindId === "magic_jellybean" && p.origin === "spawned" && (
          <Row label="Item drop">x{p.stage < 12 ? 0 : Math.min(config.magicJellybeanMultiplierCap, 1 + Math.floor((p.stage - 12) / 12))}</Row>
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
        {p.kindId === "turtlellini" && <Row label="Blasts taken">{p.gate.exploded ?? 0} / 2 (2 = Shellfruit)</Row>}
        {p.kindId === "fleshtrap" && p.origin === "spawned" && <Row label="Hunger">{p.gate.hunger ?? 0}</Row>}
        {p.kindId === "devourer" && p.origin === "spawned" && (
          <Row label="Roots">{p.stage < p.growthStages ? `${Math.round(config.devourerRootChance * 100)}% per tick while growing` : "none (fully grown)"}</Row>
        )}
        {p.kindId === "chorus_fruit" && p.origin === "spawned" && (
          <Row label="Teleports">{p.stage < p.growthStages ? "every tick while growing" : "no (fully grown)"}</Row>
        )}
        {p.kindId === "devourer_root" && <Row label="Spreads">{Math.round(config.rootSpreadChance * 100)}% per tick</Row>}
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
            <EffectChips effects={gives} variant="gives" emptyText="nothing" />
          </div>
        </>
      )}
    </div>
  );
};

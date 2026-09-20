import React from "react";
import { CropImage } from "./CropImage";
import { getEffectName, getEffectDescriptionText, isNegativeEffect, sortEffects } from "../../utilities";

export type EffectChipVariant = "has" | "gives" | "missing" | "satisfied";

interface EffectChipsProps {
  effects: Iterable<string>;
  variant?: EffectChipVariant;
  /** Optional per-effect counts (e.g. "12/14 spots") */
  counts?: Record<string, number>;
  total?: number;
  emptyText?: string;
  className?: string;
}

function chipClasses(effect: string, variant: EffectChipVariant): string {
  const negative = isNegativeEffect(effect);
  switch (variant) {
    case "missing":
      return "bg-rose-500/15 border-rose-500/40 text-rose-300";
    case "satisfied":
      return "bg-emerald-500/15 border-emerald-500/40 text-emerald-300";
    case "gives":
      return negative
        ? "bg-rose-500/10 border-rose-500/30 text-rose-300/80"
        : "bg-sky-500/10 border-sky-500/30 text-sky-200";
    case "has":
    default:
      return negative
        ? "bg-rose-500/15 border-rose-500/40 text-rose-300"
        : "bg-emerald-500/15 border-emerald-500/40 text-emerald-300";
  }
}

/** Compact effect badges with the in-game description as a tooltip. */
export const EffectChips: React.FC<EffectChipsProps> = ({
  effects,
  variant = "has",
  counts,
  total,
  emptyText = "none",
  className = "",
}) => {
  const list = sortEffects(effects);
  if (list.length === 0) {
    return <span className={`text-xs text-slate-500 ${className}`}>{emptyText}</span>;
  }
  return (
    <div className={`flex flex-wrap gap-1 ${className}`}>
      {list.map((effect) => {
        const count = counts?.[effect];
        const showCount = count !== undefined && total !== undefined && count < total;
        return (
          <span
            key={effect}
            title={getEffectDescriptionText(effect)}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] leading-tight ${chipClasses(effect, variant)}`}
          >
            {getEffectName(effect)}
            {showCount && <span className="opacity-70">{count}/{total}</span>}
          </span>
        );
      })}
    </div>
  );
};

interface PlantEffectsPanelProps {
  id: string;
  name: string;
  position?: [number, number];
  size?: number;
  has: Iterable<string>;
  gives: Iterable<string>;
  /** Effects held but cancelled/hidden for scoring (immunity, improved override) */
  suppressed?: Iterable<string>;
  className?: string;
}

/** "What this plant has / gives" summary for a hovered grid cell. */
export const PlantEffectsPanel: React.FC<PlantEffectsPanelProps> = ({
  id,
  name,
  position,
  size,
  has,
  gives,
  suppressed,
  className = "",
}) => {
  const suppressedList = suppressed ? sortEffects(suppressed) : [];
  return (
    <div className={`bg-slate-700/30 border border-slate-600/30 rounded-md px-3 py-2 ${className}`}>
      <div className="flex items-center gap-2 mb-1.5">
        <CropImage cropId={id} cropName={name} size="xs" showFallback={false} />
        <span className="text-sm text-slate-200">{name}</span>
        {position && (
          <span className="text-xs text-slate-500">
            ({position[0]}, {position[1]}){size && size > 1 ? ` ${size}x${size}` : ""}
          </span>
        )}
      </div>
      <div className="grid grid-cols-[52px_1fr] gap-x-2 gap-y-1 items-start">
        <span className="text-xs text-slate-400 pt-0.5">Has</span>
        <div>
          <EffectChips effects={has} variant="has" />
          {suppressedList.length > 0 && (
            <div className="mt-1 text-[11px] text-slate-500">
              cancelled: {suppressedList.map(getEffectName).join(", ")}
            </div>
          )}
        </div>
        <span className="text-xs text-slate-400 pt-0.5">Gives</span>
        <EffectChips effects={gives} variant="gives" />
      </div>
    </div>
  );
};

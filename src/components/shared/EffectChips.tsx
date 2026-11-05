import React from "react";
import { CropImage } from "./CropImage";
import { getEffectName, getEffectDescriptionText, isNegativeEffect, sortEffects } from "../../utilities";
import { cn } from "../ui/cn";

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
      return "bg-problem/10 border-problem/40 text-problem";
    case "satisfied":
      return "bg-go/10 border-go/40 text-go-fg";
    case "gives":
      return negative ? "bg-problem/10 border-problem/30 text-problem" : "bg-surface-control border-line-strong text-fg-body";
    case "has":
    default:
      return negative ? "bg-problem/10 border-problem/40 text-problem" : "bg-go/10 border-go/40 text-go-fg";
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
    return <span className={cn("text-secondary text-fg-meta", className)}>{emptyText}</span>;
  }
  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {list.map((effect) => {
        const count = counts?.[effect];
        const showCount = count !== undefined && total !== undefined && count < total;
        return (
          <span
            key={effect}
            title={getEffectDescriptionText(effect)}
            className={cn("inline-flex items-center gap-1 rounded-inner border px-1.5 py-px text-meta", chipClasses(effect, variant))}
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
    <div className={cn("rounded-control border border-line bg-surface-well px-3 py-2", className)}>
      <div className="flex items-center gap-2 mb-1.5">
        <CropImage cropId={id} cropName={name} size="xs" showFallback={false} />
        <span className="text-body text-fg">{name}</span>
        {position && (
          <span className="text-secondary text-fg-meta">
            ({position[0]}, {position[1]}){size && size > 1 ? ` ${size}x${size}` : ""}
          </span>
        )}
      </div>
      <div className="grid grid-cols-[52px_1fr] gap-x-2 gap-y-1 items-start">
        <span className="pt-0.5 text-secondary text-fg-muted">Has</span>
        <div>
          <EffectChips effects={has} variant="has" />
          {suppressedList.length > 0 && (
            <div className="mt-1 text-meta text-fg-meta">
              cancelled: {suppressedList.map(getEffectName).join(", ")}
            </div>
          )}
        </div>
        <span className="pt-0.5 text-secondary text-fg-muted">Gives</span>
        <EffectChips effects={gives} variant="gives" />
      </div>
    </div>
  );
};

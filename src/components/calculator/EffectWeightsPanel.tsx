import React, { useMemo, useState, useCallback } from "react";
import { ChevronDown, Minus, Plus, X } from "lucide-react";
import { useGreenhouseData } from "../../context";
import { cn } from "../ui/cn";
import { InfoHint } from "../ui/InfoHint";
import { LinkButton } from "../ui/Card";
import { IconButton, KitInput } from "../ui/kit";
import {
  EFFECT_IDS,
  getEffectName,
  getEffectDescriptionText,
  isNegativeEffect,
} from "../../utilities";
const STEP = 0.1;
const LIMIT = 100;

function formatWeight(value: number): string {
  if (value === 0) return "";
  return String(Math.round(value * 100) / 100);
}

function parseWeight(raw: string): number | null {
  const text = raw.trim().replace(",", ".");
  if (text === "" || text === "-" || text === "." || text === "-." || text === "+") return 0;
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(text)) return null;
  const value = parseFloat(text);
  if (!Number.isFinite(value)) return null;
  return Math.max(-LIMIT, Math.min(LIMIT, Math.round(value * 100) / 100));
}

/**
 * Per-effect solver weights, as a fraction of one mutation spot: 0.3 on Harvest Boost makes a spot
 * holding it count as 1.3 spots. Negative effects get negative weights; 0 is ignored.
 *
 * Text inputs keep a per-field draft so partial entries ("-", "0.") survive typing; the weight
 * updates once the text parses and is tidied on blur. Arrow keys step 0.1 (Shift: 1).
 */
export const EffectWeightsPanel: React.FC = () => {
  const {
    effectWeights,
    setEffectWeight,
    resetEffectWeights,
    effectWeightsAreDefault,
  } = useGreenhouseData();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [cacheWarningDismissed, setCacheWarningDismissed] = useState(false);

  const activeCount = useMemo(
    () => Object.values(effectWeights).filter((v) => v !== 0).length,
    [effectWeights]
  );


  const handleChange = useCallback((effectId: string, raw: string) => {
    setDrafts((prev) => ({ ...prev, [effectId]: raw }));
    const parsed = parseWeight(raw);
    if (parsed !== null) setEffectWeight(effectId, parsed);
  }, [setEffectWeight]);

  const handleBlur = useCallback((effectId: string) => {
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[effectId];
      return next;
    });
  }, []);

  const nudge = useCallback((effectId: string, delta: number) => {
    const current = effectWeights[effectId] ?? 0;
    const next = Math.round((current + delta) * 100) / 100;
    setEffectWeight(effectId, Math.max(-LIMIT, Math.min(LIMIT, next)));
    setDrafts((prev) => {
      const copy = { ...prev };
      delete copy[effectId];
      return copy;
    });
  }, [effectWeights, setEffectWeight]);

  const handleKeyDown = useCallback((effectId: string, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      nudge(effectId, e.shiftKey ? 1 : STEP);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      nudge(effectId, e.shiftKey ? -1 : -STEP);
    } else if (e.key === "Enter") {
      (e.target as HTMLInputElement).blur();
    }
  }, [nudge]);

  const handleReset = useCallback(() => {
    resetEffectWeights();
    setDrafts({});
  }, [resetEffectWeights]);


  return (
    <details className="group/ew" open={activeCount > 0 || undefined}>
      <summary className="focus-ring flex min-h-8 cursor-pointer list-none items-center gap-1.5 rounded-inner text-body text-fg-body pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          Effect weights
          <InfoHint title="Effect weights">
            How much each effect on a spawned target is worth, in mutation spots: 0.3 makes a spot with that effect count as 1.3 spots. Use negatives for unwanted effects.
            Arrow keys step 0.1 (Shift: 1).
          </InfoHint>
        </span>
        <span className="text-secondary tabular-nums text-fg-meta">{activeCount > 0 ? `${activeCount} set` : "none"}</span>
        <ChevronDown aria-hidden className="size-3.5 text-fg-meta transition-transform duration-(--duration-ink) group-open/ew:rotate-180" />
      </summary>
      <div className="space-y-2 pt-1">
        {/* Dismissible cache warning (per session). The server only caches solves with the default
            weights, so any other weighting starts from scratch. */}
        {!effectWeightsAreDefault && !cacheWarningDismissed && (
          <div className="flex items-start gap-1.5 text-secondary text-warn" role="note">
            <span className="flex-1">Changed weights skip the solver cache, so solves can take longer.</span>
            <IconButton size="sm" aria-label="Dismiss" onClick={() => setCacheWarningDismissed(true)}>
              <X />
            </IconButton>
          </div>
        )}
        <ul className="space-y-0.5">
          {EFFECT_IDS.map((effectId) => {
            const negative = isNegativeEffect(effectId);
            const value = effectWeights[effectId] ?? 0;
            const draft = drafts[effectId];
            const shown = draft !== undefined ? draft : formatWeight(value);
            const invalid = draft !== undefined && parseWeight(draft) === null;
            return (
              // A div row, not a <label>: a wrapping label would bind clicks on the row to the first
              // button ("-"). Only the name is a label, pointing at the input.
              <li key={effectId} className="flex min-w-0 items-center gap-1" title={getEffectDescriptionText(effectId)}>
                <label htmlFor={`effect-weight-${effectId}`} className={cn("flex min-w-0 flex-1 cursor-text items-center self-stretch text-secondary", negative ? "text-problem" : value !== 0 ? "text-fg" : "text-fg-muted")}>
                  <span className="truncate">{getEffectName(effectId)}</span>
                </label>
                <IconButton size="sm" tabIndex={-1} aria-label={`Decrease ${getEffectName(effectId)} weight`} title="Decrease by 0.1" onClick={() => nudge(effectId, -STEP)}>
                  <Minus />
                </IconButton>
                <KitInput
                  id={`effect-weight-${effectId}`}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  spellCheck={false}
                  value={shown}
                  placeholder="0"
                  onChange={(e) => handleChange(effectId, e.target.value)}
                  onBlur={() => handleBlur(effectId)}
                  onKeyDown={(e) => handleKeyDown(effectId, e)}
                  onFocus={(e) => e.target.select()}
                  aria-label={`${getEffectName(effectId)} weight`}
                  invalid={invalid}
                  className="h-7 w-14 text-right tabular-nums"
                />
                <IconButton size="sm" tabIndex={-1} aria-label={`Increase ${getEffectName(effectId)} weight`} title="Increase by 0.1" onClick={() => nudge(effectId, STEP)}>
                  <Plus />
                </IconButton>
              </li>
            );
          })}
        </ul>
        {!effectWeightsAreDefault && (
          <LinkButton className="text-meta" onClick={handleReset} title="Reset effect weights to defaults">
            Reset weights
          </LinkButton>
        )}
      </div>
    </details>
  );
};
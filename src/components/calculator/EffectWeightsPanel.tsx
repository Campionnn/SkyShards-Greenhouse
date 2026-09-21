import React, { useMemo, useState, useCallback } from "react";
import { Sparkles, RotateCcw, ChevronDown, ChevronUp, Minus, Plus } from "lucide-react";
import { useGreenhouseData } from "../../context";
import { Panel } from "../ui";
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
 * Per-effect weights for the solver. A weight is worth that fraction of one
 * plain mutation spot: 0.3 on Harvest Boost means "a spot whose mutation
 * holds Harvest Boost counts as 1.3 spots". Negative effects get negative
 * weights. Anything left at 0 is ignored.
 *
 * Inputs are plain text fields with a per-field draft, so partial entries
 * like "-", "0." or "-0.2" survive while typing; the stored weight only
 * updates once the text parses, and the field is tidied on blur. Arrow keys
 * step by 0.1 (Shift: 1).
 */
export const EffectWeightsPanel: React.FC = () => {
  const { effectWeights, setEffectWeight, resetEffectWeights, weightsOverridden, canOverrideWeights, setKeepWeights } =
    useGreenhouseData();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [collapsed, setCollapsed] = useState(() => Object.values(effectWeights).every((v) => v === 0));

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
    <Panel
      title="Effect Weights"
      icon={<Sparkles />}
      actions={
        <>
          {activeCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              {activeCount} active
            </span>
          )}
          {activeCount > 0 && (
            <button
              onClick={handleReset}
              className="p-1 hover:bg-slate-600/50 rounded text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
              title="Reset all effect weights to 0"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="p-1 hover:bg-slate-600/50 rounded text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
            title={collapsed ? "Show effect weights" : "Hide effect weights"}
            aria-expanded={!collapsed}
          >
            {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
        </>
      }
      description={
        collapsed
          ? undefined
          : "How much each effect on a spawned target is worth, in mutation spots: 0.3 makes a spot with that effect count as 1.3 spots. Use negatives for unwanted effects."
      }
    >
      {!collapsed && (
        <>
          {canOverrideWeights && (
            <div className="mb-2 px-2 py-1.5 rounded bg-amber-500/10 border border-amber-500/30">
              <p className="text-[11px] text-amber-200/90">
                {weightsOverridden
                  ? "Gloomgourd alone: solving for spawn rate, weights below set aside."
                  : "Gloomgourd alone: using your weights instead of solving for spawn rate."}
              </p>
              <button
                onClick={() => setKeepWeights(weightsOverridden)}
                className="mt-1 text-[11px] underline text-amber-300 hover:text-amber-200 cursor-pointer"
              >
                {weightsOverridden ? "Use my weights" : "Solve for spawn rate"}
              </button>
            </div>
          )}
          <div className="grid grid-cols-1 gap-y-0.5">
            {EFFECT_IDS.map((effectId) => {
              const negative = isNegativeEffect(effectId);
              const value = effectWeights[effectId] ?? 0;
              const draft = drafts[effectId];
              const shown = draft !== undefined ? draft : formatWeight(value);
              const invalid = draft !== undefined && parseWeight(draft) === null;
              const borderClass = invalid
                ? "border-amber-500/60 focus:border-amber-400"
                : value > 0
                  ? "border-emerald-500/40 focus:border-emerald-500/70"
                  : value < 0
                    ? "border-rose-500/40 focus:border-rose-500/70"
                    : "border-slate-600/30 focus:border-blue-500/50";
              return (
                // A div, not a <label>: a label wrapping the buttons would bind to
                // the first button (clicks and hover on the row would hit "-").
                // Only the name is a label, pointing at the input.
                <div
                  key={effectId}
                  className={`flex items-center gap-1.5 rounded px-1.5 py-0.5 min-w-0 ${
                    value !== 0 ? "bg-slate-700/40" : ""
                  }`}
                  title={getEffectDescriptionText(effectId)}
                >
                  <label
                    htmlFor={`effect-weight-${effectId}`}
                    className={`flex-1 min-w-0 self-stretch flex items-center text-xs cursor-text ${negative ? "text-rose-300/90" : "text-slate-300"}`}
                  >
                    <span className="truncate">{getEffectName(effectId)}</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => nudge(effectId, -STEP)}
                    className="p-0.5 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-600/50 cursor-pointer flex-shrink-0"
                    title="Decrease by 0.1"
                    aria-label={`Decrease ${getEffectName(effectId)} weight`}
                    tabIndex={-1}
                  >
                    <Minus className="w-3 h-3" />
                  </button>
                  <input
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
                    aria-invalid={invalid || undefined}
                    className={`w-14 px-1.5 py-0.5 bg-slate-700/50 border rounded text-xs text-right text-slate-200 placeholder-slate-500 focus:outline-none ${borderClass}`}
                  />
                  <button
                    type="button"
                    onClick={() => nudge(effectId, STEP)}
                    className="p-0.5 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-600/50 cursor-pointer flex-shrink-0"
                    title="Increase by 0.1"
                    aria-label={`Increase ${getEffectName(effectId)} weight`}
                    tabIndex={-1}
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Panel>
  );
};

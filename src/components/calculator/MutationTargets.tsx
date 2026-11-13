/**
 * Targets (C08): the mutations to solve for. Each row: the mutation, what it needs, Count (an exact
 * number, 1–100) or Max (as many as fit), and remove. "Add a mutation" type-ahead underneath.
 */
import React, { useMemo, useState, useEffect } from "react";
import { AlertTriangle, Minus, Plus, X } from "lucide-react";
import { useGreenhouseData } from "../../context";
import { MutationAutocomplete } from "./MutationAutocomplete";
import { CropImage } from "../shared";
import { cn } from "../ui/cn";
import { InfoHint } from "../ui/InfoHint";
import { LinkButton } from "../ui/Card";
import { IconButton, KitInput, KitLabel, Segmented } from "../ui/kit";
import { getRarityTextColor, getEffectName } from "../../utilities";
import { requirementPlants } from "../../utilities/requirementLayout";
import type { MutationDefinition } from "../../types/greenhouse";

const Note: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="flex items-start gap-1.5 text-secondary text-warn" role="note">
    <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
    <span>{children}</span>
  </p>
);

export const MutationTargets: React.FC<{ className?: string }> = ({ className }) => {
  const { mutations, selectedMutations, addMutation, removeMutation, updateMutationMode, updateMutationTargetCount, isLoading, getCropDef, getMutationDef } = useGreenhouseData();

  const [inputValues, setInputValues] = useState<Record<string, string>>({});

  // Keep the count drafts in step with selectedMutations; empty or "0" drafts are left mid-edit.
  useEffect(() => {
    setInputValues((prev) => {
      const next = { ...prev };
      let changed = false;
      selectedMutations.forEach((mutation) => {
        if (mutation.mode === "target") {
          const draft = prev[mutation.id];
          const n = draft ? parseInt(draft) : undefined;
          if (draft === undefined || draft === null) {
            if (mutation.targetCount !== 1) {
              next[mutation.id] = mutation.targetCount.toString();
              changed = true;
            }
          } else if (draft === "" || draft === "0") {
            // Mid-edit: leave the draft alone.
          } else if (!isNaN(n!) && n !== mutation.targetCount) {
            next[mutation.id] = mutation.targetCount.toString();
            changed = true;
          }
        }
      });
      Object.keys(prev).forEach((id) => {
        const mutation = selectedMutations.find((m) => m.id === id);
        if (!mutation || mutation.mode !== "target") {
          delete next[id];
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [selectedMutations]);

  const availableMutations = mutations.filter((m) => !selectedMutations.some((s) => s.id === m.id));
  const hasMultipleMaximize = useMemo(() => selectedMutations.filter((m) => m.mode === "maximize").length > 1, [selectedMutations]);
  // Mutations whose special rules the solver doesn't model.
  const hasSpecialRuleMutations = useMemo(() => selectedMutations.some((m) => ["shellfruit", "jerryflower"].includes(m.id.toLowerCase())), [selectedMutations]);

  const handleCountChange = (id: string, value: string) => {
    setInputValues((prev) => ({ ...prev, [id]: value }));
    if (value === "") return;
    const n = parseInt(value);
    if (!isNaN(n) && n >= 1 && n <= 100) updateMutationTargetCount(id, n);
  };
  /** Blur / Enter: clamp the draft to 1–100 and show what the solver will use; blank or junk reverts. */
  const commitCount = (id: string, current: number) => {
    const n = parseInt(inputValues[id] ?? "", 10);
    const next = Number.isNaN(n) ? current : Math.min(100, Math.max(1, n));
    setInputValues((prev) => ({ ...prev, [id]: next.toString() }));
    if (next !== current) updateMutationTargetCount(id, next);
  };
  const step = (id: string, current: number, delta: number) => {
    const n = Math.min(100, Math.max(1, current + delta));
    setInputValues((prev) => ({ ...prev, [id]: n.toString() }));
    updateMutationTargetCount(id, n);
  };

  return (
    <section className={cn("space-y-2", className)} aria-label="Targets" aria-busy={isLoading || undefined}>
      <KitLabel
        actions={
          selectedMutations.length > 0 ? (
            <LinkButton className="text-meta" onClick={() => selectedMutations.forEach((m) => removeMutation(m.id))} title="Remove every target">
              Clear
            </LinkButton>
          ) : (
            <InfoHint title="Targets">Pick the mutations to solve for: Max fits as many as it can, Count asks for an exact number.</InfoHint>
          )
        }
      >
        Targets
      </KitLabel>

      {isLoading ? (
        <p className="text-secondary text-fg-meta">Loading mutations…</p>
      ) : (
        <ul className="space-y-2">
          {selectedMutations.map((selected) => {
            const mutation = mutations.find((m) => m.id === selected.id);
            const needs =
              mutation && mutation.special === "all_positive_crop_effects" ? (
                <>All effects: {mutation.positive_buffs.map((e) => getEffectName(e)).join(", ")}</>
              ) : mutation ? (
                mutation.requirements.map((r, i, all) => {
                  const reqMutation = getMutationDef(r.crop);
                  const name = getCropDef(r.crop)?.name || reqMutation?.name || r.crop.replace(/_/g, " ");
                  const plants = requirementPlants((id) => getCropDef(id)?.size ?? getMutationDef(id)?.size ?? 1, mutation.size, all)[r.crop] ?? r.count;
                  return (
                    <span key={r.crop} title={plants !== r.count ? `${plants} ${name} covering ${r.count} of the cells around it` : undefined}>
                      {i > 0 && ", "}
                      <span className={reqMutation ? getRarityTextColor(reqMutation.rarity) : undefined}>
                        {plants}× {name}
                      </span>
                    </span>
                  );
                })
              ) : null;
            return (
              <li key={selected.id} className="space-y-1">
                <div className="flex min-w-0 items-center gap-2">
                  <CropImage cropId={selected.id} cropName={selected.name} size="xs" showFallback={false} />
                  <span className={cn("min-w-0 flex-1 truncate text-body", mutation ? getRarityTextColor(mutation.rarity) : "text-fg-body")}>{selected.name}</span>
                  <IconButton aria-label={`Remove ${selected.name}`} title="Remove target" onClick={() => removeMutation(selected.id)}>
                    <X />
                  </IconButton>
                </div>
                <p className="truncate pl-6 text-meta text-fg-meta">{needs}</p>
                <div className="flex min-w-0 items-center gap-2 pl-6">
                  <Segmented
                    label={`${selected.name} goal`}
                    value={selected.mode}
                    onChange={(mode) => updateMutationMode(selected.id, mode)}
                    options={[
                      { value: "maximize", label: "Max", title: "As many as fit" },
                      { value: "target", label: "Count", title: "An exact number" },
                    ]}
                  />
                  {selected.mode === "target" && (
                    <span className="ml-auto flex shrink-0 items-center gap-0.5">
                      <IconButton aria-label={`One fewer ${selected.name}`} size="sm" onClick={() => step(selected.id, selected.targetCount, -1)}>
                        <Minus />
                      </IconButton>
                      <KitInput
                        type="text"
                        inputMode="numeric"
                        aria-label={`${selected.name} count`}
                        value={inputValues[selected.id] ?? ""}
                        placeholder="1"
                        onChange={(e) => handleCountChange(selected.id, e.target.value.replace(/[^0-9]/g, ""))}
                        onBlur={() => commitCount(selected.id, selected.targetCount)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            commitCount(selected.id, selected.targetCount);
                          } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                            e.preventDefault();
                            step(selected.id, selected.targetCount, e.key === "ArrowUp" ? 1 : -1);
                          }
                        }}
                        className="h-7 w-11 text-center tabular-nums"
                      />
                      <IconButton aria-label={`One more ${selected.name}`} size="sm" onClick={() => step(selected.id, selected.targetCount, 1)}>
                        <Plus />
                      </IconButton>
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {hasMultipleMaximize && <Note>More than one Max: the solver favours whichever fits most, without balancing them.</Note>}
      {hasSpecialRuleMutations && <Note>Shellfruit and Jerryflower spawn under special conditions the solver doesn't model, so they can't be solved for.</Note>}
      {selectedMutations.some((m) => m.id === "godseed") && (
        <p className="text-secondary text-fg-muted">Godseed needs an empty 3×3 that gets all six of its positive effects from the crops around it (directly or through Effect Spread).</p>
      )}

      {!isLoading && availableMutations.length > 0 && (
        <MutationAutocomplete
          mutations={mutations}
          excludeIds={selectedMutations.map((m) => m.id)}
          onSelect={(mutation: MutationDefinition) => addMutation(mutation.id, mutation.name)}
          placeholder="Add a mutation"
        />
      )}
    </section>
  );
};
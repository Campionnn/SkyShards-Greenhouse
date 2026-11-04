/* eslint-disable react-refresh/only-export-components -- the field tables are shared with the flow editor's Actions tab */
import React from "react";
import type { Policies } from "../../simulator";
import { CheckboxField, SelectField } from "./controls";

// What the player does while online: the scenario defaults editor plus the field tables the flow
// editor's Actions tab (flowgraph/ActionsTab.tsx) builds its overrides from.

export type PolicySelectKey = "spawnedHarvest" | "layoutInputSpawns" | "baseCropUpkeep" | "placedUpkeep" | "watering";

export const POLICY_FIELDS: {
  key: PolicySelectKey;
  label: string;
  title?: string;
  options: { value: string; label: string }[];
}[] = [
  {
    key: "spawnedHarvest",
    label: "Natural spawns",
    options: [
      { value: "whenFullyGrown", label: "harvest when fully grown" },
      { value: "beforeDecay", label: "harvest right before decay" },
      { value: "never", label: "never harvest" },
    ],
  },
  {
    key: "layoutInputSpawns",
    label: "Spawns used as layout inputs (hybrid)",
    options: [
      { value: "keep", label: "keep while the layout uses them" },
      { value: "harvest", label: "harvest like any other spawn" },
    ],
  },
  {
    key: "baseCropUpkeep",
    label: "Base crops",
    options: [
      { value: "leaveUntilDecay", label: "leave until decay" },
      { value: "harvestWhenGrown", label: "harvest + replant when grown" },
      { value: "harvestBeforeDecay", label: "harvest + replant before decay" },
    ],
  },
  {
    key: "placedUpkeep",
    label: "Placed mutations",
    title:
      "Placed layout items (mutations, not fire). Replacing before decay swaps one that would decay before your next session for a fresh one from inventory, so its neighbours never lose it. Only when it is in stock: otherwise it decays and is re-placed as usual.",
    options: [
      { value: "leaveUntilDecay", label: "leave until decay" },
      { value: "replaceBeforeDecay", label: "replace right before decay" },
    ],
  },
  {
    key: "watering",
    label: "Watering",
    options: [
      { value: "toMax", label: "water to full" },
      { value: "never", label: "never water" },
    ],
  },
];

export const GATE_FIELDS: { key: keyof Policies["gateInteractions"]; label: string }[] = [
  { key: "wakeSnoozling", label: "Wake Snoozling" },
  { key: "vacuumRat", label: "Vacuum Cheesebite rats" },
  { key: "dischargeThunderling", label: "Discharge Thunderlings" },
  { key: "noctilumeTime", label: "Change time for Noctilume" },
  { key: "feedFleshtrap", label: "Feed Fleshtrap" },
  { key: "clearRoots", label: "Break Devourer roots" },
];

export const ONLY_FOR_EMPTY_TARGETS_HELP =
  "A placed mutation next to a target that needs it (e.g. the Zombud and Puffercloud around a Devourer) is only re-placed while at least one target it feeds is empty. While the targets hold their mutation, lost inputs are left missing (so Devourer roots don't keep eating replacements) and rebuilt once a target is free again. Inputs that feed no target are always re-placed.";

export const FIX_GROUND_HELP = "Swap a target cell's ground back to what its mutation needs (e.g. End Stone left by Chorus Fruit).";

export const CLEAR_TARGET_BLOCKERS_HELP =
  "Break natural spawns of a different kind standing on a target cell (harvest them if fully grown), e.g. leftovers from the previous step.";

/** Full policies (scenario defaults). */
export const PolicyDefaultsEditor: React.FC<{ value: Policies; onChange: (p: Policies) => void }> = ({ value, onChange }) => (
  <div className="space-y-2">
    <p className="text-[11px] text-slate-500">What the player does while online. Plots and steps can override these.</p>
    {POLICY_FIELDS.map((f) => (
      <SelectField
        key={f.key}
        label={f.label}
        title={f.title}
        value={(value[f.key] as string | undefined) ?? f.options[0].value}
        options={f.options}
        onChange={(v) => onChange({ ...value, [f.key]: v } as Policies)}
      />
    ))}
    <CheckboxField label="Clear dead plants and re-place what the layout is missing" checked={value.replaceDecayed} onChange={(v) => onChange({ ...value, replaceDecayed: v })} />
    <CheckboxField label="Fix wrong ground blocks under empty targets" title={FIX_GROUND_HELP} checked={value.fixGround !== false} onChange={(v) => onChange({ ...value, fixGround: v })} />
    <CheckboxField
      label="Clear other spawns off target cells"
      title={CLEAR_TARGET_BLOCKERS_HELP}
      checked={value.clearTargetBlockers !== false}
      onChange={(v) => onChange({ ...value, clearTargetBlockers: v })}
    />
    <CheckboxField
      label="Only re-place requirement inputs while a target they feed is empty"
      title={ONLY_FOR_EMPTY_TARGETS_HELP}
      checked={value.onlyReplaceForEmptyTargets === true}
      onChange={(v) => onChange({ ...value, onlyReplaceForEmptyTargets: v })}
    />
    {GATE_FIELDS.map((g) => (
      <CheckboxField
        key={g.key}
        label={g.label}
        checked={value.gateInteractions[g.key]}
        onChange={(v) => onChange({ ...value, gateInteractions: { ...value.gateInteractions, [g.key]: v } })}
      />
    ))}
  </div>
);

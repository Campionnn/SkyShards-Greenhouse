import React, { useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Copy, ExternalLink, Link2, Plus, Trash2, X } from "lucide-react";
import { DesignerProvider } from "../../context";
import { useFitCellSize } from "../../hooks";
import type { FlowStage, Policies, PolicyOverrides, Scenario, ScenarioPlot, StageLayout, Trigger } from "../../simulator";
import { extractLayoutCode } from "../../utilities";
import { CropSelectionPalette, DesignerGrid, MutationValidator } from "../designer";
import { Panel, SectionLabel, useToast } from "../ui";
import { CheckboxField, IdSelect, SelectField } from "./controls";
import { ALL_KIND_IDS, ALL_MUTATION_IDS, allItemIds, describeTrigger } from "./format";
import {
  blankStage,
  defaultTrigger,
  layoutCode,
  layoutSummary,
  layoutToPlacements,
  placementsToCode,
  TRIGGER_KINDS,
  updatePlot,
  updateStage,
} from "./scenarioEdit";
import { buttonClass, inputClass } from "./styles";

// ---- Embedded layout editor ------------------------------------------------

/**
 * The Designer's own grid and palette, mounted on a private, non-persisted
 * DesignerProvider so editing a stage never touches the Designer page's saved
 * layout. Lowercase inputs are planted; targets are EMPTY labelled cells.
 */
const StageLayoutEditor: React.FC<{ layout: StageLayout; onChange: (layout: StageLayout) => void }> = ({ layout, onChange }) => {
  const { toast } = useToast();
  const [version, setVersion] = useState(0);
  const [importText, setImportText] = useState("");
  const fitRef = useRef<HTMLDivElement>(null);
  const { cellSize, gap } = useFitCellSize(fitRef, { max: 52 });
  const code = layoutCode(layout);
  // Re-read the layout only when the editor is (re)mounted, not on every keystroke it produced.
  const initial = useMemo(() => layoutToPlacements(layout), [version]); // eslint-disable-line react-hooks/exhaustive-deps

  const importLink = () => {
    try {
      const next = extractLayoutCode(importText);
      layoutToPlacements({ code: next }); // throws on a bad code
      onChange({ code: next });
      setImportText("");
      setVersion((v) => v + 1);
    } catch (err) {
      toast({ title: "Could not read that link", description: err instanceof Error ? err.message : String(err), variant: "error" });
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className={`${inputClass} flex-1 min-w-[200px]`}
          placeholder="Paste a share link or code to replace this layout"
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
        />
        <button className={buttonClass.neutral} onClick={importLink} disabled={!importText.trim()}>
          <Link2 className="w-3.5 h-3.5" /> Import
        </button>
        <button
          className={buttonClass.neutral}
          onClick={() => {
            navigator.clipboard.writeText(code);
            toast({ title: "Layout code copied", variant: "success", duration: 2000 });
          }}
        >
          <Copy className="w-3.5 h-3.5" /> Copy code
        </button>
        <a className={buttonClass.neutral} href={`/designer?layout=${code}`} target="_blank" rel="noopener noreferrer" title="Open in the Designer (new tab)">
          <ExternalLink className="w-3.5 h-3.5" /> Designer
        </a>
      </div>
      <DesignerProvider
        key={version}
        persist={false}
        initialPlacements={initial}
        onChange={(inputs, targets, groundTiles) => onChange({ code: placementsToCode(inputs, targets, groundTiles) })}
      >
        {/* Same arrangement as the Designer page: palette | grid | validation. */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] 2xl:grid-cols-[300px_minmax(0,1fr)_300px] gap-4 lg:items-start">
          <div className="order-2 lg:col-start-2 lg:row-start-1 2xl:col-start-1 bg-slate-900/40 border border-slate-600/30 rounded-lg p-3 max-h-[640px] overflow-y-auto scrollbar-dark">
            <CropSelectionPalette />
          </div>
          <div className="order-1 lg:col-start-1 lg:row-start-1 lg:row-span-2 2xl:col-start-2 2xl:row-span-1 min-w-0 bg-slate-900/40 border border-slate-600/30 rounded-lg p-3">
            <div ref={fitRef} className="w-full flex flex-col items-center">
              <DesignerGrid cellSize={cellSize} gap={gap} showTargets />
            </div>
          </div>
          <div className="order-3 lg:col-start-2 lg:row-start-2 2xl:col-start-3 2xl:row-start-1 bg-slate-900/40 border border-slate-600/30 rounded-lg p-3">
            <MutationValidator />
          </div>
        </div>
      </DesignerProvider>
    </div>
  );
};

// ---- Triggers --------------------------------------------------------------

const TriggerRow: React.FC<{ trigger: Trigger; onChange: (t: Trigger) => void; onRemove: () => void }> = ({ trigger, onChange, onRemove }) => (
  <div className="flex flex-wrap items-center gap-1.5">
    <select className={inputClass} value={trigger.kind} onChange={(e) => onChange(defaultTrigger(e.target.value as Trigger["kind"]))}>
      {TRIGGER_KINDS.map((k) => (
        <option key={k.value} value={k.value}>
          {k.label}
        </option>
      ))}
    </select>
    {trigger.kind === "cycles" && (
      <input type="number" min={1} className={`${inputClass} w-20`} value={trigger.n} onChange={(e) => onChange({ ...trigger, n: Math.max(1, e.target.valueAsNumber || 1) })} />
    )}
    {(trigger.kind === "inventoryAtLeast" || trigger.kind === "inventoryBelow") && (
      <>
        <IdSelect value={trigger.item} ids={allItemIds()} onChange={(item) => onChange({ ...trigger, item })} />
        <input type="number" min={0} className={`${inputClass} w-20`} value={trigger.qty} onChange={(e) => onChange({ ...trigger, qty: Math.max(0, e.target.valueAsNumber || 0) })} />
      </>
    )}
    {(trigger.kind === "mutationSpawned" || trigger.kind === "fullyGrown") && (
      <IdSelect value={trigger.mutationId} ids={ALL_MUTATION_IDS} onChange={(mutationId) => onChange({ ...trigger, mutationId })} />
    )}
    {trigger.kind === "mutationSpawned" && (
      <input type="number" min={1} className={`${inputClass} w-16`} value={trigger.count} onChange={(e) => onChange({ ...trigger, count: Math.max(1, e.target.valueAsNumber || 1) })} />
    )}
    {trigger.kind === "plantDecayed" && <IdSelect value={trigger.kindId} ids={ALL_KIND_IDS} onChange={(kindId) => onChange({ ...trigger, kindId })} />}
    {trigger.kind === "decayImminent" && (
      <>
        <input type="number" min={0} className={`${inputClass} w-16`} value={trigger.withinCycles} onChange={(e) => onChange({ ...trigger, withinCycles: Math.max(0, e.target.valueAsNumber || 0) })} />
        <span className="text-xs text-slate-500">cycles</span>
      </>
    )}
    <button className={buttonClass.icon} onClick={onRemove} title="Remove trigger">
      <X className="w-3.5 h-3.5" />
    </button>
  </div>
);

export const TriggerEditor: React.FC<{ exit: Trigger[]; onChange: (exit: Trigger[]) => void }> = ({ exit, onChange }) => (
  <div className="space-y-1.5">
    {exit.length === 0 && <p className="text-xs text-slate-500">No exit triggers: the plot stays on this stage.</p>}
    {exit.map((t, i) => (
      <TriggerRow
        key={i}
        trigger={t}
        onChange={(next) => onChange(exit.map((x, j) => (j === i ? next : x)))}
        onRemove={() => onChange(exit.filter((_, j) => j !== i))}
      />
    ))}
    <button className={buttonClass.neutral} onClick={() => onChange([...exit, defaultTrigger("cycles")])}>
      <Plus className="w-3.5 h-3.5" /> Add trigger
    </button>
    {exit.length > 1 && <p className="text-[11px] text-slate-500">Leaves the stage when ALL hold: {exit.map(describeTrigger).join(" and ")}.</p>}
  </div>
);

// ---- Policies --------------------------------------------------------------

const INHERIT = "inherit";

const POLICY_FIELDS: { key: "spawnedHarvest" | "baseCropUpkeep" | "watering"; label: string; options: { value: string; label: string }[] }[] = [
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
    key: "baseCropUpkeep",
    label: "Base crops",
    options: [
      { value: "leaveUntilDecay", label: "leave until decay" },
      { value: "harvestWhenGrown", label: "harvest + replant when grown" },
      { value: "harvestBeforeDecay", label: "harvest + replant before decay" },
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

const GATE_FIELDS: { key: keyof Policies["gateInteractions"]; label: string }[] = [
  { key: "wakeSnoozling", label: "Wake Snoozling" },
  { key: "vacuumRat", label: "Vacuum Cheesebite rats" },
  { key: "noctilumeTime", label: "Change time for Noctilume" },
  { key: "feedFleshtrap", label: "Feed Fleshtrap" },
  { key: "clearRoots", label: "Break Devourer roots" },
];

/** Full policies (scenario defaults). */
export const PolicyDefaultsEditor: React.FC<{ value: Policies; onChange: (p: Policies) => void }> = ({ value, onChange }) => (
  <div className="space-y-2">
    <p className="text-[11px] text-slate-500">What the player does while online. Plots and stages can override these.</p>
    {POLICY_FIELDS.map((f) => (
      <SelectField
        key={f.key}
        label={f.label}
        value={value[f.key] as string}
        options={f.options}
        onChange={(v) => onChange({ ...value, [f.key]: v } as Policies)}
      />
    ))}
    <CheckboxField label="Clear dead plants and re-place what the layout is missing" checked={value.replaceDecayed} onChange={(v) => onChange({ ...value, replaceDecayed: v })} />
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

/** Partial policies (plot / stage overrides): each field inherits unless set. */
const PolicyOverridesEditor: React.FC<{ value: PolicyOverrides | undefined; onChange: (p: PolicyOverrides | undefined) => void }> = ({ value, onChange }) => {
  const v = value ?? {};
  const set = (next: PolicyOverrides) => onChange(Object.keys(next).length ? next : undefined);
  return (
    <div className="space-y-1.5">
      {POLICY_FIELDS.map((f) => (
        <SelectField
          key={f.key}
          label={f.label}
          value={(v[f.key] as string | undefined) ?? INHERIT}
          options={[{ value: INHERIT, label: "inherit" }, ...f.options]}
          onChange={(choice) => {
            const next = { ...v } as Record<string, unknown>;
            if (choice === INHERIT) delete next[f.key];
            else next[f.key] = choice;
            set(next as PolicyOverrides);
          }}
        />
      ))}
      <SelectField
        label="Re-place missing plants"
        value={v.replaceDecayed === undefined ? INHERIT : v.replaceDecayed ? "yes" : "no"}
        options={[
          { value: INHERIT, label: "inherit" },
          { value: "yes", label: "yes" },
          { value: "no", label: "no" },
        ]}
        onChange={(choice) => {
          const next = { ...v };
          if (choice === INHERIT) delete next.replaceDecayed;
          else next.replaceDecayed = choice === "yes";
          set(next);
        }}
      />
    </div>
  );
};

// ---- Rotation editor -------------------------------------------------------

export const RotationEditor: React.FC<{
  scenario: Scenario;
  plotId: number;
  onChange: (sc: Scenario) => void;
  onClose: () => void;
}> = ({ scenario, plotId, onChange, onClose }) => {
  const plot = scenario.plots.find((p) => p.id === plotId);
  const [selected, setSelected] = useState(0);
  if (!plot) return null;
  const { stages } = plot.flow;
  const index = Math.min(selected, stages.length - 1);
  const stage = stages[index];

  const editPlot = (fn: (p: ScenarioPlot) => ScenarioPlot) => onChange(updatePlot(scenario, plotId, fn));
  const editStage = (fn: (s: FlowStage) => FlowStage) => onChange(updateStage(scenario, plotId, index, fn));
  const move = (from: number, to: number) =>
    editPlot((p) => {
      const [s] = p.flow.stages.splice(from, 1);
      p.flow.stages.splice(to, 0, s);
      p.flow.startIndex = Math.min(p.flow.startIndex, p.flow.stages.length - 1);
      return p;
    });

  return (
    <Panel
      title={`Plot ${plotId} rotation`}
      actions={
        <button className={buttonClass.primary} onClick={onClose}>
          Done
        </button>
      }
      description="This plot's own stage sequence. It runs on the shared clock and shared inventory; no stage can reference another plot."
    >
      <div className="grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)] gap-6">
        <div className="space-y-3">
          <SectionLabel>Stages</SectionLabel>
          <ol className="space-y-1">
            {stages.map((s, i) => (
              <li key={s.id}>
                <div
                  className={`flex items-center gap-1 rounded-md border px-2 py-1.5 cursor-pointer ${
                    i === index ? "border-emerald-500/40 bg-emerald-500/10" : "border-slate-600/30 bg-slate-700/20 hover:bg-slate-700/40"
                  }`}
                  onClick={() => setSelected(i)}
                >
                  <span className="text-xs text-slate-500 w-4">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-slate-200 truncate">
                      {s.label || s.id}
                      {i === plot.flow.startIndex && <span className="text-emerald-400"> · start</span>}
                    </div>
                    <div className="text-[11px] text-slate-500 truncate">
                      {layoutSummary(s.layout)} · {s.exit.length ? s.exit.map(describeTrigger).join(" & ") : "no exit"}
                    </div>
                  </div>
                  <button className={buttonClass.icon} disabled={i === 0} onClick={(e) => {
                      e.stopPropagation();
                      move(i, i - 1);
                      setSelected(i - 1);
                    }} title="Move up">
                    <ArrowUp className="w-3 h-3" />
                  </button>
                  <button
                    className={buttonClass.icon}
                    disabled={i === stages.length - 1}
                    onClick={(e) => {
                      e.stopPropagation();
                      move(i, i + 1);
                      setSelected(i + 1);
                    }}
                    title="Move down"
                  >
                    <ArrowDown className="w-3 h-3" />
                  </button>
                </div>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-2">
            <button
              className={buttonClass.neutral}
              onClick={() => {
                editPlot((p) => {
                  p.flow.stages = [...p.flow.stages, blankStage(p.flow.stages)];
                  return p;
                });
                setSelected(stages.length);
              }}
            >
              <Plus className="w-3.5 h-3.5" /> Stage
            </button>
            <button
              className={buttonClass.neutral}
              onClick={() => {
                editPlot((p) => {
                  const copy = { ...structuredClone(stage), id: blankStage(p.flow.stages).id, label: `${stage.label || stage.id} (copy)` };
                  p.flow.stages.splice(index + 1, 0, copy);
                  return p;
                });
                setSelected(index + 1);
              }}
            >
              <Copy className="w-3.5 h-3.5" /> Duplicate
            </button>
            <button
              className={buttonClass.danger}
              disabled={stages.length <= 1}
              onClick={() => {
                editPlot((p) => {
                  p.flow.stages.splice(index, 1);
                  p.flow.startIndex = Math.min(p.flow.startIndex, p.flow.stages.length - 1);
                  return p;
                });
                setSelected(Math.max(0, index - 1));
              }}
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </button>
          </div>

          <SectionLabel className="pt-2">Flow</SectionLabel>
          <CheckboxField label="Loop back to the first stage" checked={plot.flow.loop} onChange={(v) => editPlot((p) => ({ ...p, flow: { ...p.flow, loop: v } }))} />
          <SelectField
            label="Start on stage"
            value={String(plot.flow.startIndex)}
            options={stages.map((s, i) => ({ value: String(i), label: `${i + 1}. ${s.label || s.id}` }))}
            onChange={(v) => editPlot((p) => ({ ...p, flow: { ...p.flow, startIndex: Number(v) } }))}
          />
          <SectionLabel className="pt-2">Plot policy overrides</SectionLabel>
          <PolicyOverridesEditor value={plot.policies} onChange={(pol) => editPlot((p) => ({ ...p, policies: pol }))} />
        </div>

        <div className="min-w-0">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <SectionLabel>Stage {index + 1}</SectionLabel>
              <label className="flex items-center gap-2 text-xs text-slate-300">
                Label
                <input className={`${inputClass} flex-1`} value={stage.label ?? ""} onChange={(e) => editStage((s) => ({ ...s, label: e.target.value }))} />
              </label>
              <CheckboxField
                label="Full clear on entry (otherwise identical plants are kept)"
                checked={!!stage.fullClear}
                onChange={(v) => editStage((s) => ({ ...s, fullClear: v || undefined }))}
              />
              <SectionLabel className="pt-1">Leave this stage when</SectionLabel>
              <TriggerEditor exit={stage.exit} onChange={(exit) => editStage((s) => ({ ...s, exit }))} />
            </div>
            <div className="space-y-2">
              <SectionLabel>Stage policy overrides</SectionLabel>
              <PolicyOverridesEditor value={stage.policies} onChange={(pol) => editStage((s) => ({ ...s, policies: pol }))} />
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 border-t border-slate-700/60 pt-4">
        <SectionLabel>
          Stage {index + 1} layout · {stage.label || stage.id}
        </SectionLabel>
        <p className="text-[11px] text-slate-500 mb-3">
          Inputs are planted (base crops free; mutation items come from inventory after setup). Targets are EMPTY cells labelled with the mutation expected to spawn there.
        </p>
        <StageLayoutEditor key={`${plotId}-${stage.id}`} layout={stage.layout} onChange={(layout) => editStage((s) => ({ ...s, layout }))} />
      </div>
    </Panel>
  );
};

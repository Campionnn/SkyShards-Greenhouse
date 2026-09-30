import React, { useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Copy, ExternalLink, Eye, FolderInput, Plus, Trash2, X } from "lucide-react";
import { DesignerProvider } from "../../context";
import { useFitCellSize } from "../../hooks";
import type {
  Condition,
  ConditionMatch,
  FlowStage,
  Policies,
  PolicyOverrides,
  Scenario,
  ScenarioPlot,
  StageLayout,
  StageRoute,
  Trigger,
} from "../../simulator";
import type { LayoutTransform } from "../../utilities";
import { CropSelectionPalette, DesignerGrid, LayoutClearControls, LayoutHistoryControls, LayoutTransformControls, MutationValidator } from "../designer";
import { CropImage } from "../shared";
import { Panel, SectionLabel, useToast } from "../ui";
import { CheckboxField, IdSelect, NumberInput, SelectField } from "./controls";
import { ALL_KIND_IDS, ALL_MUTATION_IDS, allItemIds, describeConditions, nameOf } from "./format";
import { LayoutPickerDialog } from "./LayoutPicker";
import {
  blankStage,
  defaultGroup,
  defaultTrigger,
  deleteStage,
  layoutCode,
  layoutSummary,
  layoutToPlacements,
  placementsToCode,
  pruneWatch,
  transformWatch,
  TRIGGER_KINDS,
  updatePlot,
  updateStage,
  withWatch,
} from "./scenarioEdit";
import { buttonClass, inputClass } from "./styles";

// ---- Embedded layout editor ------------------------------------------------

/**
 * The Designer's own grid and palette, mounted on a private, non-persisted
 * DesignerProvider so editing a stage never touches the Designer page's saved
 * layout. Lowercase inputs are planted; targets are EMPTY labelled cells.
 */
const StageLayoutEditor: React.FC<{ layout: StageLayout; onChange: (layout: StageLayout, transform?: LayoutTransform) => void }> = ({ layout, onChange }) => {
  const { toast } = useToast();
  const [version, setVersion] = useState(0);
  const [picking, setPicking] = useState(false);
  const fitRef = useRef<HTMLDivElement>(null);
  const { cellSize, gap } = useFitCellSize(fitRef, { max: 52 });
  const code = layoutCode(layout);
  // Re-read the layout only when the editor is (re)mounted, not on every keystroke it produced.
  const initial = useMemo(() => layoutToPlacements(layout), [version]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className={buttonClass.primary} onClick={() => setPicking(true)} title="Replace this stage's layout with one from the Calculator, the Designer, your saved layouts or a share link">
          <FolderInput className="w-3.5 h-3.5" /> Load layout...
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
      {picking && (
        <LayoutPickerDialog
          title="Load a layout into this stage"
          useLabel="Replace this stage's layout"
          onClose={() => setPicking(false)}
          onUse={(picked) => {
            const before = layout;
            onChange({ code: picked.code });
            setVersion((v) => v + 1);
            setPicking(false);
            toast({
              title: "Stage layout replaced",
              description: picked.name,
              variant: "success",
              duration: 5000,
              action: {
                label: "Undo",
                onClick: () => {
                  onChange(before);
                  setVersion((v) => v + 1);
                },
              },
            });
          }}
        />
      )}
      <DesignerProvider
        key={version}
        persist={false}
        initialPlacements={initial}
        onChange={(inputs, targets, groundTiles, transform) => onChange({ code: placementsToCode(inputs, targets, groundTiles) }, transform)}
      >
        {/* Same arrangement as the Designer page: transform/clear/validation | grid | palette. */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] 2xl:grid-cols-[300px_minmax(0,1fr)_300px] gap-4 lg:items-start">
          <div className="order-3 lg:col-start-2 lg:row-start-1 lg:row-span-2 2xl:row-span-1 2xl:col-start-3 bg-slate-900/40 border border-slate-600/30 rounded-lg p-3 max-h-[640px] overflow-y-auto scrollbar-dark">
            <CropSelectionPalette />
          </div>
          <div className="order-1 lg:col-start-1 lg:row-start-1 2xl:col-start-2 min-w-0 bg-slate-900/40 border border-slate-600/30 rounded-lg p-3">
            <LayoutHistoryControls className="justify-end mb-2" />
            <div ref={fitRef} className="w-full flex flex-col items-center">
              <DesignerGrid cellSize={cellSize} gap={gap} showTargets />
            </div>
          </div>
          <div className="order-2 lg:col-start-1 lg:row-start-2 2xl:col-start-1 2xl:row-start-1 space-y-4">
            <div className="bg-slate-900/40 border border-slate-600/30 rounded-lg p-3 space-y-3">
              <div className="space-y-2">
                <SectionLabel>Transform</SectionLabel>
                <LayoutTransformControls />
              </div>
              <div className="space-y-2">
                <SectionLabel>Clear</SectionLabel>
                <LayoutClearControls />
              </div>
            </div>
            <div className="bg-slate-900/40 border border-slate-600/30 rounded-lg p-3">
              <MutationValidator />
            </div>
          </div>
        </div>
      </DesignerProvider>
    </div>
  );
};

// ---- Watched targets (sustainability uptime) --------------------------------

const PICK_CELL = 26;
const PICK_GAP = 2;

/**
 * Pick which of this stage's target cells the sustainability check records.
 * `watch` undefined = every target (and it follows layout edits); a list pins
 * the choice to those anchors.
 */
export const WatchPicker: React.FC<{ stage: FlowStage; onChange: (watch: string[] | undefined) => void }> = ({ stage, onChange }) => {
  const placements = useMemo(() => {
    try {
      return layoutToPlacements(stage.layout);
    } catch {
      return null;
    }
  }, [stage.layout]);
  if (!placements) return <p className="text-xs text-red-300">This stage's layout could not be read.</p>;

  const targets = placements.targets.map((t) => ({ key: `${t.position[0]},${t.position[1]}`, id: t.cropId, row: t.position[0], col: t.position[1], size: t.size }));
  const all = targets.map((t) => t.key);
  const watched = new Set(stage.watch ?? all);
  const count = targets.filter((t) => watched.has(t.key)).length;
  const toggle = (key: string) => {
    const next = all.filter((k) => (k === key ? !watched.has(k) : watched.has(k)));
    onChange(next.length === all.length ? undefined : next);
  };
  const span = (n: number) => n * PICK_CELL + (n - 1) * PICK_GAP;
  const at = (n: number) => n * (PICK_CELL + PICK_GAP);

  if (targets.length === 0) {
    return <p className="text-xs text-slate-500">This stage has no target cells. Add targets in the layout below to check their uptime.</p>;
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-slate-500">
        Click a target to include or exclude it. A checked cell loses uptime whenever it sits empty without the requirements for its mutation, or is blocked by
        something else.
      </p>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-300">
          {count} of {targets.length} checked{stage.watch === undefined && <span className="text-slate-500"> (all, the default)</span>}
        </span>
        <button className={buttonClass.neutral} disabled={stage.watch === undefined} onClick={() => onChange(undefined)}>
          All
        </button>
        <button className={buttonClass.neutral} disabled={count === 0} onClick={() => onChange([])}>
          None
        </button>
      </div>
      <div className="relative bg-slate-900/40 border border-slate-600/30 rounded" style={{ width: span(10) + 8, height: span(10) + 8 }}>
        <div className="absolute" style={{ top: 4, left: 4, width: span(10), height: span(10) }}>
          {Array.from({ length: 100 }, (_, i) => (
            <div
              key={i}
              className="absolute rounded-sm bg-slate-800/60"
              style={{ top: at(Math.floor(i / 10)), left: at(i % 10), width: PICK_CELL, height: PICK_CELL }}
            />
          ))}
          {placements.inputs.map((p) => (
            <div
              key={p.id}
              className="absolute rounded-sm opacity-40 flex items-center justify-center pointer-events-none"
              style={{ top: at(p.position[0]), left: at(p.position[1]), width: span(p.size), height: span(p.size) }}
            >
              <CropImage cropId={p.cropId} cropName={nameOf(p.cropId)} width={span(p.size) * 0.8} height={span(p.size) * 0.8} showFallback={false} />
            </div>
          ))}
          {targets.map((t) => {
            const on = watched.has(t.key);
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => toggle(t.key)}
                title={`${nameOf(t.id)} at (${t.key}) - ${on ? "checked" : "not checked"}`}
                className={`absolute rounded-sm flex items-center justify-center cursor-pointer border-2 ${
                  on ? "border-emerald-400 bg-emerald-500/20" : "border-dashed border-slate-500/70 bg-slate-900/40 opacity-60"
                }`}
                style={{ top: at(t.row), left: at(t.col), width: span(t.size), height: span(t.size) }}
              >
                <CropImage cropId={t.id} cropName={nameOf(t.id)} width={span(t.size) * 0.7} height={span(t.size) * 0.7} showFallback={false} />
                {on && <Eye className="absolute top-0 right-0 w-2.5 h-2.5 text-emerald-300" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ---- Triggers --------------------------------------------------------------

/** A stage choice for pickers: its id and "N. label". */
interface StageOption {
  id: string;
  name: string;
}

const TriggerRow: React.FC<{ trigger: Trigger; stages: StageOption[]; onChange: (t: Trigger) => void; onRemove: () => void }> = ({
  trigger,
  stages,
  onChange,
  onRemove,
}) => (
  <div className="flex flex-wrap items-center gap-1.5">
    <select className={inputClass} value={trigger.kind} onChange={(e) => onChange(defaultTrigger(e.target.value as Trigger["kind"]))}>
      {TRIGGER_KINDS.map((k) => (
        <option key={k.value} value={k.value}>
          {k.label}
        </option>
      ))}
    </select>
    {trigger.kind === "cycles" && (
      <NumberInput integer min={1} className={`${inputClass} w-20`} value={trigger.n} onChange={(n) => onChange({ ...trigger, n })} />
    )}
    {(trigger.kind === "inventoryAtLeast" || trigger.kind === "inventoryBelow") && (
      <>
        <IdSelect value={trigger.item} ids={allItemIds()} onChange={(item) => onChange({ ...trigger, item })} />
        <NumberInput integer min={0} className={`${inputClass} w-20`} value={trigger.qty} onChange={(qty) => onChange({ ...trigger, qty })} />
      </>
    )}
    {(trigger.kind === "mutationSpawned" || trigger.kind === "fullyGrown" || trigger.kind === "mutationHarvested") && (
      <IdSelect value={trigger.mutationId} ids={ALL_MUTATION_IDS} onChange={(mutationId) => onChange({ ...trigger, mutationId })} />
    )}
    {(trigger.kind === "mutationSpawned" || trigger.kind === "mutationHarvested" || trigger.kind === "fullyGrown") && (
      <NumberInput
        integer
        min={1}
        className={`${inputClass} w-16`}
        title="How many"
        value={trigger.count ?? 1}
        onChange={(count) => onChange({ ...trigger, count })}
      />
    )}
    {trigger.kind === "targetsFilled" && (
      <>
        <NumberInput
          integer
          min={0}
          className={`${inputClass} w-16`}
          title="0 = every target in this stage's layout"
          value={trigger.count}
          onChange={(count) => onChange({ ...trigger, count })}
        />
        <span className="text-xs text-slate-500">{trigger.count <= 0 ? "every target holds its mutation" : "targets hold their mutation"}</span>
      </>
    )}
    {trigger.kind === "plantDecayed" && <IdSelect value={trigger.kindId} ids={ALL_KIND_IDS} onChange={(kindId) => onChange({ ...trigger, kindId })} />}
    {trigger.kind === "decayImminent" && (
      <>
        <NumberInput integer min={0} className={`${inputClass} w-16`} value={trigger.withinCycles} onChange={(withinCycles) => onChange({ ...trigger, withinCycles })} />
        <span className="text-xs text-slate-500">cycles</span>
      </>
    )}
    {trigger.kind === "stageVisits" && (
      <>
        <NumberInput
          integer
          min={1}
          className={`${inputClass} w-16`}
          title="Counts this visit too: 3 = every 3rd time"
          value={trigger.count}
          onChange={(count) => onChange({ ...trigger, count })}
        />
        <span className="text-xs text-slate-500">times since</span>
        <select
          className={inputClass}
          value={trigger.sinceStage ?? ""}
          title="Restart the count each time the plot enters this stage"
          onChange={(e) => {
            const next = { ...trigger };
            if (e.target.value) next.sinceStage = e.target.value;
            else delete next.sinceStage;
            onChange(next);
          }}
        >
          <option value="">the start of the run</option>
          {stages.map((s) => (
            <option key={s.id} value={s.id}>
              entering {s.name}
            </option>
          ))}
        </select>
      </>
    )}
    <button className={buttonClass.icon} onClick={onRemove} title="Remove condition">
      <X className="w-3.5 h-3.5" />
    </button>
  </div>
);

/** Select value for "the following stage" (no `next`). Not a valid stage id, since ids are never empty. */
const NEXT_DEFAULT = "";

/** Nesting depth at which "Add group" stops being offered. */
const MAX_GROUP_DEPTH = 3;

const MatchToggle: React.FC<{ match: ConditionMatch; onChange: (m: ConditionMatch) => void }> = ({ match, onChange }) => (
  <div className="inline-flex rounded-md border border-slate-600/50 overflow-hidden text-[11px]" role="group" aria-label="Combine conditions with">
    {(["all", "any"] as const).map((m) => (
      <button
        key={m}
        type="button"
        onClick={() => onChange(m)}
        aria-pressed={match === m}
        title={m === "all" ? "Every condition must hold" : "At least one condition must hold"}
        className={`px-2 py-0.5 ${match === m ? "bg-emerald-500/20 text-emerald-200" : "bg-slate-800/60 text-slate-400 hover:text-slate-200"}`}
      >
        {m === "all" ? "ALL (AND)" : "ANY (OR)"}
      </button>
    ))}
  </div>
);

/**
 * A condition list with an AND / OR switch. Entries are single conditions or
 * nested groups (each with its own switch), so things like
 * "(A or B) and C" can be built.
 */
export const ConditionListEditor: React.FC<{
  list: Condition[];
  match: ConditionMatch;
  onChange: (list: Condition[], match: ConditionMatch) => void;
  stages: StageOption[];
  empty?: string;
  depth?: number;
}> = ({ list, match, onChange, stages, empty, depth = 0 }) => {
  const set = (i: number, c: Condition) => onChange(list.map((x, j) => (j === i ? c : x)), match);
  const remove = (i: number) => onChange(list.filter((_, j) => j !== i), match);
  return (
    <div className="space-y-1.5">
      {list.length > 1 && (
        <div className="flex items-center gap-2 text-[11px] text-slate-400">
          Holds when <MatchToggle match={match} onChange={(m) => onChange(list, m)} /> of these hold
        </div>
      )}
      {list.length === 0 && empty && <p className="text-xs text-slate-500">{empty}</p>}
      {list.map((c, i) => (
        <React.Fragment key={i}>
          {i > 0 && <div className="text-[10px] uppercase tracking-wide text-slate-500 pl-1">{match === "any" ? "or" : "and"}</div>}
          {c.kind === "group" ? (
            <div className="rounded-md border border-slate-600/40 bg-slate-900/40 p-2 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-slate-400">Group</span>
                <button className={buttonClass.icon} onClick={() => remove(i)} title="Remove group">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <ConditionListEditor
                list={c.of}
                match={c.match}
                stages={stages}
                depth={depth + 1}
                empty="An empty group never holds."
                onChange={(of, m) => set(i, { ...c, of, match: m })}
              />
            </div>
          ) : (
            <TriggerRow trigger={c} stages={stages} onChange={(t) => set(i, t)} onRemove={() => remove(i)} />
          )}
        </React.Fragment>
      ))}
      <div className="flex flex-wrap gap-1.5">
        <button className={buttonClass.neutral} onClick={() => onChange([...list, defaultTrigger("cycles")], match)}>
          <Plus className="w-3.5 h-3.5" /> Condition
        </button>
        {depth < MAX_GROUP_DEPTH && (
          <button
            className={buttonClass.neutral}
            onClick={() => onChange([...list, defaultGroup(match === "any" ? "all" : "any")], match)}
            title="A nested set of conditions with its own AND / OR, e.g. (A or B) and C"
          >
            <Plus className="w-3.5 h-3.5" /> AND/OR group
          </button>
        )}
      </div>
    </div>
  );
};

/** Routes: conditional jumps to chosen stages, checked in order before the normal exit. */
const RoutesEditor: React.FC<{ routes: StageRoute[]; stages: StageOption[]; currentId: string; onChange: (routes: StageRoute[]) => void }> = ({
  routes,
  stages,
  currentId,
  onChange,
}) => {
  const set = (i: number, r: StageRoute) => onChange(routes.map((x, j) => (j === i ? r : x)));
  const move = (from: number, to: number) => {
    const next = [...routes];
    const [r] = next.splice(from, 1);
    next.splice(to, 0, r);
    onChange(next);
  };
  const defaultTarget = stages.find((s) => s.id !== currentId)?.id ?? currentId;
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-slate-500">
        Checked in order before the normal exit; the first route whose conditions hold sends the plot to its stage. Use them to go somewhere other than the
        next stage, e.g. usually swap between stages 1 and 2, but go to stage 3 every 5th visit or once an item runs low.
      </p>
      {routes.map((r, i) => (
        <div key={i} className="rounded-md border border-sky-500/30 bg-sky-500/5 p-2 space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-300">
            <span className="text-slate-500 w-4">{i + 1}</span>
            Go to
            <select className={inputClass} value={r.to} onChange={(e) => set(i, { ...r, to: e.target.value })}>
              {!stages.some((s) => s.id === r.to) && <option value={r.to}>missing stage "{r.to}"</option>}
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.id === currentId ? " (restart this stage)" : ""}
                </option>
              ))}
            </select>
            when
            <span className="flex-1" />
            <button className={buttonClass.icon} disabled={i === 0} onClick={() => move(i, i - 1)} title="Check earlier">
              <ArrowUp className="w-3 h-3" />
            </button>
            <button className={buttonClass.icon} disabled={i === routes.length - 1} onClick={() => move(i, i + 1)} title="Check later">
              <ArrowDown className="w-3 h-3" />
            </button>
            <button className={buttonClass.icon} onClick={() => onChange(routes.filter((_, j) => j !== i))} title="Remove route">
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
          <ConditionListEditor
            list={r.when}
            match={r.match ?? "all"}
            stages={stages}
            empty="No conditions: this route never fires."
            onChange={(when, m) => {
              const next: StageRoute = { ...r, when };
              if (m === "any") next.match = "any";
              else delete next.match;
              set(i, next);
            }}
          />
        </div>
      ))}
      <button className={buttonClass.neutral} onClick={() => onChange([...routes, { to: defaultTarget, when: [defaultTrigger("cycles")] }])}>
        <Plus className="w-3.5 h-3.5" /> Route
      </button>
    </div>
  );
};

/** "N. label" for a stage id, or the raw id if it no longer exists. */
function stageNamer(stages: FlowStage[]): (id: string) => string {
  return (id) => {
    const i = stages.findIndex((s) => s.id === id);
    return i < 0 ? `"${id}"` : `${i + 1}. ${stages[i].label || stages[i].id}`;
  };
}

/** One-line summary of where a stage goes and when, for the stage list. */
function stageExitSummary(s: FlowStage, stages: FlowStage[]): string {
  const name = stageNamer(stages);
  const parts = (s.routes ?? []).map((r) => `→ ${name(r.to)} if ${r.when.length ? describeConditions(r.when, r.match, name) : "never"}`);
  if (s.exit.length) parts.push(`${s.next ? `→ ${name(s.next)} ` : ""}when ${describeConditions(s.exit, s.exitMatch, name)}`);
  return parts.length ? parts.join(" · ") : "no exit";
}

// ---- Policies --------------------------------------------------------------

const INHERIT = "inherit";

const POLICY_FIELDS: { key: "spawnedHarvest" | "layoutInputSpawns" | "baseCropUpkeep" | "watering"; label: string; options: { value: string; label: string }[] }[] = [
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
    <CheckboxField
      label="Fix wrong ground blocks under empty targets"
      title="Swap a target cell's ground back to what its mutation needs (e.g. End Stone left by Chorus Fruit)."
      checked={value.fixGround !== false}
      onChange={(v) => onChange({ ...value, fixGround: v })}
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
      <SelectField
        label="Fix wrong target ground"
        value={v.fixGround === undefined ? INHERIT : v.fixGround ? "yes" : "no"}
        options={[
          { value: INHERIT, label: "inherit" },
          { value: "yes", label: "yes" },
          { value: "no", label: "no" },
        ]}
        onChange={(choice) => {
          const next = { ...v };
          if (choice === INHERIT) delete next.fixGround;
          else next.fixGround = choice === "yes";
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
  /** Stage selected when the editor opens (e.g. one just added from another page). */
  initialStage?: number;
}> = ({ scenario, plotId, onChange, onClose, initialStage = 0 }) => {
  const plot = scenario.plots.find((p) => p.id === plotId);
  const [selected, setSelected] = useState(initialStage);
  if (!plot) return null;
  const { stages } = plot.flow;
  const index = Math.min(selected, stages.length - 1);
  const stage = stages[index];
  const stageOptions: StageOption[] = stages.map((s, i) => ({ id: s.id, name: `${i + 1}. ${s.label || s.id}` }));
  const isLast = index === stages.length - 1;
  const defaultNextLabel = isLast
    ? plot.flow.loop
      ? `the next stage (1. ${stages[0].label || stages[0].id})`
      : "nowhere: hold this final stage"
    : `the next stage (${stageOptions[index + 1].name})`;

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
                    <div className="text-[11px] text-slate-500 truncate" title={stageExitSummary(s, stages)}>
                      {layoutSummary(s.layout)} · {stageExitSummary(s, stages)}
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
                editPlot((p) => deleteStage(p, index));
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
              <ConditionListEditor
                list={stage.exit}
                match={stage.exitMatch ?? "all"}
                stages={stageOptions}
                empty={stage.routes?.length ? "No normal exit: the plot only leaves through a route." : "No exit conditions: the plot stays on this stage."}
                onChange={(exit, m) =>
                  editStage((s) => {
                    const next: FlowStage = { ...s, exit };
                    if (m === "any") next.exitMatch = "any";
                    else delete next.exitMatch;
                    return next;
                  })
                }
              />
              <SelectField
                label="then go to"
                value={stage.next ?? NEXT_DEFAULT}
                options={[
                  { value: NEXT_DEFAULT, label: defaultNextLabel },
                  ...(stage.next !== undefined && !stages.some((s) => s.id === stage.next) ? [{ value: stage.next, label: `missing stage "${stage.next}"` }] : []),
                  ...stageOptions.map((s) => ({ value: s.id, label: s.id === stage.id ? `${s.name} (restart)` : s.name })),
                ]}
                onChange={(v) =>
                  editStage((s) => {
                    const next = { ...s };
                    if (v === NEXT_DEFAULT) delete next.next;
                    else next.next = v;
                    return next;
                  })
                }
              />
              <SectionLabel className="pt-2">Routes to other stages</SectionLabel>
              <RoutesEditor
                routes={stage.routes ?? []}
                stages={stageOptions}
                currentId={stage.id}
                onChange={(routes) =>
                  editStage((s) => {
                    const next = { ...s };
                    if (routes.length) next.routes = routes;
                    else delete next.routes;
                    return next;
                  })
                }
              />
            </div>
            <div className="space-y-2">
              <SectionLabel>Stage policy overrides</SectionLabel>
              <PolicyOverridesEditor value={stage.policies} onChange={(pol) => editStage((s) => ({ ...s, policies: pol }))} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <SectionLabel>Sustainability: checked targets</SectionLabel>
              <WatchPicker stage={stage} onChange={(watch) => editStage((s) => withWatch(s, watch))} />
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
        <StageLayoutEditor key={`${plotId}-${stage.id}`} layout={stage.layout} onChange={(layout, transform) =>
            editStage((s) => pruneWatch({ ...(transform ? transformWatch(s, transform) : s), layout }))
          }
        />
      </div>
    </Panel>
  );
};

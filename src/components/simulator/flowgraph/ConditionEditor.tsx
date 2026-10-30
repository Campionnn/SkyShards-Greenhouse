import React, { useEffect, useRef, useState } from "react";
import {
  Brackets,
  ChevronDown,
  Clock,
  Copy,
  CodeXml,
  Hourglass,
  Package,
  PackageCheck,
  PackagePlus,
  PackageX,
  Plus,
  Repeat,
  Scissors,
  Skull,
  Sparkles,
  Sprout,
  Target,
  TrendingDown,
  TrendingUp,
  Ungroup,
  Wheat,
  X,
  type LucideIcon,
} from "lucide-react";
import type { Condition, ConditionGroup, ConditionMatch, FlowStep, Trigger, TriggerKind } from "../../../simulator";
import { checkScriptExpression } from "../../../simulator";
import { CropImage } from "../../shared";
import { useContextMenu } from "../../ui/contextMenuContext";
import { IconButton, KitButton, KitInput, Segmented } from "../../ui/kit";
import { getRarityTextColor } from "../../../utilities/rarity";
import { NumberInput } from "../controls";
import { ALL_KIND_IDS, ALL_MUTATION_IDS, allItemIds, nameOf, rarityOf } from "../format";
import { ItemPicker } from "../ItemPicker";
import { defaultGroup, defaultTrigger } from "../scenarioEdit";
import { Dropdown, MenuItem, MenuLabel, MenuSeparator, Popover } from "./InspectorPopover";
import { RiseScope, useRiseIn } from "./InspectorMotion";
import { layoutFacts, stepTitle } from "./shared";

// Exit conditions as sentences with editable tokens: "[Ashwreath ▾] in stock is below [20]".
// The icon square in front of a condition opens the kind menu. Lists of 2+ entries get an
// ALL / ANY switch; entries may be nested AND / OR groups (violet), up to MAX_GROUP_DEPTH deep.

/** Nesting depth at which "AND / OR group" stops being offered. */
export const MAX_GROUP_DEPTH = 3;

export type ConditionChange = (list: Condition[], match: ConditionMatch, opts?: { mergeKey?: string }) => void;

interface KindInfo {
  kind: TriggerKind;
  label: string;
  hint: string;
  icon: LucideIcon;
}

const KIND_GROUPS: { title: string; kinds: KindInfo[] }[] = [
  {
    title: "Time",
    kinds: [
      { kind: "cycles", label: "Cycles in this step", hint: "After N cycles spent here", icon: Clock },
      { kind: "decayImminent", label: "Something about to decay", hint: "A plant decays within N cycles", icon: Hourglass },
      { kind: "plantDecayed", label: "A plant decayed", hint: "A plant of a kind decayed in this step", icon: Skull },
    ],
  },
  {
    title: "Inventory",
    kinds: [
      { kind: "inventoryAtLeast", label: "In stock at least", hint: "Shared inventory holds N or more", icon: PackageCheck },
      { kind: "inventoryBelow", label: "In stock below", hint: "Shared inventory holds fewer than N", icon: Package },
      { kind: "collectedAtLeast", label: "Collected in total", hint: "Collected since the run started; spending never lowers it", icon: PackagePlus },
      { kind: "layoutShort", label: "Can't build the layout", hint: "The inventory can't fill what this layout is missing", icon: PackageX },
    ],
  },
  {
    title: "Growth",
    kinds: [
      { kind: "fullyGrown", label: "Mutation fully grown", hint: "N natural spawns stand fully grown", icon: Sprout },
      { kind: "allFullyGrown", label: "Everything fully grown", hint: "Every base crop and spawn", icon: Wheat },
      { kind: "noneFullyGrown", label: "Nothing fully grown", hint: "No base crop or spawn is fully grown", icon: Wheat },
      { kind: "lowestStageAtLeast", label: "Every one at stage N+", hint: "Every plant of a mutation, at least one standing", icon: TrendingUp },
      { kind: "lowestStageBelow", label: "Some one below stage N", hint: "Or none on the plot", icon: TrendingDown },
      { kind: "highestStageAtLeast", label: "Some one at stage N+", hint: "At least one plant of a mutation", icon: TrendingUp },
      { kind: "highestStageBelow", label: "Every one below stage N", hint: "Or none on the plot", icon: TrendingDown },
    ],
  },
  {
    title: "Harvest & spawn",
    kinds: [
      { kind: "mutationSpawned", label: "Mutation spawned", hint: "N spawned since entering this step", icon: Sparkles },
      { kind: "mutationHarvested", label: "Mutation harvested", hint: "N harvested since entering this step", icon: Scissors },
    ],
  },
  {
    title: "Targets",
    kinds: [{ kind: "targetsFilled", label: "Targets filled", hint: "Target cells hold their mutation", icon: Target }],
  },
  {
    title: "Flow",
    kinds: [{ kind: "stepVisits", label: "Times this step entered", hint: "Every Nth visit, since the run or another step", icon: Repeat }],
  },
  {
    title: "Script",
    kinds: [{ kind: "script", label: "Script expression", hint: "Read-only expression in the plot script's scope", icon: CodeXml }],
  },
];

const KIND_INFO = Object.fromEntries(KIND_GROUPS.flatMap((g) => g.kinds.map((k) => [k.kind, k]))) as Record<TriggerKind, KindInfo>;

const ITEM_KINDS = new Set<TriggerKind>(["inventoryAtLeast", "inventoryBelow", "collectedAtLeast"]);
const MUTATION_KINDS = new Set<TriggerKind>([
  "fullyGrown",
  "mutationSpawned",
  "mutationHarvested",
  "lowestStageAtLeast",
  "lowestStageBelow",
  "highestStageAtLeast",
  "highestStageBelow",
]);
const STAGE_KINDS = new Set<TriggerKind>(["lowestStageAtLeast", "lowestStageBelow", "highestStageAtLeast", "highestStageBelow"]);

/** A new condition of `kind`, keeping what carries over from `prev` (the item and amount, the mutation, the stage). */
function convertTrigger(prev: Trigger, kind: TriggerKind): Trigger {
  const next = defaultTrigger(kind) as Record<string, unknown>;
  const old = prev as Record<string, unknown>;
  if (ITEM_KINDS.has(kind) && ITEM_KINDS.has(prev.kind)) Object.assign(next, { item: old.item, qty: old.qty });
  if (MUTATION_KINDS.has(kind) && MUTATION_KINDS.has(prev.kind)) next.mutationId = old.mutationId;
  if (STAGE_KINDS.has(kind) && STAGE_KINDS.has(prev.kind)) next.stage = old.stage;
  if (kind === "plantDecayed" && MUTATION_KINDS.has(prev.kind)) next.kindId = old.mutationId;
  if (MUTATION_KINDS.has(kind) && prev.kind === "plantDecayed" && (ALL_MUTATION_IDS as readonly string[]).includes(old.kindId as string)) next.mutationId = old.kindId;
  return next as Trigger;
}

// ---- Tokens -------------------------------------------------------------------------------------

const tokenBase =
  "inline-flex h-[22px] max-w-full items-center gap-1 rounded-[5px] bg-slate-700/60 px-1.5 align-middle font-medium text-slate-100 shadow-[inset_0_0_0_1px_rgba(148,163,184,0.18)] transition-colors duration-150 hover:bg-slate-600/70";

/** An item / mutation / plant token: opens the searchable item picker. */
const IdToken: React.FC<{ value: string; ids: readonly string[]; onChange: (id: string) => void; label: string }> = ({ value, ids, onChange, label }) => {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    // After the popover has been placed (it is hidden for its first frame).
    const id = requestAnimationFrame(() => boxRef.current?.querySelector("input")?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);
  const rarity = rarityOf(value);
  return (
    <>
      <button
        ref={setAnchor}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}: ${nameOf(value)}`}
        title={`${nameOf(value)} (click to change)`}
        onClick={() => setOpen((o) => !o)}
        className={`${tokenBase} cursor-pointer pl-1 ${rarity ? getRarityTextColor(rarity) : ""}`}
      >
        <CropImage cropId={value} cropName={nameOf(value)} size="custom" width={15} height={15} showFallback={false} className="shrink-0" />
        <span className="truncate">{nameOf(value)}</span>
        <ChevronDown className="h-3 w-3 shrink-0 text-slate-500" />
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} label={label} width={300} reserve={430} bare>
        <div ref={boxRef} className="rounded-md bg-slate-900 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.9)]">
          <ItemPicker value={value} ids={ids} onChange={onChange} onPicked={() => setOpen(false)} />
        </div>
      </Popover>
    </>
  );
};

/** A number token: a compact, borderless number input that grows with its value. */
const NumberToken: React.FC<{ value: number; onChange: (n: number) => void; min?: number; label: string; title?: string }> = ({ value, onChange, min = 0, label, title }) => (
  <NumberInput
    integer
    min={min}
    value={value}
    onChange={onChange}
    aria-label={label}
    title={title ?? label}
    // Grows with the number (field-sizing isn't everywhere yet).
    style={{ width: `calc(${Math.min(9, Math.max(1, String(value).length))}ch + 14px)` }}
    className={`${tokenBase} cursor-text text-center tabular-nums [appearance:textfield] focus:bg-slate-950/70 focus:shadow-[inset_0_0_0_1px_rgba(52,211,153,0.6)] focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
  />
);

/** A choice token (a small menu). */
function ChoiceToken<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string; hint?: string }[]; onChange: (v: T) => void; label: string }) {
  const cur = options.find((o) => o.value === value);
  return (
    <Dropdown label={label} look="token" width={240} button={<span className="truncate">{cur?.label ?? value}</span>}>
      {(close) =>
        options.map((o) => (
          <MenuItem
            key={o.value}
            checked={o.value === value}
            hint={o.hint}
            onSelect={() => {
              onChange(o.value);
              close();
            }}
          >
            {o.label}
          </MenuItem>
        ))
      }
    </Dropdown>
  );
}

/** "since [the start of the run ▾]" for step visits. */
const SinceStepToken: React.FC<{ value: string | undefined; steps: FlowStep[]; onChange: (id: string | undefined) => void }> = ({ value, steps, onChange }) => {
  const i = value === undefined ? -1 : steps.findIndex((s) => s.id === value);
  const text = value === undefined ? "the start of the run" : i < 0 ? `missing step "${value}"` : `entering ${stepTitle(steps[i], i)}`;
  return (
    <Dropdown
      label="Count visits since"
      look="token"
      width={280}
      title="Restart the count each time the plot enters this step"
      button={
        <>
          {i >= 0 && <CropImage cropId={layoutFacts(steps[i]).icon} cropName="" size="custom" width={15} height={15} showFallback={false} className="shrink-0" />}
          <span className={`truncate ${i < 0 && value !== undefined ? "text-red-300" : ""}`}>{text}</span>
        </>
      }
    >
      {(close) => (
        <>
          <MenuItem
            checked={value === undefined}
            onSelect={() => {
              onChange(undefined);
              close();
            }}
          >
            the start of the run
          </MenuItem>
          <MenuSeparator />
          <MenuLabel>Since entering</MenuLabel>
          {steps.map((s, k) => (
            <MenuItem
              key={s.id}
              checked={s.id === value}
              icon={<CropImage cropId={layoutFacts(s).icon} cropName="" size="custom" width={18} height={18} showFallback={false} />}
              onSelect={() => {
                onChange(s.id);
                close();
              }}
            >
              {stepTitle(s, k)}
            </MenuItem>
          ))}
        </>
      )}
    </Dropdown>
  );
};

const ScriptExpression: React.FC<{ expr: string; onChange: (expr: string) => void }> = ({ expr, onChange }) => {
  const problem = checkScriptExpression(expr);
  return (
    <span className="mt-1 flex w-full flex-col gap-1">
      <KitInput
        value={expr}
        spellCheck={false}
        aria-label="Script expression"
        aria-invalid={!!problem}
        placeholder='plot.count("chorus_fruit") >= 4 && shared.ready'
        title="A script expression. It sees the plot script's variables and functions, plot, shared, inventory and the rest of the script API. It may only read."
        onChange={(e) => onChange(e.target.value)}
        className={`h-7 w-full font-mono text-[12px] ${problem ? "border-red-500/60 focus:border-red-400/70" : ""}`}
      />
      {problem && <span className="text-[11px] leading-snug text-red-300">{problem}</span>}
    </span>
  );
};

// ---- One condition --------------------------------------------------------------------------------

type Edit = (t: Trigger, mergeKey?: string) => void;

/** The sentence for a trigger, with its tokens wired to `edit`. Every trigger kind has one. */
function Sentence({ t, edit, steps, keyBase }: { t: Trigger; edit: Edit; steps: FlowStep[]; keyBase: string }): React.ReactNode {
  const num = (field: string) => `${keyBase}:${field}`;
  switch (t.kind) {
    case "cycles":
      return (
        <>
          <NumberToken min={1} label="Cycles" value={t.n} onChange={(n) => edit({ ...t, n }, num("n"))} /> cycles spent in this step
        </>
      );
    case "inventoryAtLeast":
    case "inventoryBelow":
      return (
        <>
          <IdToken label="Item" value={t.item} ids={allItemIds()} onChange={(item) => edit({ ...t, item })} /> in stock is {t.kind === "inventoryBelow" ? "below" : "at least"}{" "}
          <NumberToken label="Amount" value={t.qty} onChange={(qty) => edit({ ...t, qty }, num("qty"))} />
        </>
      );
    case "collectedAtLeast":
      return (
        <>
          <IdToken label="Item" value={t.item} ids={allItemIds()} onChange={(item) => edit({ ...t, item })} /> collected in total is at least{" "}
          <NumberToken label="Amount" value={t.qty} onChange={(qty) => edit({ ...t, qty }, num("qty"))} />
          <Aside>since the run started; spending never lowers it</Aside>
        </>
      );
    case "layoutShort":
      return (
        <span title="For some placed item (mutation, Fermento, Dead Plant; not base crops or fire), more cells lack it than the inventory holds.">
          The inventory <b className="font-semibold text-slate-100">can't build</b> this step's layout
        </span>
      );
    case "allFullyGrown":
      return <>Every base crop and spawn on the plot is fully grown</>;
    case "noneFullyGrown":
      return <>Nothing on the plot is fully grown</>;
    case "fullyGrown":
      return (
        <>
          <NumberToken min={1} label="How many" value={t.count ?? 1} onChange={(count) => edit({ ...t, count }, num("count"))} />{" "}
          <IdToken label="Mutation" value={t.mutationId} ids={ALL_MUTATION_IDS} onChange={(mutationId) => edit({ ...t, mutationId })} /> {(t.count ?? 1) === 1 ? "spawn stands" : "spawns stand"} fully grown
        </>
      );
    case "decayImminent":
      return (
        <>
          Something decays within <NumberToken label="Cycles" value={t.withinCycles} onChange={(withinCycles) => edit({ ...t, withinCycles }, num("within"))} /> cycles
        </>
      );
    case "plantDecayed":
      return (
        <>
          A <IdToken label="Plant" value={t.kindId} ids={ALL_KIND_IDS} onChange={(kindId) => edit({ ...t, kindId })} /> decayed in this step
        </>
      );
    case "mutationSpawned":
    case "mutationHarvested":
      return (
        <>
          <NumberToken min={1} label="How many" value={t.count} onChange={(count) => edit({ ...t, count }, num("count"))} />{" "}
          <IdToken label="Mutation" value={t.mutationId} ids={ALL_MUTATION_IDS} onChange={(mutationId) => edit({ ...t, mutationId })} />{" "}
          {t.kind === "mutationSpawned" ? "spawned" : "harvested"} since entering this step
        </>
      );
    case "lowestStageAtLeast":
    case "lowestStageBelow":
    case "highestStageAtLeast":
    case "highestStageBelow": {
      const every = t.kind === "lowestStageAtLeast" || t.kind === "highestStageBelow";
      const below = t.kind === "lowestStageBelow" || t.kind === "highestStageBelow";
      const stage = <NumberToken label="Growth stage" value={t.stage} onChange={(s) => edit({ ...t, stage: s }, num("stage"))} />;
      return (
        <>
          {every ? "Every" : "Some"} <IdToken label="Mutation" value={t.mutationId} ids={ALL_MUTATION_IDS} onChange={(mutationId) => edit({ ...t, mutationId })} /> is{" "}
          {below ? <>below stage {stage}</> : <>at stage {stage} or higher</>}
          {below ? ", or there is none" : ""}
          {t.kind === "lowestStageAtLeast" && <Aside>needs at least one on the plot</Aside>}
        </>
      );
    }
    case "targetsFilled":
      return (
        <>
          <ChoiceToken
            label="How many targets"
            value={t.count <= 0 ? "every" : "some"}
            options={[
              { value: "every", label: "Every", hint: "Every target in this step's layout" },
              { value: "some", label: "At least", hint: "A number of targets" },
            ]}
            onChange={(v) => edit({ ...t, count: v === "every" ? 0 : Math.max(1, t.count) })}
          />{" "}
          {t.count <= 0 ? (
            "target holds its mutation"
          ) : (
            <>
              <NumberToken min={1} label="Targets" title="Targets holding their mutation (growing or fully grown)" value={t.count} onChange={(count) => edit({ ...t, count }, num("count"))} /> targets
              hold their mutation
            </>
          )}
        </>
      );
    case "stepVisits":
      return (
        <>
          This step was entered <NumberToken min={1} label="Visits" title="Counts this visit too: 3 = every 3rd time" value={t.count} onChange={(count) => edit({ ...t, count }, num("count"))} /> times
          since{" "}
          <SinceStepToken
            value={t.sinceStep}
            steps={steps}
            onChange={(id) => {
              const next = { ...t };
              if (id === undefined) delete next.sinceStep;
              else next.sinceStep = id;
              edit(next);
            }}
          />
        </>
      );
    case "script":
      return (
        <>
          This script expression holds
          <ScriptExpression expr={t.expr} onChange={(expr) => edit({ ...t, expr }, num("expr"))} />
        </>
      );
  }
}

const Aside: React.FC<{ children: React.ReactNode }> = ({ children }) => <span className="ml-1 text-[11.5px] text-slate-500">({children})</span>;

/** The icon square in front of a condition: opens the kind menu. */
const KindButton: React.FC<{ t: Trigger; onPick: (k: TriggerKind) => void }> = ({ t, onPick }) => {
  const info = KIND_INFO[t.kind];
  const Icon = info.icon;
  return (
    <Dropdown
      label={`Condition kind: ${info.label}. Change`}
      title={`${info.label} (click to change the kind)`}
      look="plain"
      chevron={false}
      width={272}
      className="mt-px grid h-6 w-6 shrink-0 place-items-center rounded-md bg-slate-400/10 text-slate-400 transition-colors duration-150 hover:bg-slate-400/20 hover:text-slate-200 active:scale-[0.97]"
      button={<Icon className="h-[13px] w-[13px]" />}
    >
      {(close) =>
        KIND_GROUPS.map((g) => (
          <React.Fragment key={g.title}>
            <MenuLabel>{g.title}</MenuLabel>
            {g.kinds.map((k) => (
              <MenuItem
                key={k.kind}
                icon={<k.icon />}
                checked={k.kind === t.kind}
                hint={k.hint}
                onSelect={() => {
                  if (k.kind !== t.kind) onPick(k.kind);
                  close();
                }}
              >
                {k.label}
              </MenuItem>
            ))}
          </React.Fragment>
        ))
      }
    </Dropdown>
  );
};

const ConditionRow: React.FC<{
  t: Trigger;
  steps: FlowStep[];
  keyBase: string;
  onChange: (t: Trigger, mergeKey?: string) => void;
  onRemove: () => void;
  onMenu: (e: React.MouseEvent) => void;
}> = ({ t, steps, keyBase, onChange, onRemove, onMenu }) => {
  const rise = useRiseIn();
  return (
    <div className={`group/cond flex items-start gap-2 rounded-lg border border-slate-700/50 bg-slate-950/35 py-1.5 pr-1 pl-1.5 ${rise}`} onContextMenu={onMenu}>
      <KindButton t={t} onPick={(k) => onChange(convertTrigger(t, k))} />
      <div className="min-w-0 flex-1 py-px text-[12.5px] leading-[24px] text-slate-300">
        <Sentence t={t} edit={onChange} steps={steps} keyBase={keyBase} />
      </div>
      <IconButton aria-label="Remove condition" onClick={onRemove} className="h-6 w-6 text-slate-500 hover:text-slate-200">
        <X />
      </IconButton>
    </div>
  );
};

// ---- Groups and lists -----------------------------------------------------------------------------

const Joiner: React.FC<{ match: ConditionMatch }> = ({ match }) => (
  <div className="pl-2.5 text-[10.5px] font-bold tracking-[0.06em] text-slate-500" aria-hidden>
    {match === "any" ? "OR" : "AND"}
  </div>
);

const MATCH_OPTIONS = [
  { value: "all" as const, label: "ALL", title: "Every condition must hold (AND)" },
  { value: "any" as const, label: "ANY", title: "At least one condition must hold (OR)" },
];

const GroupBox: React.FC<{
  group: ConditionGroup;
  steps: FlowStep[];
  depth: number;
  keyBase: string;
  onChange: (g: ConditionGroup, mergeKey?: string) => void;
  onRemove: () => void;
  onMenu: (e: React.MouseEvent) => void;
}> = ({ group, steps, depth, keyBase, onChange, onRemove, onMenu }) => {
  const rise = useRiseIn();
  return (
    <div className={`flex flex-col gap-1.5 rounded-[10px] border border-violet-400/25 bg-violet-500/[0.05] p-2 ${rise}`} onContextMenu={onMenu}>
      <div className="flex items-center gap-2 text-[12px] text-slate-400">
        <Segmented label="Combine this group with" value={group.match} options={MATCH_OPTIONS} onChange={(m) => onChange({ ...group, match: m })} />
        <span>of this group</span>
        <span className="flex-1" />
        <IconButton aria-label="Remove group" onClick={onRemove} className="h-6 w-6 text-slate-500 hover:text-slate-200">
          <X />
        </IconButton>
      </div>
      <ConditionList
        list={group.of}
        match={group.match}
        steps={steps}
        depth={depth + 1}
        keyBase={keyBase}
        empty="An empty group never holds."
        onChange={(of, match, opts) => onChange({ ...group, of, match }, opts?.mergeKey)}
      />
    </div>
  );
};

const ConditionList: React.FC<{
  list: Condition[];
  match: ConditionMatch;
  steps: FlowStep[];
  depth: number;
  keyBase: string;
  empty?: string;
  lead?: React.ReactNode;
  onChange: ConditionChange;
}> = ({ list, match, steps, depth, keyBase, empty, lead, onChange }) => {
  const set = (i: number, c: Condition, mergeKey?: string) => onChange(list.map((x, j) => (j === i ? c : x)), match, mergeKey ? { mergeKey } : undefined);
  const remove = (i: number) => onChange(list.filter((_, j) => j !== i), match);
  const openMenu = useContextMenu();
  const canGroup = depth < MAX_GROUP_DEPTH;
  /** Right-click on an entry: the innermost entry handles it, the exit card and outer groups don't. */
  const menu = (e: React.MouseEvent, i: number) => {
    e.stopPropagation();
    const c = list[i];
    const isGroup = c.kind === "group";
    const other: ConditionMatch = match === "any" ? "all" : "any";
    openMenu(e, [
      { heading: isGroup ? "AND / OR group" : (KIND_INFO[(c as Trigger).kind]?.label ?? "Condition") },
      { label: "Duplicate", icon: <Copy />, onSelect: () => onChange([...list.slice(0, i + 1), structuredClone(c), ...list.slice(i + 1)], match) },
      {
        label: `Wrap in ${other === "any" ? "an OR" : "an AND"} group`,
        icon: <Brackets />,
        disabled: !canGroup,
        title: canGroup ? "Put it in a nested group with its own AND / OR" : `Groups nest up to ${MAX_GROUP_DEPTH} deep`,
        onSelect: () => onChange(list.map((x, j) => (j === i ? { kind: "group", match: other, of: [x] } : x)), match),
      },
      ...(isGroup
        ? [
            {
              label: "Ungroup",
              icon: <Ungroup />,
              title: "Replace the group by its conditions",
              onSelect: () => onChange([...list.slice(0, i), ...(c as ConditionGroup).of, ...list.slice(i + 1)], match),
            },
          ]
        : []),
      { separator: true },
      { label: isGroup ? "Remove group" : "Remove condition", icon: <X />, tone: "danger", onSelect: () => remove(i) },
    ]);
  };
  return (
    <div className="flex flex-col gap-1.5">
      {lead !== undefined && list.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-slate-400">
          <span className="whitespace-nowrap">{lead}</span> <Segmented label="Combine conditions with" value={match} options={MATCH_OPTIONS} onChange={(m) => onChange(list, m)} />{" "}
          <span className="whitespace-nowrap">of these hold</span>
        </div>
      )}
      {list.length === 0 && empty && <p className="px-0.5 text-[12px] text-slate-500">{empty}</p>}
      {list.map((c, i) => (
        <React.Fragment key={i}>
          {i > 0 && <Joiner match={match} />}
          {c.kind === "group" ? (
            <GroupBox group={c} steps={steps} depth={depth} keyBase={`${keyBase}.${i}`} onChange={(g, mk) => set(i, g, mk)} onRemove={() => remove(i)} onMenu={(e) => menu(e, i)} />
          ) : (
            <ConditionRow t={c} steps={steps} keyBase={`${keyBase}.${i}`} onChange={(t, mk) => set(i, t, mk)} onRemove={() => remove(i)} onMenu={(e) => menu(e, i)} />
          )}
        </React.Fragment>
      ))}
      <div className="flex flex-wrap gap-1.5 pt-0.5">
        <KitButton variant="dashed" onClick={() => onChange([...list, defaultTrigger("cycles")], match)}>
          <Plus /> Condition
        </KitButton>
        {depth < MAX_GROUP_DEPTH && (
          <KitButton
            variant="dashed"
            title="A nested set of conditions with its own AND / OR, e.g. (A or B) and C"
            onClick={() => onChange([...list, defaultGroup(match === "any" ? "all" : "any")], match)}
          >
            <Plus /> AND / OR group
          </KitButton>
        )}
      </div>
    </div>
  );
};

/**
 * An exit's conditions. `keyBase` makes the undo merge keys of typed edits (e.g.
 * `cond:<stepId>:<exitIndex>`); `onChange` passes one along for edits made while typing.
 */
export const ConditionEditor: React.FC<{
  list: Condition[];
  match: ConditionMatch | undefined;
  steps: FlowStep[];
  keyBase: string;
  onChange: ConditionChange;
  /** Words in front of the ALL / ANY switch (2+ conditions). */
  lead?: React.ReactNode;
  empty?: string;
}> = ({ list, match, steps, keyBase, onChange, lead = "Take this exit when", empty = "No conditions: this exit is never taken." }) => (
  <RiseScope>
    <ConditionList list={list} match={match ?? "all"} steps={steps} depth={0} keyBase={keyBase} lead={lead} empty={empty} onChange={onChange} />
  </RiseScope>
);

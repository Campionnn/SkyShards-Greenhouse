import React, { useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Copy, Ellipsis, Flag, GripVertical, Plus, Repeat, Trash2, TriangleAlert, Zap } from "lucide-react";
import type { FlowStep, StepExit } from "../../../simulator";
import { CropImage } from "../../shared";
import { useContextMenu } from "../../ui/contextMenuContext";
import { Divider, IconButton, KitButton, Switch } from "../../ui/kit";
import { defaultTrigger } from "../scenarioEdit";
import { ConditionEditor } from "./ConditionEditor";
import { useFlowEditor } from "./context";
import { Dropdown, MenuItem, MenuLabel, MenuSeparator } from "./InspectorPopover";
import { RiseScope, useRiseIn } from "./InspectorMotion";
import { exitTarget } from "./model";
import { conditionSummary, EXIT_STYLE, exitKind, layoutFacts, stepTitle, targetName, type ExitKind } from "./shared";

// The selected step's ways out, as ordered cards: "Go to [step] when [conditions]". Checked top
// to bottom; the first that holds is taken. Drag the grip (or use the ··· menu) to reorder.

/** Card border / tint per exit kind (EXIT_STYLE colours, as Tailwind classes). */
const CARD_TONE: Record<ExitKind, { open: string; rest: string; dot: string }> = {
  normal: { open: "border-emerald-400/30", rest: "border-slate-700/50", dot: "bg-emerald-400" },
  arrive: { open: "border-amber-400/35", rest: "border-amber-400/20", dot: "bg-amber-400" },
  restart: { open: "border-violet-400/35", rest: "border-violet-400/20", dot: "bg-violet-400" },
  finish: { open: "border-slate-400/35", rest: "border-slate-600/50", dot: "bg-slate-300" },
  missing: { open: "border-red-400/45", rest: "border-red-400/35", dot: "bg-red-400" },
};

/** Where a new exit goes: the following step (step 1 after the last), or this step if it is the only one. */
function newExitTarget(steps: FlowStep[], index: number): string {
  return steps[(index + 1) % steps.length].id;
}

export const ExitsTab: React.FC = () => {
  const api = useFlowEditor();
  const i = api.selected;
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  if (i === null || !api.plot.flow.steps[i]) return null;
  const step = api.plot.flow.steps[i];
  const exits = step.exits;

  const setExits = (fn: (exits: StepExit[]) => StepExit[], mergeKey?: string) => api.editStep(i, (s) => ({ ...s, exits: fn(s.exits) }), mergeKey ? { mergeKey } : undefined);
  const move = (from: number, to: number) => {
    if (to < 0 || to >= exits.length || from === to) return;
    setExits((list) => {
      const next = [...list];
      const [e] = next.splice(from, 1);
      next.splice(to, 0, e);
      return next;
    });
    // The open card follows its exit.
    const open = api.openExit;
    if (open === from) api.setOpenExit(to);
    else if (from < open && to >= open) api.setOpenExit(open - 1);
    else if (from > open && to <= open) api.setOpenExit(open + 1);
  };
  const remove = (j: number) => {
    setExits((list) => list.filter((_, k) => k !== j));
    if (api.openExit === j) api.setOpenExit(-1);
    else if (api.openExit > j) api.setOpenExit(api.openExit - 1);
    api.setHotExit(null);
  };
  const add = () => {
    const to = newExitTarget(api.plot.flow.steps, i);
    setExits((list) => [...list, { to, when: [defaultTrigger("cycles")] }]);
    api.setOpenExit(exits.length);
  };
  const duplicate = (j: number) => {
    setExits((list) => [...list.slice(0, j + 1), structuredClone(list[j]), ...list.slice(j + 1)]);
    api.setOpenExit(j + 1);
  };

  // Drop position while dragging: the gap before card `over` (exits.length = after the last).
  const dropAt = drag ? drag.over : -1;
  const finishDrop = () => {
    if (!drag) return;
    const to = drag.over > drag.from ? drag.over - 1 : drag.over;
    setDrag(null);
    move(drag.from, to);
  };

  return (
    <RiseScope>
      <div className="@container">
      <p className="mb-3 text-[12px] leading-relaxed text-slate-500">
        Checked top to bottom whenever the player is online. The first exit whose conditions hold is taken.{exits.length > 1 ? " Drag to change the order." : ""}
      </p>
      {exits.length === 0 && (
        <div className="mb-3 rounded-xl border border-dashed border-slate-700/70 px-4 py-5 text-center text-[12.5px] text-slate-400">
          No exits: the plot stays on this step.
          <div className="mt-0.5 text-[11.5px] text-slate-500">Add one to move on when something happens.</div>
        </div>
      )}
      <div
        onDragOver={(e) => {
          if (drag) e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          finishDrop();
        }}
      >
        {exits.map((exit, j) => (
          <React.Fragment key={j}>
            {j > 0 && <Divider className="my-2">OTHERWISE</Divider>}
            <ExitCard
              stepIndex={i}
              index={j}
              exit={exit}
              count={exits.length}
              open={api.openExit === j}
              dropBefore={dropAt === j && drag !== null && drag.from !== j && drag.from !== j - 1}
              dropAfter={j === exits.length - 1 && dropAt === exits.length && drag !== null && drag.from !== j}
              dragging={drag?.from === j}
              onDragStart={() => setDrag({ from: j, over: j })}
              onDragOverCard={(after) => drag && setDrag({ ...drag, over: after ? j + 1 : j })}
              onDragEnd={() => setDrag(null)}
              onChange={(next, mergeKey) => setExits((list) => list.map((x, k) => (k === j ? next : x)), mergeKey)}
              onMove={(to) => move(j, to)}
              onRemove={() => remove(j)}
              onDuplicate={() => duplicate(j)}
            />
          </React.Fragment>
        ))}
      </div>
      <KitButton variant="dashed" className="mt-3" onClick={add} title={exits.length ? "Another way out, e.g. to a different step under other conditions" : undefined}>
        <Plus /> Add exit
      </KitButton>
      </div>
    </RiseScope>
  );
};

const ExitCard: React.FC<{
  stepIndex: number;
  index: number;
  exit: StepExit;
  count: number;
  open: boolean;
  dropBefore: boolean;
  dropAfter: boolean;
  dragging: boolean;
  onDragStart: () => void;
  onDragOverCard: (after: boolean) => void;
  onDragEnd: () => void;
  onChange: (e: StepExit, mergeKey?: string) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}> = ({ stepIndex, index: j, exit, count, open, dropBefore, dropAfter, dragging, onDragStart, onDragOverCard, onDragEnd, onChange, onMove, onRemove, onDuplicate }) => {
  const api = useFlowEditor();
  const rise = useRiseIn();
  const [armed, setArmed] = useState(false);
  const { plot } = api;
  const steps = plot.flow.steps;
  const step = steps[stepIndex];
  const kind = exitKind(plot, stepIndex, exit);
  const tone = CARD_TONE[kind];
  const hot = api.hotExit?.[0] === stepIndex && api.hotExit[1] === j;
  const summary = `when ${conditionSummary(exit.when, exit.match, steps)}${exit.checkOnEntry ? " · also on arrival" : ""}`;
  const toggle = () => api.setOpenExit(open ? -1 : j);
  const openMenu = useContextMenu();

  return (
    <div
      className={`relative overflow-visible rounded-[11px] border transition-[border-color,background-color,opacity] duration-150 ${
        open ? `${tone.open} bg-slate-800/55` : `${tone.rest} bg-slate-800/35 hover:bg-slate-800/50`
      } ${hot && !open ? "bg-slate-800/55" : ""} ${dragging ? "opacity-40" : ""} ${rise}`}
      draggable={armed}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", `exit ${j + 1}`);
        onDragStart();
      }}
      onDragEnd={() => {
        setArmed(false);
        onDragEnd();
      }}
      onDragOver={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onDragOverCard(e.clientY > r.top + r.height / 2);
      }}
      onMouseEnter={() => api.setHotExit([stepIndex, j])}
      onContextMenu={(e) => {
        // A condition row opens its own menu; this one is for the card.
        if (e.defaultPrevented) return;
        openMenu(e, [
          { heading: `Exit ${j + 1}` },
          { label: open ? "Collapse" : "Edit", icon: <ChevronDown />, onSelect: toggle },
          { label: "Move earlier", icon: <ArrowUp />, disabled: j === 0, onSelect: () => onMove(j - 1) },
          { label: "Move later", icon: <ArrowDown />, disabled: j === count - 1, onSelect: () => onMove(j + 1) },
          { label: "Duplicate", icon: <Copy />, onSelect: onDuplicate },
          {
            label: exit.checkOnEntry ? "Stop checking on arrival" : "Also check on arrival",
            icon: <Zap />,
            onSelect: () => {
              const next: StepExit = { ...exit };
              if (exit.checkOnEntry) delete next.checkOnEntry;
              else next.checkOnEntry = true;
              onChange(next);
            },
          },
          { separator: true },
          { label: "Delete exit", icon: <Trash2 />, tone: "danger", onSelect: onRemove },
        ]);
      }}
      onMouseLeave={() => api.setHotExit(null)}
    >
      {dropBefore && <DropLine className="-top-[9px]" />}
      {dropAfter && <DropLine className="-bottom-[9px]" />}
      <div
        className="flex cursor-pointer items-center gap-1.5 py-2.5 pr-1.5 pl-1"
        onClick={(e) => {
          // Clicks on the header's own controls (target, menu, chevron) don't toggle.
          if ((e.target as HTMLElement).closest("button,input,[role=menu]")) return;
          toggle();
        }}
      >
        <span
          className={`grid h-6 w-4 shrink-0 place-items-center text-slate-600 ${count > 1 ? "cursor-grab hover:text-slate-400 active:cursor-grabbing" : "opacity-40"}`}
          onPointerDown={() => count > 1 && setArmed(true)}
          onPointerUp={() => setArmed(false)}
          aria-hidden
        >
          <GripVertical className="h-3.5 w-3.5" />
        </span>
        <span className="grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-[5px] px-1 text-[10.5px] font-semibold tabular-nums text-slate-400 shadow-[inset_0_0_0_1px_rgba(148,163,184,0.25)]">{j + 1}</span>
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[12.5px] text-slate-400">
          <span className="hidden shrink-0 @[22rem]:inline">Go to</span>
          <TargetPicker stepIndex={stepIndex} exit={exit} onChange={onChange} />
        </span>
        <Dropdown label={`Exit ${j + 1} actions`} look="plain" chevron={false} align="end" width={200} className="hidden h-7 w-6 shrink-0 @[22rem]:grid place-items-center rounded-lg text-slate-500 transition-colors duration-150 hover:bg-slate-700/50 hover:text-slate-200" button={<Ellipsis className="h-3.5 w-3.5" />}>
          {(close) => (
            <>
              <MenuItem icon={<ArrowUp />} disabled={j === 0} onSelect={() => (onMove(j - 1), close())}>
                Check earlier
              </MenuItem>
              <MenuItem icon={<ArrowDown />} disabled={j === count - 1} onSelect={() => (onMove(j + 1), close())}>
                Check later
              </MenuItem>
              <MenuItem icon={<Copy />} onSelect={() => (onDuplicate(), close())}>
                Duplicate exit
              </MenuItem>
              <MenuSeparator />
              <MenuItem icon={<Trash2 />} tone="danger" onSelect={() => (onRemove(), close())}>
                Delete exit
              </MenuItem>
            </>
          )}
        </Dropdown>
        {open && (
          <IconButton aria-label="Delete exit" onClick={onRemove} className="hidden w-6 text-slate-500 hover:text-red-300 @[22rem]:inline-flex">
            <Trash2 />
          </IconButton>
        )}
        <IconButton aria-label={open ? "Collapse exit" : "Edit exit"} aria-expanded={open} onClick={toggle} className="w-6 text-slate-500">
          <ChevronDown className={`transition-transform duration-200 ease-snappy ${open ? "rotate-180" : ""}`} />
        </IconButton>
      </div>
      {open ? (
        <div className="flex flex-col gap-2.5 px-3 pb-3">
          {kind === "missing" && (
            <p className="flex items-center gap-1.5 text-[12px] text-red-300">
              <TriangleAlert className="h-3.5 w-3.5" /> {EXIT_STYLE.missing.help}
            </p>
          )}
          <ConditionEditor
            list={exit.when}
            match={exit.match}
            steps={steps}
            keyBase={`cond:${step.id}:${j}`}
            onChange={(when, m, opts) => {
              const next: StepExit = { ...exit, when };
              if (m === "any") next.match = "any";
              else delete next.match;
              onChange(next, opts?.mergeKey);
            }}
          />
          <ArrivalToggle
            checked={!!exit.checkOnEntry}
            onChange={(v) => {
              const next: StepExit = { ...exit };
              if (v) next.checkOnEntry = true;
              else delete next.checkOnEntry;
              onChange(next);
            }}
          />
        </div>
      ) : (
        <button type="button" onClick={toggle} title={summary} className="-mt-1 block w-full cursor-pointer truncate pr-3 pb-2.5 pl-[50px] text-left text-[12px] text-slate-500">
          {exit.checkOnEntry && <Zap className="mr-1 inline h-3 w-3 -translate-y-px text-amber-400" />}
          {summary}
        </button>
      )}
    </div>
  );
};

const DropLine: React.FC<{ className: string }> = ({ className }) => (
  <span aria-hidden className={`pointer-events-none absolute right-2 left-2 z-10 h-0.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)] ${className}`} />
);

const ArrivalToggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void }> = ({ checked, onChange }) => (
  <div
    className={`flex items-start gap-2.5 rounded-[10px] border px-2.5 py-2.5 transition-colors duration-150 ${
      checked ? "border-amber-400/25 bg-amber-400/[0.06]" : "border-slate-700/50 bg-slate-950/30"
    }`}
  >
    <span className="pt-px">
      <Switch checked={checked} onChange={onChange} label="Also check on arrival" tone="amber" />
    </span>
    <button type="button" className="min-w-0 cursor-pointer text-left" onClick={() => onChange(!checked)}>
      <span className={`flex items-center gap-1 text-[12.5px] font-medium ${checked ? "text-amber-200" : "text-slate-200"}`}>
        <Zap className={`h-3 w-3 ${checked ? "text-amber-400" : "text-slate-500"}`} /> Also check on arrival
      </span>
      <span className="mt-0.5 block text-[11.5px] leading-snug text-slate-500">
        If this already holds when the plot arrives, skip this step entirely: no layout is built and no cycle is spent here.
      </span>
    </button>
  </div>
);

/** "Go to [target ▾]": every step, this step again (restart), and Finish on the last step of a non-looping flow. */
const TargetPicker: React.FC<{ stepIndex: number; exit: StepExit; onChange: (e: StepExit) => void }> = ({ stepIndex, exit, onChange }) => {
  const { plot } = useFlowEditor();
  const steps = plot.flow.steps;
  const t = exitTarget(plot, stepIndex, exit);
  const kind = exitKind(plot, stepIndex, exit);
  const canFinish = !plot.flow.loop && stepIndex === steps.length - 1;
  const name = targetName(plot, stepIndex, t);
  const set = (to: string | undefined) => {
    const next: StepExit = { ...exit };
    if (to === undefined) delete next.to;
    else next.to = to;
    onChange(next);
  };
  const icon =
    t.kind === "step" && t.index !== stepIndex ? (
      <CropImage cropId={layoutFacts(steps[t.index]).icon} cropName="" size="custom" width={16} height={16} showFallback={false} className="shrink-0" />
    ) : t.kind === "finish" ? (
      <Flag className="h-3.5 w-3.5 shrink-0 text-slate-300" />
    ) : t.kind === "missing" ? (
      <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-red-300" />
    ) : (
      <Repeat className="h-3.5 w-3.5 shrink-0 text-violet-300" />
    );
  return (
    <Dropdown
      label="Exit target"
      title={`${name}: ${EXIT_STYLE[kind].help}`}
      width={300}
      className={`${kind === "missing" ? "border-red-400/50 text-red-200" : kind === "restart" ? "text-violet-200" : ""}`}
      button={
        <>
          {icon}
          <span className="truncate">{name}</span>
        </>
      }
    >
      {(close) => (
        <>
          <MenuLabel>Steps</MenuLabel>
          {steps.map((s, k) =>
            k === stepIndex ? null : (
              <MenuItem
                key={s.id}
                checked={t.kind === "step" && t.index === k}
                hint={k === (stepIndex + 1) % steps.length && (k > stepIndex || plot.flow.loop) ? "next in order" : undefined}
                icon={<CropImage cropId={layoutFacts(s).icon} cropName="" size="custom" width={18} height={18} showFallback={false} />}
                onSelect={() => (set(s.id), close())}
              >
                {stepTitle(s, k)}
              </MenuItem>
            )
          )}
          <MenuSeparator />
          <MenuItem
            checked={t.kind === "step" && t.index === stepIndex}
            icon={<Repeat className="text-violet-300" />}
            hint={EXIT_STYLE.restart.help}
            onSelect={() => (set(steps[stepIndex].id), close())}
          >
            This step again (restart)
          </MenuItem>
          {canFinish && (
            <MenuItem checked={t.kind === "finish"} icon={<Flag />} hint={EXIT_STYLE.finish.help} onSelect={() => (set(undefined), close())}>
              Finish (hold this step)
            </MenuItem>
          )}
        </>
      )}
    </Dropdown>
  );
};

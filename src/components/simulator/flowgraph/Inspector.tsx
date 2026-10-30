import React, { useLayoutEffect, useRef, useState } from "react";
import { ClipboardPaste, CodeXml, Copy, CopyPlus, Ellipsis, LayoutGrid, Pencil, Play, Trash2 } from "lucide-react";
import { mergePolicies } from "../../../simulator";
import { CropImage } from "../../shared";
import { IconButton, KitButton, Pill, Switch, Tabs } from "../../ui/kit";
import { useContextMenu } from "../../ui/contextMenuContext";
import { ActionsTab } from "./ActionsTab";
import { stepMenu } from "./CanvasMenus";
import { useFlowEditor, type InspectorTab } from "./context";
import { ExitsTab } from "./ExitsTab";
import { overrideCount } from "./InspectorFields";
import { Dropdown, MenuItem, MenuSeparator } from "./InspectorPopover";
import { NotesTab } from "./NotesTab";
import { PlotSettings } from "./PlotSettings";
import { layoutFacts, stepLabel } from "./shared";
import { TargetsTab } from "./TargetsTab";

// The flow editor's right-hand panel. With a step selected: its header (icon, label, facts), the
// step actions and tabs (Exits, Checked targets, Actions, Notes). With nothing selected: the plot
// settings. Every change goes through the editor api (api.edit / api.editStep).

export const Inspector: React.FC<{ className?: string }> = ({ className = "" }) => {
  const api = useFlowEditor();
  const i = api.selected;
  const step = i === null ? undefined : api.plot.flow.steps[i];
  return (
    <aside aria-label={step ? "Step inspector" : "Plot settings"} className={`@container flex min-h-0 flex-col border-l border-slate-700/60 bg-slate-900 ${className}`}>
      {i === null || !step ? (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-dark">
          <PlotSettings />
        </div>
      ) : (
        <StepInspector index={i} />
      )}
    </aside>
  );
};

const StepInspector: React.FC<{ index: number }> = ({ index: i }) => {
  const api = useFlowEditor();
  const { plot } = api;
  const steps = plot.flow.steps;
  const step = steps[i];
  const facts = layoutFacts(step);
  const isStart = plot.flow.startIndex === i;
  const targets = facts.targets.reduce((n, [, c]) => n + c, 0);
  const checked = step.watch === undefined ? targets : step.watch.length;
  const overrides = overrideCount(step.policies);
  const scriptOn = !!plot.script?.source.trim() && plot.script.enabled !== false;
  const scriptLines = plot.script?.source.split("\n").length ?? 0;
  const bodyRef = useRef<HTMLDivElement>(null);
  const openMenu = useContextMenu();

  // A new step or tab starts at the top.
  useLayoutEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [step.id, api.tab]);

  const tabs: { value: InspectorTab; label: React.ReactNode; count?: number | null }[] = [
    { value: "exits", label: "Exits", count: step.exits.length },
    {
      value: "targets",
      label: (
        <span className="whitespace-nowrap">
          <span className="hidden @[24rem]:inline">Checked t</span>
          <span className="@[24rem]:hidden">T</span>argets
        </span>
      ),
      count: targets ? checked : null,
    },
    { value: "actions", label: "Actions", count: overrides },
    { value: "notes", label: "Notes", count: null },
  ];

  return (
    <>
      <header className="shrink-0 px-4 pt-4">
        <div
          className="flex items-start gap-3"
          onContextMenu={(e) => {
            // The name field keeps the browser menu while typing.
            if ((e.target as HTMLElement).closest("input")) return;
            openMenu(e, stepMenu(api, i));
          }}
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-slate-800 shadow-[inset_0_0_0_1px_rgba(148,163,184,0.12)]">
            <CropImage cropId={facts.icon} cropName={stepLabel(step)} size="custom" width={28} height={28} showFallback={false} />
          </span>
          <div className="min-w-0 flex-1">
            <StepName key={step.id} index={i} />
            <p className="mt-0.5 text-[12px] tabular-nums text-slate-500">
              Step {i + 1} of {steps.length}
              {isStart && <span className="text-emerald-400/90"> · start step</span>} · {facts.plants} {facts.plants === 1 ? "plant" : "plants"}, {targets}{" "}
              {targets === 1 ? "target" : "targets"}
              {!facts.ok && <span className="text-red-300"> · layout unreadable</span>}
            </p>
            {scriptOn && api.openScript && (
              <button
                type="button"
                onClick={() => api.openScript!("plot")}
                title={`This plot has a script (${scriptLines} line${scriptLines === 1 ? "" : "s"}): it can move the plot between steps. Click to edit it.`}
                className="mt-1.5 inline-flex cursor-pointer items-center gap-1 rounded-md bg-sky-400/10 px-1.5 py-0.5 text-[11px] font-medium text-sky-300 transition-colors duration-150 hover:bg-sky-400/20 active:scale-[0.97]"
              >
                <CodeXml className="h-3 w-3" /> Plot script
              </button>
            )}
          </div>
        </div>
        <div className="mt-3 flex items-center gap-1">
          <KitButton variant="accent" onClick={() => api.openLayout(i)}>
            <LayoutGrid /> Edit layout
          </KitButton>
          {isStart ? (
            <Pill tone="emerald" strong className="ml-1 h-7 px-2" title="The plot begins the run on this step">
              <Play className="fill-current" /> START
            </Pill>
          ) : (
            <KitButton onClick={() => api.setStart(i)} title="Begin the run on this step" aria-label="Set as start">
              <Play /> <span className="hidden @[21rem]:inline">Set as start</span>
            </KitButton>
          )}
          <span className="flex-1" />
          <IconButton aria-label="Duplicate step" variant="neutral" onClick={() => api.duplicateStep(i)}>
            <Copy />
          </IconButton>
          <StepMenu index={i} />
          <IconButton
            aria-label="Delete step"
            title={steps.length <= 1 ? "A flow needs at least one step" : "Delete step"}
            variant="neutral"
            disabled={steps.length <= 1}
            onClick={() => api.deleteStep(i)}
            className="hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300"
          >
            <Trash2 />
          </IconButton>
        </div>
        <label className="mt-3 flex cursor-pointer items-center gap-2.5 rounded-lg border border-slate-700/50 bg-slate-950/30 px-2.5 py-2" title="Break every plant when the plot enters this step">
          <Switch checked={!!step.fullClear} onChange={(v) => api.editStep(i, (s) => fullClear(s, v))} label="Full clear on entry" />
          <span className="min-w-0 flex-1 text-[12.5px] text-slate-200">
            Full clear on entry
            <span className="block text-[11.5px] text-slate-500 @[25rem]:ml-1.5 @[25rem]:inline">{step.fullClear ? "every plant is broken first" : "otherwise identical plants are kept"}</span>
          </span>
        </label>
        <Tabs className="mt-3 @max-[23rem]:[&>button]:px-1.5" value={api.tab} onChange={api.setTab} items={tabs} />
      </header>
      <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3.5 pb-6 scrollbar-dark" role="tabpanel">
        {api.tab === "exits" && <ExitsTab />}
        {api.tab === "targets" && <TargetsTab />}
        {api.tab === "actions" && (
          <ActionsTab
            value={step.policies}
            onChange={(policies) =>
              api.editStep(i, (s) => {
                const next = { ...s };
                if (policies) next.policies = policies;
                else delete next.policies;
                return next;
              })
            }
            inherited={mergePolicies(api.scenario.settings.policies, plot.policies)}
            inheritsFrom={plot.policies ? "the plot" : "the scenario defaults"}
            hint="What the player does while this step is active. Everything not overridden follows the plot, then the scenario defaults."
          />
        )}
        {api.tab === "notes" && <NotesTab />}
      </div>
    </>
  );
};

function fullClear<T extends { fullClear?: boolean }>(s: T, v: boolean): T {
  const next = { ...s };
  if (v) next.fullClear = true;
  else delete next.fullClear;
  return next;
}

/** The step label: click to edit, Enter or blur commits, Escape cancels. */
const StepName: React.FC<{ index: number }> = ({ index: i }) => {
  const api = useFlowEditor();
  const step = api.plot.flow.steps[i];
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (draft !== null) inputRef.current?.select();
    // Only when editing starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft !== null]);

  const commit = () => {
    if (draft === null) return;
    const label = draft.trim();
    setDraft(null);
    if (label === (step.label ?? "")) return;
    api.editStep(
      i,
      (s) => {
        const next = { ...s };
        if (label) next.label = label;
        else delete next.label;
        return next;
      },
      { mergeKey: `label:${step.id}` }
    );
  };

  if (draft !== null)
    return (
      <input
        ref={inputRef}
        value={draft}
        aria-label="Step name"
        placeholder={step.id}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          else if (e.key === "Escape") {
            e.preventDefault();
            setDraft(null);
          }
        }}
        className="-mx-1.5 -my-0.5 w-[calc(100%+12px)] rounded-md border border-emerald-500/50 bg-slate-950/60 px-1.5 py-0.5 text-[15px] font-semibold leading-[1.3] text-slate-100 outline-none"
      />
    );
  return (
    <button
      type="button"
      onClick={() => setDraft(step.label ?? "")}
      title="Rename step"
      className="group/name -mx-1.5 -my-0.5 flex w-[calc(100%+12px)] cursor-text items-start gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-left transition-colors duration-150 hover:bg-slate-400/[0.07]"
    >
      <span className={`min-w-0 flex-1 text-[15px] font-semibold leading-[1.3] ${step.label?.trim() ? "text-slate-100" : "text-slate-500"}`}>{stepLabel(step)}</span>
      <Pencil className="mt-1 h-3 w-3 shrink-0 text-slate-500 opacity-0 transition-opacity duration-150 group-hover/name:opacity-100" />
    </button>
  );
};

/** The step's ··· menu: copy / paste, the plot's scripts. */
const StepMenu: React.FC<{ index: number }> = ({ index: i }) => {
  const api = useFlowEditor();
  const hasScript = !!api.plot.script?.source.trim();
  return (
    <Dropdown
      label="More step actions"
      title="More"
      look="plain"
      chevron={false}
      align="end"
      width={230}
      className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-slate-600/40 bg-slate-800/60 text-slate-200 transition-[background-color,transform] duration-150 ease-snappy hover:bg-slate-700/70 active:scale-[0.97]"
      button={<Ellipsis className="h-3.5 w-3.5" />}
    >
      {(close) => (
        <>
          <MenuItem icon={<Copy />} onSelect={() => (api.copyStep(i), close())} hint="Ctrl C · paste into any plot">
            Copy step
          </MenuItem>
          <MenuItem icon={<ClipboardPaste />} disabled={!api.pasteStep} onSelect={() => (api.pasteStep?.(), close())} hint={api.pasteStep ? "Ctrl V" : "Nothing copied yet"}>
            Paste step
          </MenuItem>
          <MenuItem icon={<CopyPlus />} onSelect={() => (api.duplicateStep(i), close())} hint="Ctrl D">
            Duplicate
          </MenuItem>
          {api.openScript && (
            <>
              <MenuSeparator />
              <MenuItem icon={<CodeXml />} onSelect={() => (api.openScript!("plot"), close())}>
                {hasScript ? "Edit plot script" : "Write a plot script"}
              </MenuItem>
              <MenuItem icon={<CodeXml />} onSelect={() => (api.openScript!("controller"), close())}>
                Controller script
              </MenuItem>
            </>
          )}
        </>
      )}
    </Dropdown>
  );
};
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronUp, Code2, Copy, FolderInput, Plus, Redo2, Repeat, Trash2, Undo2, Wand2 } from "lucide-react";
import { defaultGameData, MAX_PLOTS, validateScenario, type FlowStep, type Scenario, type ScenarioPlot } from "../../../simulator";
import { useToast } from "../../ui";
import { IconButton, KitButton } from "../../ui/kit";
import { ContextMenuProvider } from "../../ui/ContextMenu";
import { useContextMenu } from "../../ui/contextMenuContext";
import { addPlot, blankStep, deleteStep as deleteStepRefs, duplicatePlot, newStepId, nextPlotId, pruneWatch, removePlot, transformWatch } from "../scenarioEdit";
import { AddStepMenu } from "./AddStepMenu";
import { withLayout, NODE_W } from "./autoLayout";
import { FlowCanvas } from "./Canvas";
import { BUSY_WIRES, FlowEditorContext, type AddMenuRequest, type AddStepRequest, type CanvasHandle, type FlowEditorApi, type InspectorTab } from "./context";
import { useHistory } from "./history";
import { Inspector } from "./Inspector";
import { IssuesButton } from "./InspectorIssues";
import { LayoutWorkspace } from "./LayoutWorkspace";
import { exitTarget, explicitExits, hasPositions, insertStep, setLoop, snap, withStepUi } from "./model";
import { stepLabel, stepTitle } from "./shared";
import { StepList } from "./StepList";
import { StepRail } from "./StepRail";
import { ResizeHandle } from "./ResizeHandle";

// The graph flow editor: a full-screen workspace for one plot's flow. Left: the step list.
// Middle: the canvas (steps as nodes, exits as wires). Right: the inspector for the selection.
// Phones get a list of step cards and the inspector as a full-screen sheet.
//
// The editor shows (and writes) every exit with an explicit target and every step with a
// canvas position; both are behaviour-neutral (model.ts), so opening the editor never restarts
// a run. See docs/simulator/UI-CONVENTIONS.md.

const DATA = defaultGameData();

/** The plot as the editor shows it: explicit exits, a position for every step. */
function normalize(p: ScenarioPlot): ScenarioPlot {
  const explicit = explicitExits(p);
  return hasPositions(explicit) ? explicit : withLayout(explicit);
}

function useIsPhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const on = () => setPhone(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return phone;
}

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};

export const FlowGraphEditor: React.FC<{
  scenario: Scenario;
  plotId: number;
  onChange: (sc: Scenario) => void;
  onClose: () => void;
  /** Switch to another plot's flow (top bar). */
  onSwitchPlot?: (plotId: number) => void;
  /** Step selected when the editor opens (e.g. one just added from another page). */
  initialStep?: number;
  /** Open the script editor (this plot's script, or the controller). */
  onEditScript?: (target: number | "controller") => void;
  /** Open the layout picker (adds a plot from a layout). */
  onLoadLayout?: () => void;
}> = (props) => (
  <ContextMenuProvider>
    <FlowGraphEditorBody {...props} />
  </ContextMenuProvider>
);

/** Remembered panel widths. */
const PANEL_KEY = "skyshards-flow-editor-panels";
const RAIL = { def: 232, min: 180, max: 420 };
const INSP = { def: 400, min: 320, max: 640 };
function loadPanels(): { rail: number; insp: number } {
  try {
    const v = JSON.parse(localStorage.getItem(PANEL_KEY) ?? "null");
    if (v && typeof v.rail === "number" && typeof v.insp === "number") return { rail: v.rail, insp: v.insp };
  } catch {
    // Missing or corrupt: defaults.
  }
  return { rail: RAIL.def, insp: INSP.def };
}

/** A copied step, shared across plots while the page is open. */
let clipboard: FlowStep | null = null;

const FlowGraphEditorBody: React.FC<React.ComponentProps<typeof FlowGraphEditor>> = ({ scenario, plotId, onChange, onClose, onSwitchPlot, initialStep = 0, onEditScript, onLoadLayout }) => {
  const { toast } = useToast();
  const openMenu = useContextMenu();
  const raw = scenario.plots.find((p) => p.id === plotId) ?? null;
  const plot = useMemo(() => (raw ? normalize(raw) : null), [raw]);
  const phone = useIsPhone();
  const history = useHistory<ScenarioPlot>(plotId);

  const [selected, setSelected] = useState<number | null>(initialStep);
  const [tab, setTab] = useState<InspectorTab>("exits");
  const [openExit, setOpenExit] = useState(0);
  const [hotExit, setHotExit] = useState<[number, number] | null>(null);
  const [showAllWires, setShowAllWires] = useState(false);
  const [menu, setMenu] = useState<AddMenuRequest | null>(null);
  const [layoutOf, setLayoutOf] = useState<number | null>(null);
  const [sheet, setSheet] = useState(false);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const canvasRef = useRef<CanvasHandle | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [panels, setPanels] = useState(() => (typeof localStorage === "undefined" ? { rail: RAIL.def, insp: INSP.def } : loadPanels()));
  const [, setClipTick] = useState(0);
  useEffect(() => {
    try {
      localStorage.setItem(PANEL_KEY, JSON.stringify(panels));
    } catch {
      // Private mode: widths just aren't remembered.
    }
  }, [panels]);

  // Switching plots keeps this editor mounted (no flash, the canvas fades between plots); reset
  // the per-plot view state.
  const lastPlot = useRef(plotId);
  useEffect(() => {
    if (lastPlot.current === plotId) return;
    lastPlot.current = plotId;
    setSelected(initialStep);
    setOpenExit(0);
    setHotExit(null);
    setShowAllWires(false);
    setMenu(null);
    setLayoutOf(null);
    setIssuesOpen(false);
  }, [plotId, initialStep]);

  // Latest values for callbacks handed to the canvas (which keeps them across renders).
  const live = useRef({ scenario, plot, onChange });
  live.current = { scenario, plot, onChange };

  // Write the normalized plot back once, so positions and explicit exits are saved even if the
  // user only looks. Behaviour-neutral: the page's engine key ignores both.
  useEffect(() => {
    if (raw && plot && raw !== plot) onChange({ ...scenario, plots: scenario.plots.map((p) => (p.id === plotId ? plot : p)) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plotId]);

  const write = useCallback((next: ScenarioPlot) => {
    const { scenario: sc, onChange: change } = live.current;
    change({ ...sc, plots: sc.plots.map((p) => (p.id === plotId ? next : p)) });
  }, [plotId]);

  const edit = useCallback<FlowEditorApi["edit"]>(
    (fn, opts) => {
      const cur = live.current.plot;
      if (!cur) return;
      const next = normalize(fn(structuredClone(cur)));
      history.push(cur, opts?.mergeKey ?? (opts?.uiOnly ? "ui" : undefined));
      write(next);
    },
    [history, write]
  );

  const editStep = useCallback<FlowEditorApi["editStep"]>(
    (index, fn, opts) =>
      edit((p) => {
        if (p.flow.steps[index]) p.flow.steps[index] = fn(p.flow.steps[index]);
        return p;
      }, opts),
    [edit]
  );

  const select = useCallback((i: number | null) => {
    setSelected(i);
    setOpenExit(0);
  }, []);

  const addStep = useCallback<FlowEditorApi["addStep"]>(
    (req: AddStepRequest) => {
      const cur = live.current.plot!;
      const steps = cur.flow.steps;
      const src = req.from ? steps[req.from[0]] : req.after !== undefined ? steps[req.after] : null;
      // A wire dropped from an exit: the new step goes "in between", continuing to that exit's old target.
      const oldTarget = req.from && req.from[1] !== undefined ? exitTarget(cur, req.from[0], steps[req.from[0]].exits[req.from[1]]) : null;
      let step: FlowStep;
      if (req.duplicateOf !== undefined) {
        const orig = steps[req.duplicateOf];
        step = { ...structuredClone(orig), id: newStepId(steps), label: `${stepLabel(orig)} (copy)` };
      } else {
        const blank = blankStep(steps);
        step = { ...blank, label: req.label ?? "New step", layout: req.layout ?? blank.layout };
      }
      // Where it sits: where asked, else right of its source, else right of everything.
      const base = req.at ?? (src?.ui ? { x: src.ui.x + NODE_W + 110, y: src.ui.y + (req.duplicateOf !== undefined ? 40 : 0) } : null);
      const pos = base ?? { x: Math.max(0, ...steps.map((s) => (s.ui?.x ?? 0) + NODE_W + 110)), y: Math.min(...steps.map((s) => s.ui?.y ?? 0)) };
      step = withStepUi(step, { x: snap(pos.x), y: snap(pos.y), note: step.ui?.note, frame: step.ui?.frame ?? src?.ui?.frame, frameColor: step.ui?.frameColor ?? src?.ui?.frameColor });

      const after = req.from ? req.from[0] : req.after ?? req.duplicateOf;
      const { plot: inserted, index } = insertStep(cur, step, after);
      const next = structuredClone(inserted);
      if (req.duplicateOf === undefined) {
        // Default way out: on to where the wire went before, else the step that now follows.
        const follow = oldTarget?.kind === "step" ? oldTarget.id : next.flow.steps[index + 1]?.id ?? (next.flow.loop ? next.flow.steps[0].id : undefined);
        next.flow.steps[index].exits = follow ? [{ to: follow, when: [{ kind: "cycles", n: 20 }] }] : [];
      }
      if (req.from) {
        const fi = req.from[0] >= index ? req.from[0] + 1 : req.from[0];
        const fromStep = next.flow.steps[fi];
        if (req.from[1] !== undefined && fromStep.exits[req.from[1]]) fromStep.exits[req.from[1]] = { ...fromStep.exits[req.from[1]], to: step.id };
        else fromStep.exits.push({ to: step.id, when: [{ kind: "cycles", n: 20 }] });
      }
      history.push(cur);
      write(normalize(next));
      setSelected(index);
      setTab("exits");
      setOpenExit(0);
      setMenu(null);
      requestAnimationFrame(() => canvasRef.current?.focusStep(index));
      return index;
    },
    [history, write]
  );

  const deleteStep = useCallback(
    (index: number) => {
      const cur = live.current.plot!;
      if (cur.flow.steps.length <= 1) return;
      const gone = cur.flow.steps[index];
      const startId = cur.flow.steps[cur.flow.startIndex].id;
      let next = deleteStepRefs(cur, index);
      const start = next.flow.steps.findIndex((s) => s.id === startId);
      next = { ...next, flow: { ...next.flow, startIndex: start >= 0 ? start : Math.min(index, next.flow.steps.length - 1) } };
      history.push(cur);
      write(normalize(next));
      setSelected(null);
      toast({
        title: `Deleted "${stepLabel(gone)}"`,
        description: "Exits that led to it were removed.",
        duration: 6000,
        action: { label: "Undo", onClick: () => write(cur) },
      });
    },
    [history, write, toast]
  );

  const duplicateStep = useCallback((index: number) => void addStep({ duplicateOf: index }), [addStep]);

  // ---- Plot-level actions (top bar plot tabs + their context menu) ----------------------------
  const switchPlot = useCallback((id: number) => onSwitchPlot?.(id), [onSwitchPlot]);
  const addEmptyPlot = () => {
    const sc = live.current.scenario;
    const id = nextPlotId(sc);
    if (id === null) return;
    onChange(addPlot(sc));
    onSwitchPlot?.(id);
  };
  const duplicateThisPlot = (id: number) => {
    const sc = live.current.scenario;
    const to = nextPlotId(sc);
    if (to === null) return;
    onChange(duplicatePlot(sc, id));
    onSwitchPlot?.(to);
    toast({ title: `Duplicated Plot ${id} as Plot ${to}`, duration: 4000 });
  };
  const removeThisPlot = (id: number) => {
    const sc = live.current.scenario;
    if (sc.plots.length <= 1) return;
    const next = removePlot(sc, id);
    if (id === plotId) onSwitchPlot?.(next.plots[0].id);
    onChange(next);
    toast({ title: `Removed Plot ${id}`, duration: 6000, action: { label: "Undo", onClick: () => onChange(sc) } });
  };
  const plotMenu = (e: React.MouseEvent, id: number) => {
    const sc = live.current.scenario;
    const full = sc.plots.length >= MAX_PLOTS;
    openMenu(e, [
      { heading: `Plot ${id}` },
      ...(id !== plotId ? [{ label: "Open", onSelect: () => switchPlot(id) }] : []),
      { label: "Duplicate plot", icon: <Copy />, disabled: full, title: full ? "All three plots are in use" : undefined, onSelect: () => duplicateThisPlot(id) },
      ...(onEditScript ? [{ label: "Edit plot script", icon: <Code2 />, onSelect: () => onEditScript(id) }] : []),
      { separator: true },
      { label: "Remove plot", icon: <Trash2 />, tone: "danger" as const, disabled: sc.plots.length <= 1, onSelect: () => removeThisPlot(id) },
    ]);
  };

  const copyStep = useCallback((index: number) => {
    const s = live.current.plot?.flow.steps[index];
    if (!s) return;
    clipboard = structuredClone(s);
    setClipTick((n) => n + 1);
    toast({ title: `Copied "${stepLabel(s)}"`, description: "Paste it with Ctrl V, here or in another plot.", duration: 2500 });
  }, [toast]);
  const pasteStep = useCallback(
    (at?: { x: number; y: number }) => {
      const cur = live.current.plot;
      if (!cur || !clipboard) return;
      const steps = cur.flow.steps;
      // Exits pointing at steps this plot doesn't have are dropped (a plot never references another).
      const ids = new Set(steps.map((s) => s.id));
      const id = newStepId(steps);
      const copy: FlowStep = { ...structuredClone(clipboard), id, label: `${stepLabel(clipboard)} (copy)`, exits: clipboard.exits.filter((x) => x.to === undefined || ids.has(x.to) || x.to === clipboard!.id).map((x) => (x.to === clipboard!.id ? { ...x, to: id } : x)) };
      const pos = at ?? { x: Math.max(0, ...steps.map((s) => (s.ui?.x ?? 0))) + NODE_W + 110, y: Math.min(...steps.map((s) => s.ui?.y ?? 0)) };
      const placed = withStepUi(copy, { x: snap(pos.x), y: snap(pos.y), note: copy.ui?.note, frame: copy.ui?.frame, frameColor: copy.ui?.frameColor });
      const { plot: inserted, index } = insertStep(cur, placed);
      history.push(cur);
      write(normalize(inserted));
      setSelected(index);
      requestAnimationFrame(() => canvasRef.current?.focusStep(index));
    },
    [history, write]
  );
  const setStart = useCallback((index: number) => edit((p) => ({ ...p, flow: { ...p.flow, startIndex: index } })), [edit]);

  const undo = useCallback(() => {
    const cur = live.current.plot;
    if (!cur) return;
    const prev = history.undo(cur);
    if (prev) write(prev);
  }, [history, write]);
  const redo = useCallback(() => {
    const cur = live.current.plot;
    if (!cur) return;
    const next = history.redo(cur);
    if (next) write(next);
  }, [history, write]);

  const totalExits = plot?.flow.steps.reduce((n, s) => n + s.exits.length, 0) ?? 0;

  const api = useMemo<FlowEditorApi | null>(
    () =>
      plot && {
        scenario,
        plot,
        plotId,
        selected: selected !== null && selected < plot.flow.steps.length ? selected : null,
        select,
        tab,
        setTab,
        openExit,
        setOpenExit,
        hotExit,
        setHotExit,
        edit,
        editStep,
        addStep,
        deleteStep,
        duplicateStep,
        openAddMenu: setMenu,
        openLayout: setLayoutOf,
        focusStep: (i) => canvasRef.current?.focusStep(i),
        registerCanvas: (c) => (canvasRef.current = c),
        scripted: !!raw?.script?.source.trim(),
        showAllWires: showAllWires || totalExits < BUSY_WIRES,
        setShowAllWires,
        openScript: onEditScript ? (target) => onEditScript(target === "controller" ? "controller" : plotId) : undefined,
        dismissOverlays: () => {
          setIssuesOpen(false);
          setMenu(null);
        },
        setStart,
        copyStep,
        pasteStep: clipboard ? pasteStep : null,
        switchPlot,
      },
    [scenario, plot, plotId, selected, select, tab, openExit, hotExit, edit, editStep, addStep, deleteStep, duplicateStep, raw, showAllWires, totalExits, onEditScript, setStart, copyStep, pasteStep, switchPlot]
  );

  // Problems the simulator reports for this plot, clickable to their step.
  const issues = useMemo(() => {
    if (!plot) return [];
    try {
      return validateScenario({ ...scenario, plots: [plot], settings: { ...scenario.settings, config: { ...scenario.settings.config, plotOrder: [plot.id] } } }, DATA).map((i) => {
        const m = /Step (\d+)/.exec(i.path);
        return { ...i, step: m ? Number(m[1]) - 1 : null };
      });
    } catch {
      return [];
    }
  }, [scenario, plot]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (layoutOf !== null || menu || e.defaultPrevented) return;
      // The script editor or a dialog opened over the flow editor owns the keys.
      if (document.querySelector('[aria-label="Script editor"], dialog[open], [role="dialog"][aria-label^="Load"], [role="dialog"][aria-label^="Replace"]')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !isTyping(e.target) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && !isTyping(e.target) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if (mod && !isTyping(e.target) && e.key.toLowerCase() === "d" && selected !== null) {
        e.preventDefault();
        duplicateStep(selected);
      } else if (mod && !isTyping(e.target) && e.key.toLowerCase() === "c" && selected !== null && !window.getSelection()?.toString()) {
        e.preventDefault();
        copyStep(selected);
      } else if (mod && !isTyping(e.target) && e.key.toLowerCase() === "v" && clipboard) {
        e.preventDefault();
        pasteStep();
      } else if (e.key === "/" && !isTyping(e.target)) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "Escape" && !isTyping(e.target)) {
        if (issuesOpen) setIssuesOpen(false);
        else if (sheet) setSheet(false);
        else if (selected !== null) select(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [layoutOf, menu, undo, redo, selected, duplicateStep, select, sheet, issuesOpen, copyStep, pasteStep]);

  if (!plot || !api) return null;
  const steps = plot.flow.steps;
  const layoutStep = layoutOf !== null ? steps[layoutOf] : null;

  return (
    <FlowEditorContext.Provider value={api}>
      <div className="fixed inset-0 z-40 flex flex-col bg-slate-950 text-slate-200 kit-fade-in" role="dialog" aria-modal="true" aria-label={`Plot ${plotId} flow editor`}>
        {/* Top bar */}
        <header className="relative z-20 flex h-[52px] shrink-0 items-center gap-1.5 border-b border-slate-700/60 bg-gradient-to-b from-slate-900 to-[#0d1526] px-2 sm:gap-2.5 sm:px-3">
          <KitButton variant="ghost" onClick={onClose} aria-label="Back to the simulator" className="px-2 sm:px-2.5">
            <ArrowLeft /> <span className="hidden sm:inline">Simulator</span>
          </KitButton>
          <span className="hidden h-6 w-px bg-slate-700/70 sm:block" aria-hidden />
          {/* Plot tabs: switch without leaving (no remount, no flash), right-click for plot actions, + to add one. */}
          <div className="flex shrink-0 items-center gap-1 rounded-[10px] border border-slate-700/60 bg-slate-950/70 p-[3px]" role="tablist" aria-label="Plots">
            {scenario.plots.map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={p.id === plotId}
                title={`Plot ${p.id}: ${p.flow.steps.length} step${p.flow.steps.length === 1 ? "" : "s"}${p.script?.source.trim() ? ", scripted" : ""} · right-click for more`}
                onClick={() => p.id !== plotId && switchPlot(p.id)}
                onContextMenu={(e) => plotMenu(e, p.id)}
                className={`flex cursor-pointer items-center gap-1.5 rounded-[7px] px-2 py-1 text-[12.5px] font-medium transition-colors duration-150 sm:px-2.5 ${
                  p.id === plotId ? "bg-slate-800 text-slate-100 shadow-[inset_0_0_0_1px_rgba(148,163,184,0.15),0_1px_2px_rgba(0,0,0,0.4)]" : "text-slate-500 hover:text-slate-300"
                }`}
              >
                <span className="sm:hidden">P{p.id}</span>
                <span className="hidden sm:inline">Plot {p.id}</span>
                <span className="hidden text-[11px] tabular-nums text-slate-500 sm:inline">{p.flow.steps.length}</span>
                {p.script?.source.trim() && <Code2 className="hidden h-3 w-3 text-sky-400/80 sm:block" aria-label="scripted" />}
              </button>
            ))}
            {scenario.plots.length < MAX_PLOTS && (
              <button
                type="button"
                aria-label="Add a plot"
                title="Add a plot (right-click: from a layout)"
                onClick={(e) =>
                  openMenu({ clientX: e.currentTarget.getBoundingClientRect().left, clientY: e.currentTarget.getBoundingClientRect().bottom + 6, preventDefault: () => {} }, [
                    { heading: `Plot ${nextPlotId(scenario)}` },
                    { label: "Empty plot", icon: <Plus />, onSelect: addEmptyPlot },
                    { label: `Copy of Plot ${plotId}`, icon: <Copy />, onSelect: () => duplicateThisPlot(plotId) },
                    ...(onLoadLayout ? [{ label: "From a layout…", icon: <FolderInput />, onSelect: onLoadLayout }] : []),
                  ])
                }
                className="grid h-[26px] w-[26px] cursor-pointer place-items-center rounded-[7px] text-slate-500 transition-colors duration-150 hover:bg-slate-800 hover:text-slate-200"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="ml-1 hidden min-w-0 flex-col leading-tight md:flex">
            <span className="truncate text-[13.5px] font-semibold text-slate-100">Plot {plotId} flow</span>
            <span className="truncate text-[11.5px] text-slate-500">
              {steps.length} step{steps.length === 1 ? "" : "s"} · {plot.flow.loop ? "loops back to step 1" : "stops at the end"} · shared clock &amp; inventory
            </span>
          </div>
          <span className="min-w-0 flex-1" />
          <IssuesButton
            issues={issues}
            open={issuesOpen}
            onOpenChange={setIssuesOpen}
            stepName={(i) => (steps[i] ? stepTitle(steps[i], i) : null)}
            onPick={(i) => {
              if (i.step !== null && i.step < steps.length) {
                select(i.step);
                setTab("exits");
                if (phone) setSheet(true);
                else canvasRef.current?.focusStep(i.step);
              }
              setIssuesOpen(false);
            }}
          />
          <KitButton
            variant={plot.flow.loop ? "accent" : "neutral"}
            aria-pressed={plot.flow.loop}
            onClick={() => edit((p) => setLoop(p, !p.flow.loop))}
            title={plot.flow.loop ? "After the last step the plot goes back to step 1. Click to stop at the end instead." : "The flow stops at the end. Click to loop back to step 1."}
            className="max-sm:hidden"
          >
            <Repeat /> {plot.flow.loop ? "Loops to step 1" : "No loop"}
          </KitButton>
          <KitButton onClick={() => edit((p) => withLayout(p, { all: true }), { uiOnly: true })} title="Arrange every step automatically (undo puts them back)" className="max-lg:hidden">
            <Wand2 /> Tidy up
          </KitButton>
          <div className="flex items-center rounded-lg border border-slate-700/50 bg-slate-800/30">
            <IconButton aria-label="Undo (Ctrl Z)" disabled={!history.canUndo} onClick={undo} className="rounded-r-none">
              <Undo2 />
            </IconButton>
            <span className="h-4 w-px bg-slate-700/60" aria-hidden />
            <IconButton aria-label="Redo (Ctrl Shift Z)" disabled={!history.canRedo} onClick={redo} className="rounded-l-none">
              <Redo2 />
            </IconButton>
          </div>
          <KitButton variant="primary" onClick={onClose} className="px-3">
            Done
          </KitButton>
        </header>

        {phone ? (
          <div className="relative flex min-h-0 flex-1 flex-col">
            <StepList
              onOpen={(i) => {
                select(i);
                setSheet(true);
              }}
              onOpenPlot={() => {
                select(null);
                setSheet(true);
              }}
            />
            {sheet && (
              <div className="absolute inset-0 z-20 flex flex-col bg-slate-900 kit-rise-in" role="dialog" aria-modal="true" aria-label={api.selected !== null ? `Step ${api.selected + 1}` : "Plot settings"}>
                <div className="flex h-12 shrink-0 items-center gap-1 border-b border-slate-700/60 bg-slate-900/95 pr-2 pl-1">
                  <KitButton variant="ghost" size="md" onClick={() => setSheet(false)} className="px-2">
                    <ArrowLeft /> Steps
                  </KitButton>
                  <span className="min-w-0 flex-1 truncate text-center text-[13px] font-medium text-slate-400">
                    {api.selected !== null ? `Step ${api.selected + 1} of ${steps.length}` : `Plot ${plotId} settings`}
                  </span>
                  <span className={`flex items-center ${api.selected === null ? "invisible" : ""}`}>
                    <IconButton aria-label="Previous step" size="md" disabled={api.selected === null || api.selected === 0} onClick={() => api.selected !== null && select(api.selected - 1)}>
                      <ChevronUp />
                    </IconButton>
                    <IconButton aria-label="Next step" size="md" disabled={api.selected === null || api.selected >= steps.length - 1} onClick={() => api.selected !== null && select(api.selected + 1)}>
                      <ChevronDown />
                    </IconButton>
                  </span>
                </div>
                <Inspector className="min-h-0 flex-1" />
              </div>
            )}
          </div>
        ) : (
          <div className="relative flex min-h-0 flex-1">
            <div className="hidden min-h-0 shrink-0 lg:flex" style={{ width: panels.rail }}>
              <StepRail className="w-full" searchRef={searchRef} />
            </div>
            <ResizeHandle side="left" label="Steps panel width" width={panels.rail} min={RAIL.min} max={RAIL.max} onResize={(rail) => setPanels((p) => ({ ...p, rail }))} onReset={() => setPanels((p) => ({ ...p, rail: RAIL.def }))} className="max-lg:hidden" />
            {/* Keyed by plot: switching plots fades the new canvas in instead of flashing the whole editor. */}
            <div key={plotId} className="relative min-h-0 min-w-0 flex-1 kit-fade-in">
              <FlowCanvas className="h-full min-h-0 min-w-0" />
            </div>
            <ResizeHandle side="right" label="Inspector width" width={panels.insp} min={INSP.min} max={INSP.max} onResize={(insp) => setPanels((p) => ({ ...p, insp }))} onReset={() => setPanels((p) => ({ ...p, insp: INSP.def }))} />
            <div className="flex min-h-0 shrink-0" style={{ width: panels.insp }}>
              <Inspector className="min-h-0 w-full border-l border-slate-700/60" />
            </div>
            {layoutStep && layoutOf !== null && (
              <LayoutWorkspace
                plotId={plotId}
                step={layoutStep}
                index={layoutOf}
                onChange={(layout, transform) => {
                  const id = layoutStep.id;
                  editStep(
                    layoutOf,
                    (s) => pruneWatch({ ...(transform ? transformWatch(s, transform) : s), layout }),
                    { mergeKey: `layout:${id}` }
                  );
                }}
                onClose={() => setLayoutOf(null)}
              />
            )}
          </div>
        )}
        {phone && layoutStep && layoutOf !== null && (
          <div className="fixed inset-0 z-50">
            <LayoutWorkspace
              plotId={plotId}
              step={layoutStep}
              index={layoutOf}
              onChange={(layout, transform) => editStep(layoutOf, (s) => pruneWatch({ ...(transform ? transformWatch(s, transform) : s), layout }), { mergeKey: `layout:${layoutStep.id}` })}
              onClose={() => setLayoutOf(null)}
            />
          </div>
        )}
        {menu && (
          <AddStepMenu
            request={menu}
            duplicate={selected !== null && steps[selected] ? { index: selected, label: stepLabel(steps[selected]) } : null}
            onAdd={(req) => addStep(req)}
            onClose={() => setMenu(null)}
          />
        )}
        <span className="sr-only" aria-live="polite">
          {selected !== null && steps[selected] ? `Step ${selected + 1} selected: ${stepLabel(steps[selected])}` : "No step selected"}
        </span>
      </div>
    </FlowEditorContext.Provider>
  );
};

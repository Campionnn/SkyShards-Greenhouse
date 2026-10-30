import React, { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronRight, ClipboardPaste, CodeXml, Copy, CopyPlus, GripVertical, LayoutGrid, MousePointer2, Play, Plus, Search, SlidersHorizontal, Trash2, X } from "lucide-react";
import { useContextMenu } from "../../ui/contextMenuContext";
import { CropImage } from "../../shared";
import { IconButton, Kbd, KitLabel } from "../../ui/kit";
import { nameOf } from "../format";
import { useFlowEditor } from "./context";
import { overrideCount } from "./InspectorFields";
import { hasFinishExit, moveStep } from "./model";
import { layoutFacts, stepLabel, unreachedSteps } from "./shared";

// Left rail: every step in flow order (search, select, drag to reorder), plus the plot settings
// entry. Flow order only matters for numbering and the start step: exits are explicit, so
// reordering never changes where the plot goes.

export const StepRail: React.FC<{ className?: string; searchRef?: React.RefObject<HTMLInputElement | null> }> = ({ className = "", searchRef }) => {
  const api = useFlowEditor();
  const { plot } = api;
  const steps = plot.flow.steps;
  const [query, setQuery] = useState("");
  // Dragging step `from`; `to` is the index it would land on.
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const pinned = hasFinishExit(plot) ? steps.length - 1 : -1;
  const scriptOnly = useMemo(() => (api.scripted ? unreachedSteps(plot) : new Set<number>()), [plot, api.scripted]);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (i: number) => {
    if (!words.length) return true;
    const f = layoutFacts(steps[i]);
    const hay = `${i + 1} ${stepLabel(steps[i])} ${steps[i].id} ${f.targets.map(([id]) => nameOf(id)).join(" ")} ${steps[i].ui?.note ?? ""} ${steps[i].ui?.frame ?? ""}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  };
  const shown = steps.map((_, i) => i).filter(matches);
  const overrides = overrideCount(plot.policies);
  const scriptOn = !!plot.script?.source.trim() && plot.script.enabled !== false;
  const openMenu = useContextMenu();

  const open = (i: number) => {
    api.select(i);
    api.focusStep(i);
  };

  const onKeyDownSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && shown.length) open(shown[0]);
    else if (e.key === "Escape") {
      e.preventDefault();
      setQuery("");
      e.currentTarget.blur();
    }
  };

  /** Moves a step in flow order and keeps the same step selected. */
  const move = (from: number, to: number) => {
    if (from === to) return;
    api.edit((p) => moveStep(p, from, to));
    if (api.selected === from) api.select(to);
    else if (api.selected !== null && from < api.selected && to >= api.selected) api.select(api.selected - 1);
    else if (api.selected !== null && from > api.selected && to <= api.selected) api.select(api.selected + 1);
  };
  const drop = () => {
    if (drag) move(drag.from, drag.to);
    setDrag(null);
  };
  const canMove = (from: number, to: number) => to >= 0 && to < steps.length && from !== pinned && to !== pinned;

  const stepMenu = (e: React.MouseEvent, i: number) =>
    openMenu(e, [
      { heading: `${i + 1}. ${stepLabel(steps[i])}` },
      { label: "Select", icon: <MousePointer2 />, onSelect: () => open(i) },
      { label: "Edit layout", icon: <LayoutGrid />, onSelect: () => api.openLayout(i) },
      { label: "Set as start", icon: <Play />, disabled: i === plot.flow.startIndex, onSelect: () => api.setStart(i) },
      { separator: true },
      { label: "Copy", icon: <Copy />, shortcut: "Ctrl C", onSelect: () => api.copyStep(i) },
      ...(api.pasteStep ? [{ label: "Paste after", icon: <ClipboardPaste />, shortcut: "Ctrl V", onSelect: () => api.pasteStep?.() }] : []),
      { label: "Duplicate", icon: <CopyPlus />, shortcut: "Ctrl D", onSelect: () => api.duplicateStep(i) },
      { separator: true },
      { label: "Move up", icon: <ArrowUp />, disabled: !canMove(i, i - 1), onSelect: () => move(i, i - 1) },
      { label: "Move down", icon: <ArrowDown />, disabled: !canMove(i, i + 1), onSelect: () => move(i, i + 1) },
      { separator: true },
      {
        label: "Delete",
        icon: <Trash2 />,
        tone: "danger",
        shortcut: "Del",
        disabled: steps.length <= 1,
        title: steps.length <= 1 ? "A flow needs at least one step" : undefined,
        onSelect: () => api.deleteStep(i),
      },
    ]);

  const plotMenu = (e: React.MouseEvent) =>
    openMenu(e, [
      { heading: `Plot ${api.plotId}` },
      { label: "Plot settings", icon: <SlidersHorizontal />, onSelect: () => api.select(null) },
      ...(api.openScript
        ? [
            { label: plot.script?.source.trim() ? "Edit plot script" : "Write a plot script", icon: <CodeXml />, onSelect: () => api.openScript!("plot") },
            { label: "Controller script", icon: <CodeXml />, onSelect: () => api.openScript!("controller") },
          ]
        : []),
    ]);

  return (
    <aside className={`flex min-h-0 flex-col border-r border-slate-700/60 bg-slate-900 ${className}`} aria-label="Steps">
      <div className="flex flex-col gap-3 px-3 pt-3 pb-2">
        <label className="flex h-8 items-center gap-2 rounded-lg border border-slate-700/60 bg-slate-950/50 px-2.5 text-slate-500 transition-colors duration-150 focus-within:border-emerald-500/60">
          <Search className="h-3.5 w-3.5 shrink-0" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDownSearch}
            placeholder="Find a step…"
            aria-label="Find a step"
            className="w-full min-w-0 bg-transparent text-[13px] text-slate-100 outline-none placeholder:text-slate-500"
          />
          {query ? (
            <button type="button" aria-label="Clear search" onClick={() => setQuery("")} className="cursor-pointer text-slate-500 hover:text-slate-200">
              <X className="h-3.5 w-3.5" />
            </button>
          ) : (
            <Kbd>/</Kbd>
          )}
        </label>
        <KitLabel
          className="pl-1"
          actions={
            <IconButton
              aria-label="Add a step"
              className="-my-1 h-6 w-6"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                api.openAddMenu({ screen: { x: r.right + 6, y: r.top }, after: api.selected ?? undefined });
              }}
            >
              <Plus />
            </IconButton>
          }
        >
          {words.length ? `${shown.length} of ${steps.length} steps` : `Steps · ${steps.length}`}
        </KitLabel>
      </div>
      <ol
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-2 scrollbar-dark"
        onDragOver={(e) => drag && e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          drop();
        }}
      >
        {shown.length === 0 && <li className="px-3 py-6 text-center text-[12px] text-slate-500">No step matches "{query}".</li>}
        {shown.map((i) => {
          const s = steps[i];
          const f = layoutFacts(s);
          const sel = api.selected === i;
          const canDrag = i !== pinned && !words.length && steps.length > 1;
          const targets = f.targets.reduce((a, [, n]) => a + n, 0);
          const lineAbove = drag && drag.to === i && drag.from > i;
          const lineBelow = drag && drag.to === i && drag.from < i;
          return (
            <li
              key={s.id}
              className="relative py-px"
              draggable={canDrag}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", stepLabel(s));
                setDrag({ from: i, to: i });
              }}
              onDragOver={() => {
                if (drag && i !== pinned && drag.to !== i) setDrag({ ...drag, to: i });
              }}
              onDragEnd={() => setDrag(null)}
            >
              {lineAbove && <DropLine className="-top-px" />}
              {lineBelow && <DropLine className="-bottom-px" />}
              <button
                type="button"
                onClick={() => open(i)}
                onContextMenu={(e) => stepMenu(e, i)}
                aria-current={sel ? "true" : undefined}
                className={`group flex w-full cursor-pointer items-center gap-2 rounded-lg py-1.5 pr-1.5 pl-1 text-left transition-[background-color,opacity] duration-150 ${
                  sel ? "bg-emerald-500/10 shadow-[inset_0_0_0_1px_rgba(52,211,153,0.25)]" : "hover:bg-slate-400/[0.06]"
                } ${drag?.from === i ? "opacity-40" : ""}`}
              >
                <span className={`w-5 shrink-0 text-right text-[11px] tabular-nums ${sel ? "text-emerald-300" : "text-slate-500"}`}>{i + 1}</span>
                <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-md bg-slate-800 shadow-[inset_0_0_0_1px_rgba(148,163,184,0.1)]">
                  <CropImage cropId={f.icon} cropName={nameOf(f.icon)} size="custom" width={16} height={16} showFallback={false} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-[12.5px] font-medium ${sel ? "text-slate-50" : "text-slate-200"}`} title={stepLabel(s)}>
                    {stepLabel(s)}
                  </span>
                  <span className="flex items-center gap-1 truncate text-[11px] tabular-nums text-slate-500">
                    {i === plot.flow.startIndex && <span className="font-semibold tracking-[0.04em] text-emerald-400">START ·</span>}
                    {scriptOnly.has(i) && (
                      <span className="text-sky-300" title="No exit leads here: the plot script enters it with plot.goto()">
                        <CodeXml className="h-3 w-3" aria-label="Entered by the script" />
                      </span>
                    )}
                    <span className="truncate">
                      {s.exits.length ? `${s.exits.length} exit${s.exits.length === 1 ? "" : "s"}` : "no exit"}
                      {targets ? ` · ${targets} target${targets === 1 ? "" : "s"}` : ""}
                    </span>
                  </span>
                </span>
                {canDrag && (
                  <GripVertical className="-mr-0.5 h-3.5 w-3.5 shrink-0 cursor-grab text-slate-600 opacity-0 transition-opacity duration-150 group-hover:opacity-100" aria-hidden />
                )}
              </button>
            </li>
          );
        })}
      </ol>
      <div className="border-t border-slate-700/60 p-2.5">
        <button
          type="button"
          onClick={() => api.select(null)}
          onContextMenu={plotMenu}
          aria-current={api.selected === null ? "true" : undefined}
          className={`flex w-full cursor-pointer items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors duration-150 active:scale-[0.99] ${
            api.selected === null ? "border-emerald-500/30 bg-emerald-500/10" : "border-slate-700/50 bg-slate-800/40 hover:bg-slate-700/40"
          }`}
        >
          <SlidersHorizontal className={`h-3.5 w-3.5 shrink-0 ${api.selected === null ? "text-emerald-300" : "text-slate-400"}`} />
          <span className="min-w-0 flex-1">
            <span className="block text-[12.5px] font-medium text-slate-100">Plot settings</span>
            <span className="block truncate text-[11px] text-slate-500">
              {plot.flow.loop ? "Loops" : "No loop"} · {overrides ? `${overrides} override${overrides === 1 ? "" : "s"}` : "no overrides"}
              {scriptOn ? " · script" : ""}
            </span>
          </span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-600" />
        </button>
      </div>
    </aside>
  );
};

const DropLine: React.FC<{ className: string }> = ({ className }) => (
  <span aria-hidden className={`pointer-events-none absolute right-2 left-2 z-10 h-0.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)] ${className}`} />
);

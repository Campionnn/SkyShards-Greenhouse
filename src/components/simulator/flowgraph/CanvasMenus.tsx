import {
  ArrowDown,
  ArrowUp,
  ClipboardPaste,
  Code,
  Copy,
  CopyPlus,
  CornerDownRight,
  Frame,
  LayoutGrid,
  Palette,
  Pencil,
  Play,
  Plus,
  Scan,
  SlidersHorizontal,
  Spline,
  Trash2,
  Ungroup,
  Wand2,
  Zap,
} from "lucide-react";
import type { ContextMenuEntry } from "../../ui/contextMenuContext";
import { defaultTrigger } from "../scenarioEdit";
import { withLayout } from "./autoLayout";
import type { FlowEditorApi } from "./context";
import { FRAME_TONE } from "./CanvasModel";
import { exitTarget, FRAME_COLORS } from "./model";
import { stepLabel } from "./shared";

// The canvas's right-click menus: the empty canvas, a step, an exit (row or wire) and a frame.
// Plain item lists for the shared ContextMenu; every action goes through the editor API.

type XY = { x: number; y: number };

export function paneMenu(api: FlowEditorApi, at: { screen: XY; flow: XY }, view: { frameAll: () => void; busy: boolean }): ContextMenuEntry[] {
  const out: ContextMenuEntry[] = [
    { label: "Add step here…", icon: <Plus />, shortcut: "Shift A", onSelect: () => api.openAddMenu({ screen: at.screen, at: at.flow }) },
    {
      label: "Paste step here",
      icon: <ClipboardPaste />,
      shortcut: "Ctrl V",
      disabled: !api.pasteStep,
      title: api.pasteStep ? undefined : "Copy a step first (Ctrl C)",
      onSelect: () => api.pasteStep?.(at.flow),
    },
    { separator: true },
    { label: "Frame all", icon: <Scan />, shortcut: "F", onSelect: view.frameAll },
    { label: "Tidy up", icon: <Wand2 />, title: "Arrange every step automatically (undo puts them back)", onSelect: () => api.edit((p) => withLayout(p, { all: true }), { uiOnly: true }) },
  ];
  if (view.busy) out.push({ label: api.showAllWires ? "Show the selected step's wires only" : "Show all wires", icon: <Spline />, onSelect: () => api.setShowAllWires(!api.showAllWires) });
  if (api.openScript && api.scripted) out.push({ separator: true }, { label: "Edit plot script", icon: <Code />, onSelect: () => api.openScript?.("plot") });
  return out;
}

export function stepMenu(api: FlowEditorApi, i: number): ContextMenuEntry[] {
  const steps = api.plot.flow.steps;
  const s = steps[i];
  if (!s) return [];
  const inspect = (tab: Parameters<FlowEditorApi["setTab"]>[0]) => {
    api.select(i);
    api.setTab(tab);
  };
  return [
    { heading: `${i + 1}. ${stepLabel(s)}` },
    { label: "Edit layout", icon: <LayoutGrid />, onSelect: () => api.openLayout(i) },
    {
      label: "Rename…",
      icon: <Pencil />,
      onSelect: () => {
        inspect("exits");
        // The inspector's name field: open it for typing once the inspector shows this step.
        requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('[aria-label="Step inspector"] button[title="Rename step"]')?.click());
      },
    },
    {
      label: "Add exit",
      icon: <CornerDownRight />,
      onSelect: () => {
        const to = steps[(i + 1) % steps.length].id;
        api.editStep(i, (st) => ({ ...st, exits: [...st.exits, { to, when: [defaultTrigger("cycles")] }] }));
        inspect("exits");
        api.setOpenExit(s.exits.length);
      },
    },
    { label: "Set as start", icon: <Play />, disabled: api.plot.flow.startIndex === i, onSelect: () => api.setStart(i) },
    { separator: true },
    { label: "Copy", icon: <Copy />, shortcut: "Ctrl C", onSelect: () => api.copyStep(i) },
    { label: "Duplicate", icon: <CopyPlus />, shortcut: "Ctrl D", onSelect: () => api.duplicateStep(i) },
    { label: s.ui?.frame ? "Change frame…" : "Add to frame…", icon: <Frame />, onSelect: () => inspect("notes") },
    { separator: true },
    { label: "Delete step", icon: <Trash2 />, shortcut: "Del", tone: "danger", disabled: steps.length <= 1, onSelect: () => api.deleteStep(i) },
  ];
}

export function exitMenu(api: FlowEditorApi, i: number, j: number): ContextMenuEntry[] {
  const s = api.plot.flow.steps[i];
  const exit = s?.exits[j];
  if (!s || !exit) return [];
  const t = exitTarget(api.plot, i, exit);
  const setExits = (fn: (list: typeof s.exits) => typeof s.exits) => api.editStep(i, (st) => ({ ...st, exits: fn(st.exits) }));
  const move = (to: number) => {
    setExits((list) => {
      const next = [...list];
      const [e] = next.splice(j, 1);
      next.splice(to, 0, e);
      return next;
    });
    api.select(i);
    api.setTab("exits");
    api.setOpenExit(to);
  };
  return [
    { heading: `Exit ${j + 1} of step ${i + 1}` },
    {
      label: t.kind === "step" ? (t.index === i ? "Go to this step" : `Go to step ${t.index + 1}`) : "Go to target",
      icon: <CornerDownRight />,
      disabled: t.kind !== "step",
      onSelect: () => {
        if (t.kind !== "step") return;
        api.select(t.index);
        api.setTab("exits");
        api.focusStep(t.index);
      },
    },
    {
      label: "Edit conditions",
      icon: <SlidersHorizontal />,
      onSelect: () => {
        api.select(i);
        api.setTab("exits");
        api.setOpenExit(j);
      },
    },
    {
      label: exit.checkOnEntry ? "Stop checking on arrival" : "Also check on arrival",
      icon: <Zap />,
      title: "If it already holds when the plot arrives, the step is skipped",
      disabled: t.kind === "finish",
      onSelect: () =>
        setExits((list) =>
          list.map((e, k) => {
            if (k !== j) return e;
            const next = { ...e };
            if (next.checkOnEntry) delete next.checkOnEntry;
            else next.checkOnEntry = true;
            return next;
          })
        ),
    },
    { separator: true },
    { label: "Move earlier", icon: <ArrowUp />, disabled: j === 0, onSelect: () => move(j - 1) },
    { label: "Move later", icon: <ArrowDown />, disabled: j >= s.exits.length - 1, onSelect: () => move(j + 1) },
    { separator: true },
    {
      label: "Delete exit",
      icon: <Trash2 />,
      tone: "danger",
      onSelect: () => {
        setExits((list) => list.filter((_, k) => k !== j));
        api.setHotExit(null);
        if (api.selected === i && api.openExit >= j) api.setOpenExit(Math.max(-1, api.openExit === j ? -1 : api.openExit - 1));
      },
    },
  ];
}

export function frameMenu(api: FlowEditorApi, frame: { label: string; script: boolean; members: number[] }): ContextMenuEntry[] {
  if (frame.script) {
    return [
      { heading: frame.label },
      ...(api.openScript ? [{ label: "Edit plot script", icon: <Code />, onSelect: () => api.openScript?.("plot") }] : []),
      {
        label: "Put these steps in a frame…",
        icon: <Frame />,
        title: "Name a frame for the first step in the Notes tab, then give the others the same name",
        onSelect: () => {
          api.select(frame.members[0]);
          api.setTab("notes");
        },
      },
    ];
  }
  const setOnMembers = (patch: { frame?: string; frameColor?: (typeof FRAME_COLORS)[number] }) =>
    api.edit(
      (p) => {
        for (const k of frame.members) {
          const st = p.flow.steps[k];
          if (!st?.ui) continue;
          const ui = { ...st.ui, ...patch };
          if (!ui.frame) {
            delete ui.frame;
            delete ui.frameColor;
          }
          p.flow.steps[k] = { ...st, ui };
        }
        return p;
      },
      { uiOnly: true }
    );
  return [
    { heading: frame.label },
    {
      label: "Rename frame…",
      icon: <Pencil />,
      onSelect: () => {
        api.select(frame.members[0]);
        api.setTab("notes");
      },
    },
    { label: "Ungroup", icon: <Ungroup />, title: "Remove the frame; the steps stay where they are", onSelect: () => setOnMembers({ frame: undefined }) },
    { separator: true },
    ...FRAME_COLORS.map((c) => ({
      label: `${c[0].toUpperCase()}${c.slice(1)}`,
      icon: <Palette style={{ color: FRAME_TONE[c].text }} />,
      onSelect: () => setOnMembers({ frameColor: c }),
    })),
  ];
}

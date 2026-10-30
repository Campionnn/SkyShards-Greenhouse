import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type Connection,
  type Edge,
  type EdgeTypes,
  type FinalConnectionState,
  type Node,
  type NodeChange,
  type NodeTypes,
  type OnNodeDrag,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import "./canvas.css";
import { Minus, Plus, Scan } from "lucide-react";
import { Kbd, KitButton } from "../../ui/kit";
import { BUSY_WIRES, useFlowEditor, type FlowEditorApi } from "./context";
import { CanvasActionsContext, type CanvasActions } from "./CanvasContext";
import { frameBoxes, rectOf, routeWires, snap8, stepNodeBase, type Rect, type StepNodeData, type WireRef } from "./CanvasModel";
import { ExitEdge, StartEdge, type ExitEdgeType } from "./ExitEdge";
import { exitTarget, withStepUi } from "./model";
import { exitKind, incomingCounts, unreachedSteps } from "./shared";
import { FrameNode, StartNode, StepNode, type FrameNodeType, type StartNodeType, type StepNodeType } from "./StepNode";

// The flow editor's canvas: steps as nodes, exits as wires, frames behind grouped steps. All
// editor state comes from useFlowEditor(); the canvas only keeps what changes while a pointer
// is down (node positions during a drag) and what React Flow measures (node sizes).

type AppNode = StepNodeType | StartNodeType | FrameNodeType;

const START_ID = "__start";
const nodeTypes: NodeTypes = { step: StepNode, start: StartNode, frame: FrameNode };
const edgeTypes: EdgeTypes = { exit: ExitEdge, start: StartEdge };
const FIT = { padding: 0.12, maxZoom: 1 } as const;
/** Below this zoom nodes drop their body detail and exit text (numbers, sockets and a bigger label stay). */
const FAR_ZOOM = 0.45;

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const camera = () => (reducedMotion() ? 0 : 300);

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || !!el.closest?.("[contenteditable=true]");
}

const pointOf = (e: MouseEvent | TouchEvent) => ("changedTouches" in e ? { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY } : { x: e.clientX, y: e.clientY });

const sameData = (a: StepNodeData, b: StepNodeData) => {
  if (a.layout !== b.layout) return false;
  const { layout: _a, ...ra } = a;
  const { layout: _b, ...rb } = b;
  void _a;
  void _b;
  return JSON.stringify(ra) === JSON.stringify(rb);
};

type XY = { x: number; y: number };

/** Wire id "<stepId>:<exit>" -> [stepIndex, exitIndex]. */
function edgeExit(api: FlowEditorApi, id: string): [number, number] | null {
  if (id === START_ID) return null;
  const cut = id.lastIndexOf(":");
  const i = api.plot.flow.steps.findIndex((s) => s.id === id.slice(0, cut));
  return i < 0 ? null : [i, Number(id.slice(cut + 1))];
}

const ZoomReadout: React.FC = () => {
  const pct = useStore((s) => Math.round(s.transform[2] * 100));
  return <div className="fg-zoom-pct">{pct}%</div>;
};

const Canvas: React.FC<{ className?: string }> = ({ className = "" }) => {
  const api = useFlowEditor();
  const rf = useReactFlow<AppNode, Edge>();
  const apiRef = useRef<FlowEditorApi>(api);
  apiRef.current = api;
  const wrapRef = useRef<HTMLDivElement>(null);
  const pointer = useRef<XY | null>(null);

  const { plot, selected, hotExit, scripted, showAllWires } = api;
  const steps = plot.flow.steps;

  // Live positions while dragging, and React Flow's measured sizes, keyed by step id.
  const [dragPos, setDragPos] = useState<Record<string, XY>>({});
  const dragRef = useRef(dragPos);
  dragRef.current = dragPos;
  const [sizes, setSizes] = useState<Record<string, { width: number; height: number }>>({});
  // Extra selected steps (shift-click / box select), valid while `for` is the editor selection.
  const [multi, setMulti] = useState<{ for: number | null; ids: Set<string> }>({ for: null, ids: new Set() });
  const frameDrag = useRef<{ key: string; from: XY; members: Record<string, XY> } | null>(null);

  const far = useStore((s) => s.transform[2] < FAR_ZOOM);

  // ---- Plot-derived data (recomputed only when the plot changes) ----------------------------
  const derived = useMemo(() => {
    const unreached = scripted ? unreachedSteps(plot) : new Set<number>();
    const bases = steps.map((_, i) => stepNodeBase(plot, i, unreached.has(i)));
    const wires: (WireRef & { kind: ReturnType<typeof exitKind> })[] = [];
    steps.forEach((s, i) =>
      s.exits.forEach((e, j) => {
        const t = exitTarget(plot, i, e);
        if (t.kind === "step") wires.push({ id: `${s.id}:${j}`, s: i, t: t.index, j, exits: s.exits.length, kind: exitKind(plot, i, e) });
      })
    );
    return { unreached, bases, wires, incoming: incomingCounts(plot), total: steps.reduce((n, s) => n + s.exits.length, 0) };
  }, [plot, steps, scripted]);

  const pos = useCallback((i: number): XY => dragPos[steps[i].id] ?? { x: steps[i].ui?.x ?? 0, y: steps[i].ui?.y ?? 0 }, [dragPos, steps]);

  const rects: Rect[] = useMemo(() => steps.map((s, i) => rectOf(pos(i), sizes[s.id], s.exits.length)), [steps, pos, sizes]);

  // ---- Wires ---------------------------------------------------------------------------------
  const busy = derived.total >= BUSY_WIRES;
  const drawn = useMemo(
    () =>
      derived.wires.filter(
        (w) => showAllWires || (selected !== null && (w.s === selected || w.t === selected)) || (hotExit !== null && hotExit[0] === w.s && hotExit[1] === w.j)
      ),
    [derived.wires, showAllWires, selected, hotExit]
  );
  const routes = useMemo(() => routeWires(drawn, rects), [drawn, rects]);

  const edgeCache = useRef(new Map<string, ExitEdgeType>());
  const edges = useMemo(() => {
    const next = new Map<string, ExitEdgeType>();
    const out: Edge[] = [];
    for (const w of drawn) {
      const hot = w.s === selected || (hotExit !== null && hotExit[0] === w.s && hotExit[1] === w.j);
      const dim = selected !== null && !hot && w.t !== selected;
      const route = routes.get(w.id) ?? { type: "bezier" as const };
      const prev = edgeCache.current.get(w.id);
      const d = prev?.data;
      const same = prev && d && d.kind === w.kind && d.hot === hot && d.dim === dim && JSON.stringify(d.route) === JSON.stringify(route) && prev.target === steps[w.t].id;
      const e: ExitEdgeType = same
        ? prev
        : {
            id: w.id,
            type: "exit",
            source: steps[w.s].id,
            sourceHandle: `x:${w.j}`,
            target: steps[w.t].id,
            targetHandle: "in",
            selectable: false,
            focusable: false,
            deletable: false,
            zIndex: hot ? 1 : 0,
            data: { kind: w.kind, route, hot, dim },
          };
      next.set(w.id, e);
      out.push(e);
    }
    edgeCache.current = next;
    const startStep = steps[plot.flow.startIndex];
    if (startStep) out.push({ id: START_ID, type: "start", source: START_ID, sourceHandle: "start", target: startStep.id, targetHandle: "in", selectable: false, focusable: false, deletable: false });
    return out;
  }, [drawn, routes, selected, hotExit, steps, plot.flow.startIndex]);

  // ---- Nodes ---------------------------------------------------------------------------------
  const seen = useRef<Set<string> | null>(null);
  if (seen.current === null) seen.current = new Set(steps.map((s) => s.id));
  const nodeCache = useRef(new Map<string, StepNodeType>());

  const nodes = useMemo(() => {
    const drawnIn = steps.map(() => 0);
    const hotIn = new Set<number>();
    for (const w of drawn) {
      if (w.s !== w.t) drawnIn[w.t]++;
      if (w.s === selected || (hotExit && hotExit[0] === w.s && hotExit[1] === w.j)) hotIn.add(w.t);
    }
    const effective = multi.for === selected ? multi.ids : new Set<string>();
    const out: AppNode[] = [];

    for (const f of frameBoxes(steps, rects, scripted ? derived.unreached : null)) {
      out.push({
        id: `frame:${f.key}`,
        type: "frame",
        position: { x: f.x, y: f.y },
        data: { label: f.label, sub: f.sub, tone: f.tone, members: f.members, w: f.w, h: f.h },
        draggable: true,
        dragHandle: ".fg-frame-label",
        selectable: false,
        deletable: false,
        connectable: false,
        focusable: false,
        zIndex: -1,
      });
    }

    const startStep = steps[plot.flow.startIndex];
    if (startStep) {
      const p = pos(plot.flow.startIndex);
      out.push({ id: START_ID, type: "start", position: { x: p.x - 150, y: p.y + 4 }, data: {}, draggable: false, selectable: false, deletable: false, focusable: false });
    }

    const next = new Map<string, StepNodeType>();
    steps.forEach((s, i) => {
      const data: StepNodeData = {
        ...derived.bases[i],
        hotRow: i === selected ? -2 : hotExit && hotExit[0] === i ? hotExit[1] : -1,
        inHot: hotIn.has(i),
        hiddenIn: showAllWires ? 0 : Math.max(0, derived.incoming[i] - drawnIn[i]),
      };
      const p = pos(i);
      const sel = i === selected || effective.has(s.id);
      const prev = nodeCache.current.get(s.id);
      const fresh = !seen.current!.has(s.id);
      const node: StepNodeType =
        prev && prev.position.x === p.x && prev.position.y === p.y && prev.selected === sel && prev.measured === sizes[s.id] && sameData(prev.data, data)
          ? prev
          : {
              id: s.id,
              type: "step",
              position: p,
              data: prev && sameData(prev.data, data) ? prev.data : data,
              selected: sel,
              deletable: false,
              measured: sizes[s.id],
              className: fresh || prev?.className ? "fg-pop" : undefined,
            };
      next.set(s.id, node);
      out.push(node);
    });
    nodeCache.current = next;
    return out;
  }, [steps, rects, scripted, derived, plot.flow.startIndex, pos, selected, hotExit, showAllWires, sizes, multi, drawn]);

  useEffect(() => {
    for (const s of steps) seen.current!.add(s.id);
  }, [steps]);

  // ---- Changes from React Flow ---------------------------------------------------------------
  const onNodesChange = useCallback(
    (changes: NodeChange<AppNode>[]) => {
      const a = apiRef.current;
      const ids = a.plot.flow.steps.map((s) => s.id);
      let moved: Record<string, XY> | null = null;
      let measured: Record<string, { width: number; height: number }> | null = null;
      let selChanged = false;
      const selNext = new Set(multi.for === a.selected ? multi.ids : []);
      for (const c of changes) {
        if (c.type === "dimensions" && c.dimensions && ids.includes(c.id)) {
          measured ??= {};
          measured[c.id] = c.dimensions;
        } else if (c.type === "position" && c.position) {
          if (c.id.startsWith("frame:")) {
            const fd = frameDrag.current;
            if (fd && fd.key === c.id) {
              const dx = c.position.x - fd.from.x;
              const dy = c.position.y - fd.from.y;
              moved ??= {};
              for (const [id, p] of Object.entries(fd.members)) moved[id] = { x: p.x + dx, y: p.y + dy };
            }
          } else if (ids.includes(c.id)) {
            moved ??= {};
            moved[c.id] = c.position;
          }
        } else if (c.type === "select" && ids.includes(c.id)) {
          selChanged = true;
          if (c.selected) selNext.add(c.id);
          else selNext.delete(c.id);
        }
      }
      if (measured) {
        const m = measured;
        setSizes((cur) => {
          let changed = false;
          const out = { ...cur };
          for (const [id, d] of Object.entries(m)) {
            if (cur[id]?.width !== d.width || cur[id]?.height !== d.height) {
              out[id] = d;
              changed = true;
            }
          }
          return changed ? out : cur;
        });
      }
      if (moved) {
        const m = moved;
        setDragPos((cur) => ({ ...cur, ...m }));
      }
      if (selChanged) {
        // The editor selection stays the primary; the rest ride along for multi-drag.
        const primary = a.selected !== null ? ids[a.selected] : null;
        if (primary && !selNext.has(primary) && selNext.size) {
          const first = [...selNext][0];
          a.select(ids.indexOf(first));
          setMulti({ for: ids.indexOf(first), ids: selNext });
        } else setMulti({ for: a.selected, ids: selNext });
      }
    },
    [multi]
  );

  const commitPositions = useCallback((moved: Record<string, XY>, mergeKey: string) => {
    const a = apiRef.current;
    const entries = Object.entries(moved);
    const changed = entries.filter(([id, p]) => {
      const s = a.plot.flow.steps.find((x) => x.id === id);
      return s && (snap8(p.x) !== s.ui?.x || snap8(p.y) !== s.ui?.y);
    });
    if (changed.length) {
      a.edit(
        (p) => {
          for (const [id, xy] of changed) {
            const k = p.flow.steps.findIndex((s) => s.id === id);
            if (k >= 0) p.flow.steps[k] = withStepUi(p.flow.steps[k], { x: snap8(xy.x), y: snap8(xy.y) });
          }
          return p;
        },
        { uiOnly: true, mergeKey }
      );
    }
    setDragPos((cur) => {
      const out = { ...cur };
      for (const [id] of entries) delete out[id];
      return out;
    });
  }, []);

  const onNodeDragStart = useCallback<OnNodeDrag<AppNode>>((_, node) => {
    if (node.type !== "frame") return;
    const a = apiRef.current;
    const members: Record<string, XY> = {};
    for (const i of (node as FrameNodeType).data.members) {
      const s = a.plot.flow.steps[i];
      if (s) members[s.id] = { x: s.ui?.x ?? 0, y: s.ui?.y ?? 0 };
    }
    frameDrag.current = { key: node.id, from: { ...node.position }, members };
  }, []);

  const onNodeDragStop = useCallback<OnNodeDrag<AppNode>>(
    (_, node, dragged) => {
      if (node.type === "frame") {
        const fd = frameDrag.current;
        frameDrag.current = null;
        if (!fd) return;
        const moved: Record<string, XY> = {};
        for (const id of Object.keys(fd.members)) if (dragRef.current[id]) moved[id] = dragRef.current[id];
        commitPositions(moved, `drag:${node.id}`);
        return;
      }
      const moved: Record<string, XY> = {};
      for (const n of dragged) if (n.type === "step") moved[n.id] = dragRef.current[n.id] ?? n.position;
      commitPositions(moved, `drag:${Object.keys(moved).sort().join(",")}`);
    },
    [commitPositions]
  );

  // ---- Clicks and hover ----------------------------------------------------------------------
  const indexOf = (id: string) => apiRef.current.plot.flow.steps.findIndex((s) => s.id === id);

  const onNodeClick = useCallback((e: React.MouseEvent, node: AppNode) => {
    if (node.type !== "step") return;
    const a = apiRef.current;
    if (e.shiftKey || e.ctrlKey || e.metaKey) return; // multi-select handled by React Flow
    a.select(indexOf(node.id));
    a.setTab("exits");
  }, []);

  const onNodeDoubleClick = useCallback((_: React.MouseEvent, node: AppNode) => {
    if (node.type === "step") apiRef.current.openLayout(indexOf(node.id));
  }, []);

  const onPaneClick = useCallback(() => apiRef.current.select(null), []);

  const onEdgeMouseEnter = useCallback((_: React.MouseEvent, e: Edge) => {
    const x = edgeExit(apiRef.current, e.id);
    if (x) apiRef.current.setHotExit(x);
  }, []);
  const onEdgeMouseLeave = useCallback(() => apiRef.current.setHotExit(null), []);
  const onEdgeClick = useCallback((_: React.MouseEvent, e: Edge) => {
    const x = edgeExit(apiRef.current, e.id);
    if (!x) return;
    const a = apiRef.current;
    a.select(x[0]);
    a.setTab("exits");
    a.setOpenExit(x[1]);
  }, []);

  const actions = useMemo<CanvasActions>(
    () => ({
      exitClick: (i, j) => {
        const a = apiRef.current;
        a.select(i);
        a.setTab("exits");
        a.setOpenExit(j);
      },
      exitHover: (i, j) => apiRef.current.setHotExit(j === null ? null : [i, j]),
      addExit: (i, screen) => {
        const at = rf.screenToFlowPosition(screen);
        apiRef.current.openAddMenu({ screen, at: { x: at.x + 40, y: at.y - 20 }, from: [i] });
      },
    }),
    [rf]
  );

  // ---- Connecting ----------------------------------------------------------------------------
  const connectTo = useCallback((source: string, handle: string | null | undefined, targetId: string) => {
    const a = apiRef.current;
    const steps = a.plot.flow.steps;
    const ti = steps.findIndex((s) => s.id === targetId);
    if (ti < 0) return;
    if (source === START_ID) {
      if (ti !== a.plot.flow.startIndex) a.edit((p) => ({ ...p, flow: { ...p.flow, startIndex: ti } }));
      return;
    }
    const si = steps.findIndex((s) => s.id === source);
    if (si < 0) return;
    if (handle === "add" || !handle) {
      const j = steps[si].exits.length;
      a.editStep(si, (s) => ({ ...s, exits: [...s.exits, { to: targetId, when: [{ kind: "cycles", n: 20 }] }] }));
      a.select(si);
      a.setTab("exits");
      a.setOpenExit(j);
      return;
    }
    const j = Number(handle.slice(2));
    if (steps[si].exits[j]?.to === targetId) return;
    a.editStep(si, (s) => ({ ...s, exits: s.exits.map((e, k) => (k === j ? { ...e, to: targetId } : e)) }));
  }, []);

  const onConnect = useCallback((c: Connection) => connectTo(c.source, c.sourceHandle, c.target), [connectTo]);

  const isValidConnection = useCallback((c: Connection | Edge) => c.targetHandle === "in" && c.target !== START_ID && !c.target.startsWith("frame:"), []);

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      if (state.isValid) return; // onConnect handled it
      const from = state.fromNode?.id;
      const handle = state.fromHandle?.id;
      if (!from) return;
      const pt = pointOf(event);
      const el = document.elementFromPoint(pt.x, pt.y);
      // Dropped on a step's body (not exactly on its socket): that step is the target.
      const nodeEl = el?.closest<HTMLElement>(".react-flow__node-step");
      const id = nodeEl?.dataset.id;
      if (id) {
        connectTo(from, handle, id);
        return;
      }
      if (from === START_ID || !el?.closest(".react-flow__pane")) return;
      const si = indexOf(from);
      if (si < 0) return;
      const j = handle && handle.startsWith("x:") ? Number(handle.slice(2)) : undefined;
      apiRef.current.openAddMenu({ screen: pt, at: rf.screenToFlowPosition(pt), from: j === undefined ? [si] : [si, j] });
    },
    [connectTo, rf]
  );

  // ---- Camera --------------------------------------------------------------------------------
  const focusStep = useCallback(
    (i: number) => {
      const s = apiRef.current.plot.flow.steps[i];
      if (!s) return;
      const n = rf.getInternalNode(s.id);
      const w = n?.measured.width ?? 280;
      const h = n?.measured.height ?? 260;
      const p = n?.internals.positionAbsolute ?? { x: s.ui?.x ?? 0, y: s.ui?.y ?? 0 };
      const zoom = Math.min(1, Math.max(rf.getZoom(), 0.7));
      void rf.setCenter(p.x + w / 2, p.y + h / 2, { zoom, duration: camera() });
    },
    [rf]
  );
  const frameAll = useCallback(() => void rf.fitView({ ...FIT, duration: camera() }), [rf]);
  const zoomIn = useCallback(() => void rf.zoomIn({ duration: reducedMotion() ? 0 : 150 }), [rf]);
  const zoomOut = useCallback(() => void rf.zoomOut({ duration: reducedMotion() ? 0 : 150 }), [rf]);

  useEffect(() => {
    api.registerCanvas({ focusStep, frameAll, zoomIn, zoomOut });
    return () => api.registerCanvas(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusStep, frameAll, zoomIn, zoomOut, api.registerCanvas]);

  // ---- Keyboard ------------------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const wrap = wrapRef.current;
      if (!wrap) return;
      // Only while the pointer is on the canvas itself (an overlay such as the add menu or the
      // layout workspace on top of it wins), or focus is inside it.
      const p = pointer.current;
      const under = p ? document.elementFromPoint(p.x, p.y) : null;
      if (!(under && wrap.contains(under)) && !wrap.contains(document.activeElement)) return;
      const a = apiRef.current;
      if ((e.key === "Delete" || e.key === "Backspace") && a.selected !== null) {
        e.preventDefault();
        a.deleteStep(a.selected);
      } else if (e.shiftKey && (e.key === "A" || e.key === "a")) {
        e.preventDefault();
        const r = wrap.getBoundingClientRect();
        const screen = pointer.current ?? { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        a.openAddMenu({ screen, at: rf.screenToFlowPosition(screen), ...(a.selected !== null ? { after: a.selected } : {}) });
      } else if (!e.shiftKey && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        frameAll();
      }
    };
    const onMove = (e: PointerEvent) => (pointer.current = { x: e.clientX, y: e.clientY });
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointermove", onMove);
    };
  }, [rf, frameAll]);

  const minimapColor = useCallback((n: Node) => (n.type === "frame" || n.type === "start" ? "transparent" : n.selected ? "#34d399" : "#334155"), []);

  const hiddenWires = derived.wires.length;

  return (
    <CanvasActionsContext.Provider value={actions}>
      <div
        ref={wrapRef}
        className={`fg-canvas ${far ? "fg-far" : ""} ${className}`}
      >
        <ReactFlow<AppNode, Edge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onNodeDragStart={onNodeDragStart}
          onNodeDragStop={onNodeDragStop}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
          onPaneClick={onPaneClick}
          onEdgeMouseEnter={onEdgeMouseEnter}
          onEdgeMouseLeave={onEdgeMouseLeave}
          onEdgeClick={onEdgeClick}
          onConnect={onConnect}
          onConnectEnd={onConnectEnd}
          isValidConnection={isValidConnection}
          fitView
          fitViewOptions={FIT}
          minZoom={0.2}
          maxZoom={1.6}
          deleteKeyCode={null}
          zoomOnDoubleClick={false}
          multiSelectionKeyCode={["Shift", "Meta", "Control"]}
          selectionKeyCode="Shift"
          elevateNodesOnSelect={false}
          elevateEdgesOnSelect={false}
          nodeDragThreshold={2}
          connectionRadius={28}
          proOptions={{ hideAttribution: true }}
          colorMode="dark"
          aria-label="Flow steps"
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1.4} color="rgba(148,163,184,0.16)" />
          {busy && (
            <Panel position="top-left">
              <div className="fg-hud fg-busy">
                {showAllWires ? (
                  <>
                    <span>Showing all {hiddenWires} wires</span>
                    <KitButton size="sm" onClick={() => api.setShowAllWires(false)}>
                      Selected step only
                    </KitButton>
                  </>
                ) : (
                  <>
                    <span>Showing wires for the selected step</span>
                    <KitButton size="sm" onClick={() => api.setShowAllWires(true)}>
                      Show all {hiddenWires}
                    </KitButton>
                  </>
                )}
              </div>
            </Panel>
          )}
          <Panel position="bottom-left" className="fg-hints">
            <span>
              <Kbd>Drag</Kbd> a socket to connect
            </span>
            <span>
              <Kbd>Shift A</Kbd> add step
            </span>
            <span>
              <Kbd>F</Kbd> frame all
            </span>
          </Panel>
          <Panel position="bottom-right" className="flex items-end gap-1.5" style={{ display: "flex" }}>
            <MiniMap<AppNode>
              pannable
              zoomable
              nodeColor={minimapColor}
              nodeStrokeWidth={0}
              nodeBorderRadius={4}
              maskColor="rgba(2,6,23,0.55)"
              maskStrokeColor="rgba(226,232,240,0.45)"
              maskStrokeWidth={1.5}
              bgColor="transparent"
              style={{ width: 184, height: 116, margin: 0, position: "static" }}
              ariaLabel="Overview"
            />
            <div className="fg-hud fg-zoom">
              <button type="button" aria-label="Zoom in" title="Zoom in" onClick={zoomIn}>
                <Plus />
              </button>
              <ZoomReadout />
              <button type="button" aria-label="Zoom out" title="Zoom out" onClick={zoomOut}>
                <Minus />
              </button>
              <button type="button" aria-label="Frame all (F)" title="Frame all (F)" onClick={frameAll}>
                <Scan />
              </button>
            </div>
          </Panel>
        </ReactFlow>
      </div>
    </CanvasActionsContext.Provider>
  );
};

/** The flow editor canvas. Reads everything from useFlowEditor(); one React Flow instance per plot. */
export const FlowCanvas: React.FC<{ className?: string }> = ({ className }) => {
  const { plotId } = useFlowEditor();
  return (
    <ReactFlowProvider key={plotId}>
      <Canvas className={className} />
    </ReactFlowProvider>
  );
};

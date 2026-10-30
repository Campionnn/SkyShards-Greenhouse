import React, { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { ArrowRight, Code, Eraser, Eye, Flag, Play, Plus, RotateCcw, SlidersHorizontal, StickyNote, Zap } from "lucide-react";
import { LayoutBoxes, MutationChip } from "../../flows/FlowVisuals";
import { NODE_W } from "./autoLayout";
import { useCanvasActions } from "./CanvasContext";
import { FRAME_TONE, type ExitRowData, type FrameTone, type StepNodeData } from "./CanvasModel";
import { EXIT_STYLE } from "./shared";

// The canvas nodes: a step (header, layout summary, ordered exit rows with one socket each),
// the "Start" pill and the frames drawn behind grouped steps. All memoised: their data objects
// only change when what they show changes (see dataSig in CanvasModel).

export type StepNodeType = Node<StepNodeData, "step">;

const KIND_ICON = { arrive: Zap, restart: RotateCcw, finish: Flag } as const;

const ExitRow: React.FC<{ step: number; j: number; row: ExitRowData; hot: boolean }> = ({ step, j, row, hot }) => {
  const actions = useCanvasActions();
  const st = EXIT_STYLE[row.kind];
  const Icon = row.kind === "arrive" || row.kind === "restart" || row.kind === "finish" ? KIND_ICON[row.kind] : null;
  return (
    <div
      className={`fg-xrow nodrag ${hot ? "is-hot" : ""}`}
      data-kind={row.kind}
      data-exit={j}
      style={{ "--sock": st.stroke, "--sock-hot": st.hot } as React.CSSProperties}
      onClick={(e) => {
        e.stopPropagation();
        actions.exitClick(step, j);
      }}
      onMouseEnter={() => actions.exitHover(step, j)}
      onMouseLeave={() => actions.exitHover(step, null)}
    >
      <span className="fg-xn">{j + 1}</span>
      {Icon && <Icon className={`fg-xicon ${st.text}`} aria-label={st.label} />}
      <span className="fg-xt" title={row.text}>
        {row.text}
      </span>
      <span className={`fg-to ${row.kind === "missing" ? "text-red-300" : ""}`} title={row.toTitle}>
        {row.to === "Finish" || row.to === "Missing" ? (
          row.to
        ) : (
          <>
            <ArrowRight aria-hidden />
            {row.to}
          </>
        )}
      </span>
      <Handle type="source" position={Position.Right} id={`x:${j}`} className="fg-sock" title="Drag onto a step to change where this exit goes" />
    </div>
  );
};

const StepNodeView: React.FC<NodeProps<StepNodeType>> = ({ data: d, selected }) => {
  const actions = useCanvasActions();
  const shown = d.targets.slice(0, 3);
  const more = d.targets.length - shown.length;
  const hotAll = d.hotRow === -2;
  return (
    <div className={`fg-node ${selected ? "is-sel" : ""}`} style={{ width: NODE_W }}>
      <div className="fg-nh">
        <Handle type="target" position={Position.Left} id="in" isConnectableStart={false} className={`fg-sock fg-sock-in ${d.inHot ? "is-hot" : ""}`} />
        {d.hiddenIn > 0 && (
          <span className="fg-inbadge" title={`${d.hiddenIn} other ${d.hiddenIn === 1 ? "step leads" : "steps lead"} here. Select one to see its wire.`}>
            {d.hiddenIn} in
          </span>
        )}
        <span className="fg-num">{d.index + 1}</span>
        <span className="fg-name" title={d.label}>
          {d.label}
        </span>
        {d.isStart && <span className="fg-pill fg-pill-start">START</span>}
        {d.scripted && (
          <span className="fg-pill fg-pill-script" title="Only the plot script enters this step (plot.goto)">
            <Code aria-hidden />
          </span>
        )}
      </div>
      <div className="fg-nb">
        <LayoutBoxes layout={d.layout} cell={7} className="fg-thumb" />
        <div className="fg-meta">
          {shown.length > 0 ? (
            <div className="fg-chips">
              {shown.map(([id, n]) => (
                <MutationChip key={id} id={id} count={n} />
              ))}
              {more > 0 && <span className="fg-more">+{more}</span>}
            </div>
          ) : (
            <span className="fg-sub">No targets</span>
          )}
          <span className="fg-sub">{d.plants ? `${d.plants} plants · ${d.kinds} kind${d.kinds === 1 ? "" : "s"}` : "Empty farmland"}</span>
          <div className="fg-badges">
            {d.targetSlots > 0 && (
              <span className="fg-badge" title={`${d.watched} of ${d.targetSlots} targets checked for uptime`}>
                <Eye aria-hidden />
                {d.watched}/{d.targetSlots}
              </span>
            )}
            {d.fullClear && (
              <span className="fg-badge" title="Breaks every plant on entry (full clear)">
                <Eraser aria-hidden />
                Clear
              </span>
            )}
            {d.overrides > 0 && (
              <span className="fg-badge fg-badge-warn" title={d.overridesTitle}>
                <SlidersHorizontal aria-hidden />
                {d.overrides} override{d.overrides === 1 ? "" : "s"}
              </span>
            )}
            {d.note && (
              <span className="fg-badge" title={d.note}>
                <StickyNote aria-hidden />
                Note
              </span>
            )}
          </div>
        </div>
      </div>
      {d.rows.length > 0 ? (
        <div className="fg-exits">
          {d.rows.map((row, j) => (
            <ExitRow key={j} step={d.index} j={j} row={row} hot={hotAll || d.hotRow === j} />
          ))}
          <div
            className="fg-addx nodrag"
            onClick={(e) => {
              e.stopPropagation();
              actions.addExit(d.index, { x: e.clientX, y: e.clientY });
            }}
          >
            <Plus aria-hidden /> Add exit
            <Handle type="source" position={Position.Right} id="add" className="fg-sock fg-sock-add" title="Drag to a step, or to empty space for a new step" />
          </div>
        </div>
      ) : (
        <div className="fg-stays">
          <span>No exits: the plot stays here</span>
          <span
            className="fg-addx-inline nodrag"
            role="button"
            aria-label="Add exit"
            title="Add exit"
            onClick={(e) => {
              e.stopPropagation();
              actions.addExit(d.index, { x: e.clientX, y: e.clientY });
            }}
          >
            <Plus aria-hidden />
          </span>
          <Handle type="source" position={Position.Right} id="add" className="fg-sock fg-sock-add" title="Drag to a step, or to empty space for a new step" />
        </div>
      )}
    </div>
  );
};

export const StepNode = memo(StepNodeView);

// ---- Start pill -----------------------------------------------------------------------------

export type StartNodeType = Node<Record<string, never>, "start">;

const StartNodeView: React.FC<NodeProps<StartNodeType>> = () => (
  <div className="fg-start" title="The plot starts here. Drag the socket onto a step to make it the start step.">
    <Play aria-hidden />
    Start
    <Handle type="source" position={Position.Right} id="start" className="fg-sock fg-sock-start" />
  </div>
);

export const StartNode = memo(StartNodeView);

// ---- Frames ---------------------------------------------------------------------------------

export type FrameNodeData = { label: string; sub: string; tone: FrameTone; members: number[]; w: number; h: number };
export type FrameNodeType = Node<FrameNodeData, "frame">;

const FrameNodeView: React.FC<NodeProps<FrameNodeType>> = ({ data }) => {
  const t = FRAME_TONE[data.tone];
  return (
    <div className="fg-frame" style={{ width: data.w, height: data.h, borderColor: t.border, background: t.fill }}>
      <div className="fg-frame-label" style={{ color: t.text }} title="Drag to move every step in this frame">
        {data.tone === "script" && <Code aria-hidden />}
        <span className="fg-frame-name">{data.label}</span>
        {data.sub && <span className="fg-frame-sub">· {data.sub}</span>}
      </div>
    </div>
  );
};

export const FrameNode = memo(FrameNodeView);

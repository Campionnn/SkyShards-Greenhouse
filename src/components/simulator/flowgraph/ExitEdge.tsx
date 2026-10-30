import React, { memo } from "react";
import type { Edge, EdgeProps } from "@xyflow/react";
import { wirePath, type Route } from "./CanvasModel";
import { EXIT_STYLE, type ExitKind } from "./shared";

// One wire per exit. Forward wires are beziers; back wires and wires that would cross nodes run
// orthogonally along a lane (see routeWires); self loops arc over their node. A chevron in the
// middle shows the direction. Colour transitions are 150ms (hover glow); nothing else animates.

export type ExitEdgeData = {
  kind: ExitKind;
  route: Route;
  /** Highlighted: the selected step's wires and the hovered exit. */
  hot: boolean;
  /** Something is selected and this wire isn't related to it. */
  dim: boolean;
};

export type ExitEdgeType = Edge<ExitEdgeData, "exit">;

const ExitEdgeView: React.FC<EdgeProps<ExitEdgeType>> = ({ sourceX, sourceY, targetX, targetY, data }) => {
  if (!data) return null;
  const st = EXIT_STYLE[data.kind];
  const color = data.hot ? st.hot : st.stroke;
  // Handles report their outer edge; start and end the wire at the socket centres.
  const { d, mid, angle } = wirePath(data.route, sourceX - 6, sourceY, targetX + 6, targetY);
  return (
    <g className={`fg-wire ${data.dim ? "is-dim" : ""}`}>
      <path d={d} className={`fg-wire-glow ${data.hot ? "is-on" : ""}`} style={{ stroke: st.hot }} />
      <path d={d} className="fg-wire-path" style={{ stroke: color, strokeWidth: data.hot ? 2.75 : 2.25 }} />
      {/* Wide invisible stroke so the wire is easy to hover. */}
      <path d={d} className="react-flow__edge-interaction" fill="none" strokeOpacity={0} strokeWidth={14} />
      <path d="M-5,-5 L4,0 L-5,5 Z" className="fg-wire-arrow" style={{ fill: color }} transform={`translate(${mid.x},${mid.y}) rotate(${angle})`} />
    </g>
  );
};

export const ExitEdge = memo(ExitEdgeView);

/** The wire from the Start pill to the start step. */
const StartEdgeView: React.FC<EdgeProps> = ({ sourceX, sourceY, targetX, targetY }) => {
  const { d } = wirePath({ type: "bezier" }, sourceX - 6, sourceY, targetX + 6, targetY);
  return <path d={d} className="fg-wire-path" style={{ stroke: "#34d399", strokeWidth: 2.25, opacity: 0.85 }} />;
};

export const StartEdge = memo(StartEdgeView);

import React from "react";
import { useDesigner, useGreenhouseData } from "../../../context";
import { cn } from "../../ui/cn";
import { InfoHint } from "../../ui/InfoHint";

/** The page's "?" next to the title: how the Designer works (instead of instruction lines on the page). */
export const DesignerPageHint: React.FC = () => (
  <InfoHint title="How the Designer works" width={320} label="How the Designer works">
    Pick a crop or mutation in the palette and click the grid to place it; drag to place a row. Inputs are the crops you plant, Targets the mutation spots you want. Check says which
    targets have what they need around them. Right-click removes, drag moves, Esc stops placing.
  </InfoHint>
);

/**
 * "35 cells · 8 ground · 3 of 5 valid": data only, next to the title. The input / target counts are on the
 * palette's Inputs | Targets switch, so they are not repeated here. `compact` (phone) drops the ground.
 */
export const DesignerFacts: React.FC<{ compact?: boolean; className?: string }> = ({ compact, className }) => {
  const { inputPlacements, targetPlacements, groundTiles, getTargetValidation } = useDesigner();
  const { mutations } = useGreenhouseData();
  const cells = [...inputPlacements, ...targetPlacements].reduce((n, p) => n + p.size * p.size, 0);
  const valid = targetPlacements.filter((t) => getTargetValidation(t.id, mutations).isValid).length;
  const targets = targetPlacements.length;
  const bad = targets > 0 && valid < targets;
  return (
    <p className={cn("min-w-0 truncate text-secondary tabular-nums text-fg-meta", className)}>
      {cells} cells{groundTiles.length > 0 && !compact && ` · ${groundTiles.length} ground`}
      {targets > 0 && (
        <>
          {" · "}
          <span className={bad ? "font-semibold text-problem" : "text-fg-body"}>
            {valid} of {targets} valid
          </span>
        </>
      )}
    </p>
  );
};

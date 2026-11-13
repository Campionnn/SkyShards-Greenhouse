/** Unique crops (C10): keep at least N different crops (0 = off), as one settings row. */
import React from "react";
import { InfoHint } from "../ui/InfoHint";
import { MAX_UNIQUE_CROPS, setUniqueCrops, useUniqueCrops } from "./uniqueCrops";

export const UniqueCropsPanel: React.FC = () => {
  const value = useUniqueCrops();
  return (
    <div className="flex items-center justify-between gap-3 text-body text-fg-body">
      <span className="flex items-center gap-1.5 whitespace-nowrap">
        Unique crops
        <InfoHint title="Unique crops">
          Keep at least this many different crops in the greenhouse. Each gives +2.5% growth speed and yield, up to {MAX_UNIQUE_CROPS} (your Flora shard counts toward them).
        </InfoHint>
      </span>
      <span className="flex items-center gap-2">
        <input
          type="range"
          min={0}
          max={MAX_UNIQUE_CROPS}
          step={1}
          value={value}
          onChange={(e) => setUniqueCrops(Number(e.target.value))}
          aria-label="Unique crops"
          aria-valuetext={value === 0 ? "Off" : String(value)}
          className="focus-ring h-1.5 w-20 min-w-0 cursor-pointer accent-select"
        />
        <span className="w-6 text-right text-secondary tabular-nums text-fg-meta">{value === 0 ? "Off" : value}</span>
      </span>
    </div>
  );
};

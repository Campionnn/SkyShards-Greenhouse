import React from "react";
import { Sprout } from "lucide-react";
import { Panel } from "../ui";
import { MAX_UNIQUE_CROPS, setUniqueCrops, useUniqueCrops } from "./uniqueCrops";

export const UniqueCropsPanel: React.FC = () => {
  const value = useUniqueCrops();
  return (
    <Panel
      title="Unique Crops"
      icon={<Sprout />}
      actions={<span className="text-xs font-medium text-slate-300">{value === 0 ? "Off" : value}</span>}
      description="Keep at least this many different crops in the greenhouse. Sunflower/moonflower and red/brown mushroom each count once. Locked crops and the targets' ingredients count too."
    >
      <input
        type="range"
        min={0}
        max={MAX_UNIQUE_CROPS}
        step={1}
        value={value}
        onChange={(e) => setUniqueCrops(Number(e.target.value))}
        aria-label="Unique crops"
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-slate-600/60 accent-emerald-500"
      />
      <div className="flex justify-between text-xs text-slate-500 mt-1">
        <span>0</span>
        <span>{MAX_UNIQUE_CROPS}</span>
      </div>
    </Panel>
  );
};

import React from "react";
import { Eye, EyeOff } from "lucide-react";

const GROUP = "flex rounded-md border border-slate-600/40 bg-slate-800/60 p-0.5";
const SEGMENT = "flex items-center gap-1 px-1.5 py-0.5 text-xs rounded transition-colors cursor-pointer";
const ACTIVE = { emerald: "bg-emerald-500/20 text-emerald-200", cyan: "bg-cyan-500/20 text-cyan-200" } as const;

/** "Label: Shown | Hidden". */
const VisibilitySwitch: React.FC<{
  label: string;
  what: string;
  visible: boolean;
  onChange: (visible: boolean) => void;
  tone: keyof typeof ACTIVE;
}> = ({ label, what, visible, onChange, tone }) => (
  <div className="flex items-center gap-1.5">
    <span className="text-[11px] text-slate-500 hidden sm:inline">{label}</span>
    <div className={GROUP} role="radiogroup" aria-label={`Whether ${what} are drawn`}>
      {([true, false] as const).map((shown) => {
        const active = visible === shown;
        return (
          <button
            key={String(shown)}
            type="button"
            role="radio"
            aria-checked={active}
            title={shown ? `Draw the ${what}` : `Hide the ${what}; only their ground shows`}
            onClick={() => onChange(shown)}
            className={`${SEGMENT} ${active ? ACTIVE[tone] : "text-slate-400 hover:text-slate-200 hover:bg-slate-700/60"}`}
          >
            {shown ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{shown ? "Shown" : "Hidden"}</span>
          </button>
        );
      })}
    </div>
  </div>
);

/**
 * Grid header switches: "Inputs: Shown | Hidden" and "Targets: Shown | Hidden". A hidden
 * placement shows only its ground, so with both hidden the grid shows just the ground.
 */
export const GridVisibilityToggle: React.FC<{
  inputsVisible: boolean;
  onInputsVisibleChange: (visible: boolean) => void;
  targetsVisible: boolean;
  onTargetsVisibleChange: (visible: boolean) => void;
  className?: string;
}> = ({ inputsVisible, onInputsVisibleChange, targetsVisible, onTargetsVisibleChange, className = "" }) => (
  <div className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 ${className}`}>
    <VisibilitySwitch label="Inputs" what="input crops" visible={inputsVisible} onChange={onInputsVisibleChange} tone="emerald" />
    <VisibilitySwitch label="Targets" what="target mutations" visible={targetsVisible} onChange={onTargetsVisibleChange} tone="cyan" />
  </div>
);

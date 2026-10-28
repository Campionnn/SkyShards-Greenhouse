import React from "react";
import { Eye, EyeOff, Sprout, SquareDashed } from "lucide-react";
import { TARGET_DISPLAYS, type TargetDisplay } from "../../constants";
import { TARGET_DISPLAY_HINT, TARGET_DISPLAY_LABEL } from "./placementStyles";

const ICON: Record<TargetDisplay, React.ReactNode> = {
  solid: <Eye className="w-3.5 h-3.5" />,
  faded: <SquareDashed className="w-3.5 h-3.5" />,
  hidden: <EyeOff className="w-3.5 h-3.5" />,
};

const GROUP = "flex rounded-md border border-slate-600/40 bg-slate-800/60 p-0.5";
const SEGMENT = "flex items-center gap-1 px-1.5 py-0.5 text-xs rounded transition-colors cursor-pointer";
const segmentTone = (active: boolean, tone: "cyan" | "emerald") =>
  active
    ? tone === "cyan"
      ? "bg-cyan-500/20 text-cyan-200"
      : "bg-emerald-500/20 text-emerald-200"
    : "text-slate-400 hover:text-slate-200 hover:bg-slate-700/60";

/**
 * Grid display switches for the grid header: "Inputs: Shown | Hidden" (when `onInputsVisibleChange`
 * is given) and "Targets: Solid | Faded | Hidden". With both hidden only the ground is left.
 */
export const TargetDisplayToggle: React.FC<{
  value: TargetDisplay;
  onChange: (display: TargetDisplay) => void;
  inputsVisible?: boolean;
  onInputsVisibleChange?: (visible: boolean) => void;
  className?: string;
}> = ({ value, onChange, inputsVisible = true, onInputsVisibleChange, className = "" }) => (
  <div className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 ${className}`}>
    {onInputsVisibleChange && (
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-slate-500 hidden sm:inline">Inputs</span>
        <div className={GROUP} role="radiogroup" aria-label="Whether input crops are drawn">
          {([true, false] as const).map((shown) => {
            const active = inputsVisible === shown;
            return (
              <button
                key={String(shown)}
                type="button"
                role="radio"
                aria-checked={active}
                title={shown ? "Draw the crops you plant" : "Hide the crops you plant; only their ground shows"}
                onClick={() => onInputsVisibleChange(shown)}
                className={`${SEGMENT} ${segmentTone(active, "emerald")}`}
              >
                {shown ? <Sprout className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                <span className="hidden sm:inline">{shown ? "Shown" : "Hidden"}</span>
              </button>
            );
          })}
        </div>
      </div>
    )}
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] text-slate-500 hidden sm:inline">Targets</span>
      <div className={GROUP} role="radiogroup" aria-label="How target mutations are drawn">
        {TARGET_DISPLAYS.map((d) => {
          const active = d === value;
          return (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={active}
              title={TARGET_DISPLAY_HINT[d]}
              onClick={() => onChange(d)}
              className={`${SEGMENT} ${segmentTone(active, "cyan")}`}
            >
              {ICON[d]}
              <span className="hidden sm:inline">{TARGET_DISPLAY_LABEL[d]}</span>
            </button>
          );
        })}
      </div>
    </div>
  </div>
);

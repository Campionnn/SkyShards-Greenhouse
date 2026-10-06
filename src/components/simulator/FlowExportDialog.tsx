import React, { useEffect, useRef, useState } from "react";
import { Download, X } from "lucide-react";
import { Portal } from "../ui";
import { DEFAULT_FLOW_EXPORT_OPTIONS, type FlowExportOptions } from "./scenarioEdit";
import { buttonClass } from "./styles";

const EXPORT_SECTIONS: { key: keyof FlowExportOptions; label: string; description: string }[] = [
  { key: "startingInventory", label: "Starting inventory", description: "The items and amounts configured for the start of the run, not the live inventory." },
  { key: "playerSettings", label: "Player settings", description: "Player stats, upgrades, accessories and farming armor." },
  { key: "onlineSchedule", label: "Online schedule", description: "When the player comes online and the starting time of day." },
  { key: "actionDefaults", label: "Action defaults", description: "Default harvesting, watering and upkeep policies, plus the Player actions switch." },
  { key: "advancedSettings", label: "Advanced settings", description: "Simulator model switches and tunable values." },
  { key: "seed", label: "Random seed", description: "The seed used for reproducible simulation results." },
];

type ExportProps = { onClose: () => void; onExport: (options: FlowExportOptions) => void };

/** Native modal dialog supplies Escape dismissal and an inert background; Tab wraps within it. */
export const FlowExportDialog: React.FC<ExportProps> = (props) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const { onClose } = props;
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  return (
    <Portal>
      <dialog
        ref={dialog}
        aria-labelledby="flow-export-title"
        aria-describedby="flow-export-description"
        className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-lg max-h-[calc(100dvh-2rem)] p-0 rounded-xl border border-slate-700 bg-slate-900 text-slate-200 shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm"
        onCancel={(e) => { e.preventDefault(); onClose(); }}
        onKeyDown={(e) => {
          if (e.key !== "Tab") return;
          const controls = e.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)");
          const first = controls[0];
          const last = controls[controls.length - 1];
          if ((e.shiftKey && document.activeElement === first) || (!e.shiftKey && document.activeElement === last)) {
            e.preventDefault();
            (e.shiftKey ? last : first)?.focus();
          }
        }}
        onClick={(e) => {
          if (e.target !== e.currentTarget) return;
          const bounds = e.currentTarget.getBoundingClientRect();
          if (e.clientX < bounds.left || e.clientX > bounds.right || e.clientY < bounds.top || e.clientY > bounds.bottom) onClose();
        }}
      >
        <FlowExportPanel {...props} />
      </dialog>
    </Portal>
  );
};

/** Kept separate from the portal for server-render regression tests. */
export const FlowExportPanel: React.FC<ExportProps> = ({ onClose, onExport }) => {
  const [options, setOptions] = useState<FlowExportOptions>(() => ({ ...DEFAULT_FLOW_EXPORT_OPTIONS }));
  return (
    <form
      className="flex flex-col max-h-[calc(100dvh-2rem)]"
      onSubmit={(e) => { e.preventDefault(); onExport(options); }}
    >
      <div className="flex items-center justify-between gap-3 border-b border-slate-700 px-4 py-3 sm:px-5">
        <h2 id="flow-export-title" className="text-base font-semibold text-slate-100">Export flows</h2>
        <button type="button" className={`${buttonClass.icon} p-2`} onClick={onClose} aria-label="Close export dialog">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="min-h-0 overflow-y-auto px-4 py-4 sm:px-5 space-y-3">
        <p id="flow-export-description" className="text-xs leading-relaxed text-slate-400">
          Choose what to include in your JSON. By default, only flows are exported, just like before.
        </p>
        <label className="flex items-start gap-3 rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3">
          <input type="checkbox" checked disabled className="mt-0.5 accent-emerald-500" />
          <span className="min-w-0">
            <span className="block text-xs font-medium text-emerald-200">Flows and layouts <span className="font-normal text-emerald-400/70">· Always included</span></span>
            <span className="block mt-1 text-[11px] leading-relaxed text-slate-400">All plots, steps, layouts, exits, loops, checked targets and plot/step policy overrides.</span>
          </span>
        </label>
        <fieldset className="space-y-1">
          <legend className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">Optional setup</legend>
          {EXPORT_SECTIONS.map(({ key, label, description }) => (
            <label key={key} className="flex items-start gap-3 rounded-lg p-2.5 hover:bg-slate-800/70 transition-colors cursor-pointer">
              <input type="checkbox" checked={options[key]} onChange={(e) => setOptions({ ...options, [key]: e.target.checked })} className="mt-0.5 accent-emerald-500" />
              <span className="min-w-0">
                <span className="block text-xs font-medium text-slate-200">{label}</span>
                <span className="block mt-1 text-[11px] leading-relaxed text-slate-400">{description}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <p className="text-[11px] leading-relaxed text-slate-500">On import, included setup replaces the matching settings. Anything left out stays unchanged.</p>
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-700 px-4 py-3 sm:px-5">
        <button type="button" className={buttonClass.neutral} onClick={onClose}>Cancel</button>
        <button type="submit" className={buttonClass.primary}><Download className="w-3.5 h-3.5" /> Download JSON</button>
      </div>
    </form>
  );
};

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { X, Save, AlertTriangle } from "lucide-react";
import { useDesigner, useGreenhouseData } from "../../context";
import { summarizeTargets } from "../../utilities";
import { Portal } from "../ui";
import { LayoutPreview } from "./LoadLayoutModal";

interface SaveLayoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (name: string, overwriteId?: string) => void;
  existingLayouts: Array<{ id: string; name: string }>;
}

const MAX_NAME = 50;

export const SaveLayoutModal: React.FC<SaveLayoutModalProps> = (props) => {
  if (!props.isOpen) return null;
  // Mounted fresh on each open, so the name and errors reset.
  return <SaveLayoutDialog {...props} />;
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const SaveLayoutDialog: React.FC<SaveLayoutModalProps> = ({ onClose, onSave, existingLayouts }) => {
  const { inputPlacements, targetPlacements, groundTiles } = useDesigner();
  const { getCropDef, getMutationDef } = useGreenhouseData();
  const nameOf = useCallback(
    (id: string) => getMutationDef(id)?.name || getCropDef(id)?.name || id.replace(/_/g, " "),
    [getCropDef, getMutationDef]
  );

  // Suggest a name from the targets, so saving is one keypress away.
  const [name, setName] = useState(() => summarizeTargets(targetPlacements, nameOf)?.slice(0, MAX_NAME) ?? "");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", handleEscape);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const trimmed = name.trim();
  const existing = useMemo(() => existingLayouts.find((l) => l.name === trimmed) ?? null, [existingLayouts, trimmed]);

  // Target mutations with counts, most common first.
  const targetCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of targetPlacements) counts.set(p.cropId, (counts.get(p.cropId) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || nameOf(a[0]).localeCompare(nameOf(b[0])));
  }, [targetPlacements, nameOf]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimmed) {
      setError("Give the layout a name");
      inputRef.current?.focus();
      return;
    }
    onSave(trimmed, existing?.id);
  };

  const preview = useMemo(() => ({ inputs: inputPlacements, targets: targetPlacements }), [inputPlacements, targetPlacements]);

  return (
    <Portal>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/60 backdrop-blur-sm overflow-y-auto"
        onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      >
        <form
          role="dialog"
          aria-modal="true"
          aria-labelledby="save-layout-title"
          onSubmit={handleSubmit}
          className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-lg max-h-[92vh] my-auto overflow-hidden flex flex-col"
        >
          <div className="border-b border-slate-700/70 px-4 py-3 flex items-center justify-between flex-shrink-0">
            <h2 id="save-layout-title" className="text-sm font-medium text-slate-100">
              Save this layout
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-700/60 transition-colors cursor-pointer"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-dark p-4 space-y-4">
            <div className="flex flex-col sm:flex-row gap-4 items-center sm:items-start">
              <LayoutPreview layout={preview} cellSize={12} />

              <div className="min-w-0 flex-1 w-full space-y-3">
                <div>
                  <div className="flex items-baseline justify-between mb-1.5">
                    <label htmlFor="layout-name" className="text-xs font-medium text-slate-300">
                      Name
                    </label>
                    <span className={`text-[11px] tabular-nums ${name.length >= MAX_NAME ? "text-amber-400" : "text-slate-500"}`}>
                      {name.length}/{MAX_NAME}
                    </span>
                  </div>
                  <input
                    ref={inputRef}
                    id="layout-name"
                    type="text"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      setError("");
                    }}
                    placeholder="e.g. Chloronite farm"
                    maxLength={MAX_NAME}
                    autoComplete="off"
                    aria-invalid={!!error}
                    aria-describedby="layout-name-hint"
                    className={`w-full px-2.5 py-1.5 bg-slate-900/60 border rounded-md text-sm text-slate-100 placeholder-slate-500 focus:outline-none transition-colors ${
                      error
                        ? "border-red-500/60"
                        : existing
                          ? "border-amber-500/50 focus:border-amber-500/70"
                          : "border-slate-600/40 focus:border-emerald-500/60"
                    }`}
                  />
                  <div id="layout-name-hint" className="min-h-[1.25rem] mt-1">
                    {error ? (
                      <p className="text-xs text-red-400">{error}</p>
                    ) : existing ? (
                      <p className="text-xs text-amber-300/90 flex items-start gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 mt-px flex-shrink-0" />
                        <span>Replaces the saved layout with this name.</span>
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-purple-500/10 text-purple-300 border border-purple-500/20">
                    {plural(targetPlacements.length, "target")}
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                    {plural(inputPlacements.length, "input")}
                  </span>
                  {groundTiles.length > 0 && (
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/10 text-amber-300 border border-amber-500/20">
                      {plural(groundTiles.length, "ground tile")}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {targetCounts.length > 0 && (
              <div className="rounded-lg border border-slate-600/30 bg-slate-800/40 p-3">
                <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">Target mutations</div>
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 max-h-32 overflow-y-auto scrollbar-dark">
                  {targetCounts.map(([id, count]) => (
                    <li key={id} className="flex items-center justify-between gap-2 text-xs min-w-0">
                      <span className="text-slate-200 truncate">{nameOf(id)}</span>
                      <span className="text-slate-500 tabular-nums flex-shrink-0">x{count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="border-t border-slate-700/70 px-4 py-3 flex flex-wrap items-center justify-end gap-2 flex-shrink-0">
            <div className="mr-auto text-[11px] text-slate-500">Saved in this browser. Open it later from Load.</div>
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-slate-700/40 hover:bg-slate-700/70 text-slate-300 border border-slate-600/30 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!trimmed}
              className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 ${
                existing
                  ? "bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border-amber-500/30"
                  : "bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border-emerald-500/30"
              }`}
            >
              <Save className="w-3.5 h-3.5" />
              {existing ? "Overwrite layout" : "Save layout"}
            </button>
          </div>
        </form>
      </div>
    </Portal>
  );
};

import React, { useEffect, useMemo, useState } from "react";
import { Calculator, ClipboardPaste, FolderOpen, Layers, Palette, X } from "lucide-react";
import type { Scenario } from "../../simulator";
import {
  decodeDesign,
  encodeDesign,
  extractLayoutCode,
  loadLayouts,
  LocalStorageManager,
  SOURCE_LABEL,
  summarizeTargets,
  type HandoffSource,
  type IncomingLayout,
} from "../../utilities";
import { LayoutPreview } from "../designer";
import { Portal } from "../ui";
import { nameOf } from "./format";
import { layoutDestinations, type LayoutDestination } from "./scenarioEdit";
import { buttonClass, inputClass } from "./styles";

// Pick a layout from the Calculator, the Designer or the saved layouts (or a
// pasted share link) and say where it goes. Nothing here runs the engine.

type Preview = { inputs: { cropId: string; position: [number, number] }[]; targets: { cropId: string; position: [number, number] }[] };

interface LayoutSource extends IncomingLayout {
  key: string;
  /** Card heading; `name` is what the step gets called. */
  title: string;
  detail: string;
  preview: Preview;
}

const SOURCE_ICON: Record<HandoffSource, React.ReactNode> = {
  calculator: <Calculator className="w-3.5 h-3.5 text-emerald-400" />,
  designer: <Palette className="w-3.5 h-3.5 text-blue-400" />,
  saved: <FolderOpen className="w-3.5 h-3.5 text-slate-400" />,
  link: <ClipboardPaste className="w-3.5 h-3.5 text-amber-400" />,
};

const counts = (p: Preview) => `${p.targets.length} target${p.targets.length === 1 ? "" : "s"} · ${p.inputs.length} plant${p.inputs.length === 1 ? "" : "s"}`;

function sourceFromCode(key: string, from: HandoffSource, code: string, title: string, name?: string, detail?: string): LayoutSource | null {
  try {
    const preview = decodeDesign(code);
    const summary = summarizeTargets(preview.targets, nameOf);
    return { key, from, code, title, name: name ?? summary ?? title, detail: detail ?? summary ?? counts(preview), preview };
  } catch {
    return null;
  }
}

/** Everything the user has on this device: last Calculator result, the Designer's current layout, saved layouts. */
function gatherLayoutSources(): LayoutSource[] {
  const out: LayoutSource[] = [];
  const last = LocalStorageManager.loadLastSolverLayout();
  if (last) {
    const s = sourceFromCode("calculator", "calculator", last.code, "Last Calculator result", last.name);
    if (s) out.push(s);
  }
  const di = LocalStorageManager.loadDesignerInputs() ?? [];
  const dt = LocalStorageManager.loadDesignerTargets() ?? [];
  const dg = LocalStorageManager.loadDesignerGroundTiles() ?? [];
  if (di.length || dt.length || dg.length) {
    try {
      const code = encodeDesign(di, dt, dg);
      const s = sourceFromCode("designer", "designer", code, "Current Designer layout", summarizeTargets(dt, nameOf) ?? "Designer layout");
      if (s) out.push(s);
    } catch {
      // A corrupt saved design is simply not offered.
    }
  }
  for (const l of [...loadLayouts()].sort((a, b) => b.modifiedAt - a.modifiedAt)) {
    try {
      const code = encodeDesign(l.inputs, l.targets, l.groundTiles ?? []);
      const s = sourceFromCode(`saved:${l.id}`, "saved", code, l.name, l.name);
      if (s) out.push(s);
    } catch {
      // skip
    }
  }
  return out;
}

const SourceCard: React.FC<{ source: LayoutSource; selected: boolean; onSelect: () => void; large?: boolean }> = ({ source, selected, onSelect, large }) => (
  <button
    type="button"
    onClick={onSelect}
    aria-pressed={selected}
    className={`w-full text-left flex gap-3 items-center rounded-lg border p-2.5 transition-colors cursor-pointer ${
      selected ? "border-emerald-500/60 bg-emerald-500/10" : "border-slate-600/30 bg-slate-800/40 hover:border-slate-500/60 hover:bg-slate-800/70"
    }`}
  >
    <LayoutPreview layout={source.preview} cellSize={large ? 16 : 8} />
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
        {SOURCE_ICON[source.from]}
        {SOURCE_LABEL[source.from]}
      </div>
      <div className="text-sm text-slate-100 break-words">{source.title}</div>
      {source.detail !== source.title && <div className="text-xs text-slate-400 break-words">{source.detail}</div>}
      {large && counts(source.preview) !== source.detail && <div className="text-[11px] text-slate-500 mt-0.5">{counts(source.preview)}</div>}
    </div>
  </button>
);

/** Paste one link to pick it, or several to load them all as plots. */
const PasteLinks: React.FC<{ onPicked: (s: LayoutSource | null) => void; onLoadMany?: (codes: string[]) => void }> = ({ onPicked, onLoadMany }) => {
  const [text, setText] = useState("");
  const parsed = useMemo(() => {
    const parts = text.split(/\s+/).map((l) => l.trim()).filter(Boolean);
    const codes: string[] = [];
    for (const part of parts) {
      const code = extractLayoutCode(part);
      try {
        decodeDesign(code);
        codes.push(code);
      } catch {
        return { codes, error: `Could not read "${part.length > 40 ? `${part.slice(0, 40)}...` : part}"` };
      }
    }
    return { codes, error: null as string | null };
  }, [text]);

  useEffect(() => {
    onPicked(parsed.codes.length === 1 && !parsed.error ? sourceFromCode("link", "link", parsed.codes[0], "Pasted share link") : null);
  }, [parsed, onPicked]);

  return (
    <div className="space-y-1.5">
      <textarea
        className={`${inputClass} w-full h-14 resize-none`}
        placeholder="Or paste a SkyShards share link (several, one per line, load as separate plots)"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {parsed.error && text.trim() && <div className="text-xs text-red-300">{parsed.error}</div>}
      {parsed.codes.length > 1 && !parsed.error && onLoadMany && (
        <button className={buttonClass.primary} onClick={() => onLoadMany(parsed.codes.slice(0, 3))}>
          <Layers className="w-3.5 h-3.5" /> Load {Math.min(3, parsed.codes.length)} links as plots (replaces the scenario)
        </button>
      )}
    </div>
  );
};

function useDialogChrome(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
}

/**
 * The layout picker. With `scenario` it ends in a choice of where the layout
 * goes (new plot / replace / next step); with `onUse` it ends in one button
 * (used by the flow editor for the current step). `incoming` skips the
 * list: the layout was already chosen on another page.
 */
type PickerProps = {
  title: string;
  onClose: () => void;
  incoming?: IncomingLayout | null;
  scenario?: Scenario;
  onPlace?: (layout: IncomingLayout, dest: LayoutDestination) => void;
  onUse?: (layout: IncomingLayout) => void;
  useLabel?: string;
  onLoadMany?: (codes: string[]) => void;
};

export const LayoutPickerDialog: React.FC<PickerProps> = (props) => {
  useDialogChrome(props.onClose);
  return (
    <Portal>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/60 backdrop-blur-sm overflow-y-auto"
        onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}
      >
        <LayoutPickerPanel {...props} />
      </div>
    </Portal>
  );
};

/** The picker's content, without the overlay (exported for the SSR smoke test). */
export const LayoutPickerPanel: React.FC<PickerProps> = ({ title, onClose, incoming, scenario, onPlace, onUse, useLabel = "Use this layout", onLoadMany }) => {
  const sources = useMemo(() => {
    if (incoming) {
      const s = sourceFromCode("incoming", incoming.from, incoming.code, incoming.name, incoming.name);
      return s ? [s] : [];
    }
    return gatherLayoutSources();
  }, [incoming]);
  const [pasted, setPasted] = useState<LayoutSource | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(() => sources[0]?.key ?? null);
  const onPicked = React.useCallback((s: LayoutSource | null) => {
    setPasted(s);
    if (s) setSelectedKey(s.key);
  }, []);
  const selected = (selectedKey === "link" ? pasted : sources.find((s) => s.key === selectedKey)) ?? null;
  const destinations = scenario ? layoutDestinations(scenario) : [];

  return (
        <div role="dialog" aria-modal="true" aria-label={title} className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-3xl max-h-[92vh] my-auto flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/70">
            <h2 className="text-sm font-medium text-slate-100">{title}</h2>
            <button className={buttonClass.icon} onClick={onClose} aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-dark p-4 space-y-3">
            {incoming ? (
              sources[0] ? (
                <SourceCard source={sources[0]} selected large onSelect={() => {}} />
              ) : (
                <div className="text-xs text-red-300">That layout could not be read.</div>
              )
            ) : (
              <>
                {sources.length ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {sources.map((s) => (
                      <SourceCard key={s.key} source={s} selected={s.key === selectedKey} onSelect={() => setSelectedKey(s.key)} />
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">
                    Nothing to load yet. Solve in the Calculator or build a layout in the Designer and press <span className="text-slate-200">Simulate</span> there, or paste a share link below.
                  </p>
                )}
                {pasted && <SourceCard source={pasted} selected={selectedKey === "link"} onSelect={() => setSelectedKey("link")} />}
                <PasteLinks onPicked={onPicked} onLoadMany={onLoadMany} />
              </>
            )}
          </div>

          <div className="border-t border-slate-700/70 px-4 py-3">
            {onUse ? (
              <div className="flex justify-end gap-2">
                <button className={buttonClass.neutral} onClick={onClose}>
                  Cancel
                </button>
                <button className={buttonClass.primary} disabled={!selected} onClick={() => selected && onUse(selected)}>
                  {useLabel}
                </button>
              </div>
            ) : (
              <>
                <div className="text-[11px] text-slate-500 uppercase tracking-wide mb-2">Where should it go?</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {destinations.map((d) => (
                    <button
                      key={d.label}
                      disabled={!selected}
                      onClick={() => selected && onPlace?.(selected, d.dest)}
                      className="flex flex-col items-start text-left px-3 py-2 rounded-md border text-xs font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed bg-slate-700/40 hover:bg-slate-700/70 hover:border-slate-500/60 text-slate-200 border-slate-600/30"
                    >
                      <span>{d.label}</span>
                      <span className="text-[11px] font-normal text-slate-400 break-words">{d.hint}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
  );
};

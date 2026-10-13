import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { X, Trash2, FolderOpen, Search, Edit2, Check } from "lucide-react";
import type { OptimizedPlacement, SavedLayout } from "../../types/layout";
import { getCropPreviewColor } from "../../data/cropColors";
import { useGreenhouseData } from "../../context";
import { decodeDesign, extractLayoutCode, LocalStorageManager, summarizeTargets, type GroundTile, type HandoffSource } from "../../utilities";
import { Portal } from "../ui";
import { LayoutSourceBadge } from "./LayoutSourceBadge";

/** A layout as the Designer loads it. */
export interface LoadableLayout {
  inputs: OptimizedPlacement[];
  targets: OptimizedPlacement[];
  groundTiles: GroundTile[];
}

interface LoadLayoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** `name` is shown in the "Layout loaded" toast. */
  onLoad: (layout: LoadableLayout, name: string) => void;
  onDelete: (layoutId: string) => void;
  onRename: (layoutId: string, newName: string) => void;
  layouts: SavedLayout[];
  /** The Designer already holds a layout, so loading replaces it. */
  replacing?: boolean;
}

/** Mini grid preview of a layout: inputs and targets as coloured cells. */
export const LayoutPreview: React.FC<{ layout: Pick<SavedLayout, "inputs" | "targets">; cellSize?: number }> = ({ layout, cellSize = 14 }) => {
  const { getCropDef, getMutationDef } = useGreenhouseData();
  const gap = 1; // px
  const gridSize = 10;

  const cellMap = useMemo(() => {
    const map = new Map<string, { cropId: string; isTarget: boolean }>();

    layout.inputs.forEach(placement => {
      const [row, col] = placement.position;
      const cropDef = getCropDef(placement.cropId);
      const mutationDef = getMutationDef(placement.cropId);
      const size = cropDef?.size || mutationDef?.size || 1;
      
      for (let dr = 0; dr < size; dr++) {
        for (let dc = 0; dc < size; dc++) {
          map.set(`${row + dr},${col + dc}`, { cropId: placement.cropId, isTarget: false });
        }
      }
    });

    layout.targets.forEach(placement => {
      const [row, col] = placement.position;
      const mutationDef = getMutationDef(placement.cropId);
      const cropDef = getCropDef(placement.cropId);
      const size = mutationDef?.size || cropDef?.size || 1;
      
      for (let dr = 0; dr < size; dr++) {
        for (let dc = 0; dc < size; dc++) {
          map.set(`${row + dr},${col + dc}`, { cropId: placement.cropId, isTarget: true });
        }
      }
    });

    return map;
  }, [layout, getCropDef, getMutationDef]);

  return (
    <div 
      className="inline-block flex-shrink-0 bg-slate-950 rounded border border-slate-700/50 p-1"
      style={{
        width: gridSize * cellSize + (gridSize - 1) * gap + 8, // +8 for p-1 padding
        height: gridSize * cellSize + (gridSize - 1) * gap + 8,
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${gridSize}, ${cellSize}px)`,
          gridTemplateRows: `repeat(${gridSize}, ${cellSize}px)`,
          gap: `${gap}px`,
        }}
      >
        {Array.from({ length: gridSize * gridSize }, (_, i) => {
          const row = Math.floor(i / gridSize);
          const col = i % gridSize;
          const cellData = cellMap.get(`${row},${col}`);

          const bgColor = cellData
            ? getCropPreviewColor(cellData.cropId, cellData.isTarget)
            : '#1e293b'; // slate-800, empty

          return (
            <div
              key={i}
              style={{
                width: `${cellSize}px`,
                height: `${cellSize}px`,
                backgroundColor: bgColor,
                borderRadius: '2px',
              }}
            />
          );
        })}
      </div>
    </div>
  );
};

// ---- Layout sources ---------------------------------------------------------

/** One loadable layout card: a saved layout, the last Calculator result or a pasted link. */
interface LayoutEntry {
  key: string;
  from: HandoffSource;
  title: string;
  /** Most common targets ("Chloronite x4, ..."), when there are any. */
  detail: string | null;
  layout: LoadableLayout;
  /** " · Modified Oct 4, 2026" after the source label. */
  date?: string;
  /** Present for saved layouts, which can be renamed and deleted. */
  saved?: SavedLayout;
}

const counts = (l: LoadableLayout) =>
  `${l.targets.length} target${l.targets.length === 1 ? "" : "s"} · ${l.inputs.length} input${l.inputs.length === 1 ? "" : "s"}`;

const formatDate = (timestamp: number) =>
  new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

function decodeEntry(key: string, from: HandoffSource, code: string, title: string, nameOf: (id: string) => string, date?: string): LayoutEntry | null {
  try {
    const layout = decodeDesign(code);
    return { key, from, title, detail: summarizeTargets(layout.targets, nameOf), layout, date };
  } catch {
    return null;
  }
}

type PasteResult = { entry: LayoutEntry | null; error: string | null };

function readPasted(text: string, nameOf: (id: string) => string): PasteResult {
  const parts = text.split(/\s+/).filter(Boolean);
  if (!parts.length) return { entry: null, error: null };
  if (parts.length > 1) return { entry: null, error: "The Designer holds one layout: paste a single link." };
  const entry = decodeEntry("link", "link", extractLayoutCode(parts[0]), "Pasted share link", nameOf);
  if (!entry) {
    const part = parts[0];
    return { entry: null, error: `Could not read "${part.length > 40 ? `${part.slice(0, 40)}...` : part}"` };
  }
  return { entry, error: null };
}

// ---- Card -------------------------------------------------------------------

const LayoutCard: React.FC<{
  entry: LayoutEntry;
  selected: boolean;
  onSelect: () => void;
  onLoad: () => void;
  onDelete?: () => void;
  onRename?: (newName: string) => void;
}> = ({ entry, selected, onSelect, onLoad, onDelete, onRename }) => {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(entry.title);
  const [renameError, setRenameError] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [isRenaming]);

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!showDeleteConfirm) {
      setShowDeleteConfirm(true);
      return;
    }
    onDelete?.();
  };

  const handleRenameSubmit = () => {
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setRenameError("Name cannot be empty");
      return;
    }
    if (trimmed !== entry.title) onRename?.(trimmed); // the parent checks for duplicate names
    setIsRenaming(false);
    setRenameValue(trimmed);
    setRenameError("");
  };

  const handleRenameCancel = () => {
    setIsRenaming(false);
    setRenameValue(entry.title);
    setRenameError("");
  };

  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={0}
      onClick={onSelect}
      onDoubleClick={() => !isRenaming && onLoad()}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter") onLoad();
        else if (e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      title="Click to select, double-click to load"
      className={`group relative flex gap-3 items-center rounded-lg border p-2.5 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 ${
        selected ? "border-emerald-500/60 bg-emerald-500/10" : "border-slate-600/30 bg-slate-800/40 hover:border-slate-500/60 hover:bg-slate-800/70"
      }`}
    >
      <LayoutPreview layout={entry.layout} cellSize={10} />
      <div className="min-w-0 flex-1">
        <LayoutSourceBadge from={entry.from}>{entry.date}</LayoutSourceBadge>
        {isRenaming ? (
          <div className="mt-0.5" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-1 min-w-0">
              <input
                ref={renameInputRef}
                type="text"
                value={renameValue}
                onChange={(e) => {
                  setRenameValue(e.target.value);
                  setRenameError("");
                }}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") handleRenameSubmit();
                  else if (e.key === "Escape") handleRenameCancel();
                }}
                onBlur={handleRenameSubmit}
                aria-label="Layout name"
                className={`flex-1 min-w-0 px-2 py-0.5 bg-slate-900/60 border rounded text-sm text-slate-100 focus:outline-none ${
                  renameError ? "border-red-500/50" : "border-slate-600/50 focus:border-emerald-500/50"
                }`}
                maxLength={50}
              />
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={handleRenameSubmit} className="p-1 text-emerald-400 hover:text-emerald-300 flex-shrink-0 cursor-pointer" title="Save name">
                <Check className="w-4 h-4" />
              </button>
            </div>
            {renameError && <p className="mt-1 text-xs text-red-400">{renameError}</p>}
          </div>
        ) : (
          <div className="text-sm text-slate-100 break-words pr-12">{entry.title}</div>
        )}
        {entry.detail && entry.detail !== entry.title && <div className="text-xs text-slate-400 break-words">{entry.detail}</div>}
        <div className="text-[11px] text-slate-500 mt-0.5">{counts(entry.layout)}</div>
      </div>

      {entry.saved && !isRenaming && (
        <div
          className={`absolute top-1.5 right-1.5 flex gap-0.5 transition-opacity ${
            selected || showDeleteConfirm ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
          }`}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsRenaming(true);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-700/60 transition-colors cursor-pointer"
            title="Rename"
            aria-label={`Rename ${entry.title}`}
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleDelete}
            onDoubleClick={(e) => e.stopPropagation()}
            onBlur={() => setShowDeleteConfirm(false)}
            className={`p-1 rounded transition-colors cursor-pointer ${
              showDeleteConfirm ? "bg-red-500/80 text-white hover:bg-red-500" : "text-slate-400 hover:bg-red-500/10 hover:text-red-400"
            }`}
            title={showDeleteConfirm ? "Click again to delete" : "Delete layout"}
            aria-label={showDeleteConfirm ? `Confirm delete ${entry.title}` : `Delete ${entry.title}`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};

// ---- Modal ------------------------------------------------------------------

export const LoadLayoutModal: React.FC<LoadLayoutModalProps> = (props) => {
  if (!props.isOpen) return null;
  // Mounted fresh on each open, so search, selection and the pasted link reset.
  return <LoadLayoutDialog {...props} />;
};

const LoadLayoutDialog: React.FC<LoadLayoutModalProps> = ({ onClose, onLoad, onDelete, onRename, layouts, replacing }) => {
  const { getCropDef, getMutationDef } = useGreenhouseData();
  const nameOf = useCallback(
    (id: string) => getMutationDef(id)?.name || getCropDef(id)?.name || id.replace(/_/g, " "),
    [getCropDef, getMutationDef]
  );
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState<"recent" | "name">("recent");
  const [pasteText, setPasteText] = useState("");

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

  // Read once per open: the Calculator writes it on another page.
  const [calculator] = useState(() => {
    const last = LocalStorageManager.loadLastSolverLayout();
    return last ? decodeEntry("calculator", "calculator", last.code, last.name || "Last Calculator result", nameOf, last.savedAt ? ` · ${formatDate(last.savedAt)}` : undefined) : null;
  });

  const savedEntries = useMemo<LayoutEntry[]>(
    () =>
      layouts.map((l) => ({
        key: `saved:${l.id}`,
        from: "saved",
        title: l.name,
        detail: summarizeTargets(l.targets, nameOf),
        layout: { inputs: l.inputs, targets: l.targets, groundTiles: l.groundTiles ?? [] },
        date: ` · ${l.modifiedAt !== l.savedAt ? "Modified" : "Saved"} ${formatDate(l.modifiedAt)}`,
        saved: l,
      })),
    [layouts, nameOf]
  );

  const entries = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    const matches = (e: LayoutEntry) => !search || e.title.toLowerCase().includes(search) || (e.detail?.toLowerCase().includes(search) ?? false);
    const saved = savedEntries.filter(matches).sort((a, b) =>
      sortBy === "name" ? a.title.localeCompare(b.title) : (b.saved?.modifiedAt ?? 0) - (a.saved?.modifiedAt ?? 0)
    );
    return [...(calculator && matches(calculator) ? [calculator] : []), ...saved];
  }, [savedEntries, calculator, searchTerm, sortBy]);

  const pasted = useMemo(() => readPasted(pasteText, nameOf), [pasteText, nameOf]);

  const [selectedKey, setSelectedKey] = useState<string | null>(() => entries[0]?.key ?? null);
  // A readable pasted link takes the selection, like picking its card.
  useEffect(() => {
    if (pasted.entry) setSelectedKey("link");
  }, [pasted.entry]);

  const selected = selectedKey === "link" ? pasted.entry : entries.find((e) => e.key === selectedKey) ?? null;
  const load = (entry: LayoutEntry) => onLoad(entry.layout, entry.saved?.name ?? entry.detail ?? entry.title);

  const totalLayouts = savedEntries.length + (calculator ? 1 : 0);

  return (
    <Portal>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/60 backdrop-blur-sm overflow-y-auto"
        onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Load layout"
          className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-3xl max-h-[92vh] my-auto overflow-hidden flex flex-col"
        >
          <div className="border-b border-slate-700/70 px-4 py-3 flex items-center justify-between flex-shrink-0">
            <h2 className="text-sm font-medium text-slate-100">Load a layout into the Designer</h2>
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-700/60 transition-colors cursor-pointer"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {totalLayouts > 1 && (
            <div className="px-4 pt-3 flex-shrink-0">
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="flex-1 relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search by name or target mutation..."
                    aria-label="Search layouts"
                    className="w-full pl-8 pr-3 py-1.5 bg-slate-900/60 border border-slate-600/40 rounded-md text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500/60"
                  />
                </div>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as "recent" | "name")}
                  aria-label="Sort saved layouts"
                  className="px-2 py-1.5 bg-slate-900/60 border border-slate-600/40 rounded-md text-xs text-slate-200 focus:outline-none focus:border-emerald-500/60 cursor-pointer"
                >
                  <option value="recent">Recently modified</option>
                  <option value="name">Name</option>
                </select>
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto scrollbar-dark p-4 space-y-3">
            {entries.length > 0 ? (
              <div role="listbox" aria-label="Layouts" className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {entries.map((entry) => (
                  <LayoutCard
                    key={entry.key}
                    entry={entry}
                    selected={entry.key === selectedKey}
                    onSelect={() => setSelectedKey(entry.key)}
                    onLoad={() => load(entry)}
                    onDelete={
                      entry.saved
                        ? () => {
                            if (selectedKey === entry.key) setSelectedKey(null);
                            onDelete(entry.saved!.id);
                          }
                        : undefined
                    }
                    onRename={entry.saved ? (name) => onRename(entry.saved!.id, name) : undefined}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-6">
                <FolderOpen className="w-10 h-10 text-slate-600 mx-auto mb-2" />
                <p className="text-xs text-slate-400">
                  {searchTerm
                    ? `No layouts matching "${searchTerm}"`
                    : "Nothing saved yet. Save a layout or solve one in the Calculator to see it here, or paste a share link below."}
                </p>
              </div>
            )}

            {pasted.entry && (
              <div role="listbox" aria-label="Pasted layout">
                <LayoutCard entry={pasted.entry} selected={selectedKey === "link"} onSelect={() => setSelectedKey("link")} onLoad={() => load(pasted.entry!)} />
              </div>
            )}

            <div className="space-y-1.5">
              <textarea
                className="w-full h-14 resize-none bg-slate-900/60 border border-slate-600/40 rounded-md px-2 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500/60"
                placeholder="Or paste a SkyShards share link or layout code"
                aria-label="Share link or layout code"
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
              />
              {pasted.error && <div className="text-xs text-red-300">{pasted.error}</div>}
            </div>
          </div>

          <div className="border-t border-slate-700/70 px-4 py-3 flex flex-wrap items-center justify-end gap-2 flex-shrink-0">
            <div className="mr-auto text-[11px] text-slate-500">
              {replacing ? "Replaces the current layout. Undo brings it back." : "Double-click a layout to load it straight away."}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-slate-700/40 hover:bg-slate-700/70 text-slate-300 border border-slate-600/30 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!selected}
              onClick={() => selected && load(selected)}
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              {replacing ? "Replace current layout" : "Load layout"}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
};

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, FolderOpen, Pencil, Search, Trash2 } from "lucide-react";
import type { OptimizedPlacement, SavedLayout } from "../../types/layout";
import { getCropPreviewColor } from "../../data/cropColors";
import { useGreenhouseData } from "../../context";
import { decodeDesign, extractLayoutCode, summarizeTargets, type GroundTile, type HandoffSource } from "../../utilities";
import { getGroundImagePath } from "../../types/greenhouse";
import { DialogFrame, ModalDialog } from "../ui/ModalDialog";
import { Dropdown, MenuItem } from "../ui/Popover";
import { IconButton, KitButton, KitInput, KitTextarea } from "../ui/kit";
import { cn } from "../ui/cn";
import { LayoutSourceBadge } from "./LayoutSourceBadge";
import { plural, readLastCalculatorLayout, useNameOf, type LoadableLayout } from "./actionsModel";

export type { LoadableLayout } from "./actionsModel";

interface LoadLayoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** `name` is shown in the "Layout loaded" toast. */
  onLoad: (layout: LoadableLayout, name: string) => void;
  /** One click; the caller's toast offers Undo. */
  onDelete: (layoutId: string) => void;
  onRename: (layoutId: string, newName: string) => void;
  layouts: SavedLayout[];
  /** The Designer already holds a layout, so loading replaces it. */
  replacing?: boolean;
}

const MAX_NAME = 50;

// ---- Preview ----------------------------------------------------------------------------------------------

/**
 * A 10×10 mini grid of a layout: each item in its own colour (item data, cropColors.ts), targets ringed in
 * the select role (as on the grid), painted ground as its texture, empty cells on the hover surface.
 * Shared with the Simulator's layout picker.
 */
export const LayoutPreview: React.FC<{ layout: { inputs: OptimizedPlacement[]; targets: OptimizedPlacement[]; groundTiles?: GroundTile[] }; cellSize?: number }> = ({
  layout,
  cellSize = 14,
}) => {
  const { getCropDef, getMutationDef } = useGreenhouseData();
  const cells = useMemo(() => {
    const map = new Map<string, { cropId?: string; target?: boolean; ground?: string }>();
    for (const g of layout.groundTiles ?? []) map.set(`${g.position[0]},${g.position[1]}`, { ground: g.ground });
    const put = (ps: OptimizedPlacement[], target: boolean) => {
      for (const p of ps) {
        const size = (target ? (getMutationDef(p.cropId)?.size ?? getCropDef(p.cropId)?.size) : (getCropDef(p.cropId)?.size ?? getMutationDef(p.cropId)?.size)) || 1;
        for (let dr = 0; dr < size; dr++) for (let dc = 0; dc < size; dc++) map.set(`${p.position[0] + dr},${p.position[1] + dc}`, { cropId: p.cropId, target });
      }
    };
    put(layout.inputs, false);
    put(layout.targets, true);
    return map;
  }, [layout, getCropDef, getMutationDef]);
  return (
    <div aria-hidden className="inline-grid shrink-0 gap-px rounded-control border border-line bg-surface-well p-1" style={{ gridTemplateColumns: `repeat(10, ${cellSize}px)` }}>
      {Array.from({ length: 100 }, (_, i) => {
        const c = cells.get(`${Math.floor(i / 10)},${i % 10}`);
        return (
          <span
            key={i}
            className={cn("rounded-[2px]", !c && "bg-surface-hover")} // design-guard-ignore: an 8–16px preview cell, smaller than the radius scale
            style={{
              width: cellSize,
              height: cellSize,
              backgroundColor: c?.cropId ? getCropPreviewColor(c.cropId, c.target) : undefined,
              backgroundImage: c?.ground ? `url(${getGroundImagePath(c.ground)})` : undefined,
              backgroundSize: "cover",
              boxShadow: c?.target ? "inset 0 0 0 1px var(--color-select)" : undefined,
            }}
          />
        );
      })}
    </div>
  );
};

// ---- Entries ----------------------------------------------------------------------------------------------

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

const countsOf = (l: LoadableLayout) => `${plural(l.targets.length, "target")} · ${plural(l.inputs.length, "input")}`;
const formatDate = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

function readPasted(text: string, nameOf: (id: string) => string): { entry: LayoutEntry | null; error: string | null } {
  const parts = text.split(/\s+/).filter(Boolean);
  if (!parts.length) return { entry: null, error: null };
  if (parts.length > 1) return { entry: null, error: "The Designer holds one layout: paste a single link." };
  try {
    const layout = decodeDesign(extractLayoutCode(parts[0]));
    return { entry: { key: "link", from: "link", title: "Pasted share link", detail: summarizeTargets(layout.targets, nameOf), layout }, error: null };
  } catch {
    const part = parts[0];
    return { entry: null, error: `Could not read "${part.length > 40 ? `${part.slice(0, 40)}...` : part}"` };
  }
}

// ---- Card -------------------------------------------------------------------------------------------------

/** One card: click selects, double-click / Enter loads, Space selects (D65); rename inline and delete (D66, D67). */
const LayoutCard: React.FC<{ entry: LayoutEntry; selected: boolean; onSelect: () => void; onLoad: () => void; onDelete?: () => void; onRename?: (name: string) => void }> = ({
  entry,
  selected,
  onSelect,
  onLoad,
  onDelete,
  onRename,
}) => {
  const [renaming, setRenaming] = useState(false);
  const [value, setValue] = useState(entry.title);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (renaming) {
      input.current?.focus();
      input.current?.select();
    }
  }, [renaming]);
  const submit = () => {
    const t = value.trim();
    if (!t) return setError("Name cannot be empty");
    if (t !== entry.title) onRename?.(t); // the caller checks for duplicate names
    setRenaming(false);
    setValue(t);
    setError("");
  };
  const cancel = () => {
    setRenaming(false);
    setValue(entry.title);
    setError("");
  };
  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={0}
      onClick={onSelect}
      onDoubleClick={() => !renaming && onLoad()}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter") {
          // Without this, focus returns to the rail's Load button as the dialog closes and the same
          // Enter's default action clicks it, reopening Load.
          e.preventDefault();
          onLoad();
        } else if (e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      title="Click to select, double-click to load"
      className={cn(
        "group focus-ring relative flex min-w-0 cursor-pointer items-center gap-3 rounded-control border p-2.5 transition-colors duration-(--duration-hover)",
        selected ? "border-select bg-select/10" : "border-line bg-surface-card hover:bg-surface-hover",
      )}
    >
      <LayoutPreview layout={entry.layout} cellSize={9} />
      {/* A saved card keeps room on the right for its Rename / Delete buttons (always shown on touch). */}
      <div className={cn("min-w-0 flex-1", entry.saved && !renaming && "pr-14")}>
        <LayoutSourceBadge from={entry.from}>{entry.date}</LayoutSourceBadge>
        {renaming ? (
          <div className="mt-1" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
            <div className="flex min-w-0 items-center gap-1">
              <KitInput
                ref={input}
                value={value}
                maxLength={MAX_NAME}
                aria-label="Layout name"
                invalid={!!error}
                onChange={(e) => {
                  setValue(e.target.value);
                  setError("");
                }}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") submit();
                  else if (e.key === "Escape") {
                    // Cancels the rename only, not the dialog.
                    e.preventDefault();
                    cancel();
                  }
                }}
                onBlur={submit}
                className="h-7 min-w-0 flex-1"
              />
              <IconButton aria-label="Save name" onMouseDown={(e) => e.preventDefault()} onClick={submit}>
                <Check />
              </IconButton>
            </div>
            {error && <p className="mt-1 text-secondary text-problem">{error}</p>}
          </div>
        ) : (
          <div className="mt-0.5 text-body font-medium break-words text-fg">{entry.title}</div>
        )}
        {entry.detail && entry.detail !== entry.title && <div className="text-secondary break-words text-fg-muted">{entry.detail}</div>}
        <div className="mt-0.5 text-meta tabular-nums text-fg-meta">{countsOf(entry.layout)}</div>
      </div>
      {entry.saved && !renaming && (
        <div className={cn("absolute top-1.5 right-1.5 flex gap-0.5 transition-opacity duration-(--duration-hover)", selected ? "opacity-100" : "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100")}>
          <IconButton
            aria-label={`Rename ${entry.title}`}
            title="Rename"
            onClick={(e) => {
              e.stopPropagation();
              setRenaming(true);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <Pencil />
          </IconButton>
          {/* One click deletes; the toast's Undo brings it back (no click-twice confirm). */}
          <IconButton
            aria-label={`Delete ${entry.title}`}
            title="Delete layout"
            className="hover:bg-problem/10 hover:text-problem"
            onClick={(e) => {
              e.stopPropagation();
              onDelete?.();
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <Trash2 />
          </IconButton>
        </div>
      )}
    </div>
  );
};

// ---- Dialog -----------------------------------------------------------------------------------------------

/** Load a layout (D62–D72). Mounted fresh on each open, so search, selection and the pasted link reset. */
export const LoadLayoutModal: React.FC<LoadLayoutModalProps> = (props) => {
  if (!props.isOpen) return null;
  return <LoadLayoutDialog {...props} />;
};

const LoadLayoutDialog: React.FC<LoadLayoutModalProps> = ({ onClose, onLoad, onDelete, onRename, layouts, replacing }) => {
  const nameOf = useNameOf();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"recent" | "name">("recent");
  const [paste, setPaste] = useState("");

  // The last Calculator result first (read once per open: the Calculator writes it on another page).
  const [calculator] = useState<LayoutEntry | null>(() => {
    const last = readLastCalculatorLayout();
    return last
      ? { key: "calculator", from: "calculator", title: last.name, detail: summarizeTargets(last.layout.targets, nameOf), layout: last.layout, date: last.savedAt ? ` · ${formatDate(last.savedAt)}` : undefined }
      : null;
  });
  const saved = useMemo<LayoutEntry[]>(
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
    [layouts, nameOf],
  );
  const entries = useMemo(() => {
    const q = search.trim().toLowerCase();
    const hit = (e: LayoutEntry) => !q || e.title.toLowerCase().includes(q) || (e.detail?.toLowerCase().includes(q) ?? false);
    const list = saved.filter(hit).sort((a, b) => (sort === "name" ? a.title.localeCompare(b.title) : (b.saved?.modifiedAt ?? 0) - (a.saved?.modifiedAt ?? 0)));
    return [...(calculator && hit(calculator) ? [calculator] : []), ...list];
  }, [saved, calculator, search, sort]);
  const pasted = useMemo(() => readPasted(paste, nameOf), [paste, nameOf]);

  // The first entry starts selected (D62); a readable pasted link takes the selection, like picking its card.
  const [selectedKey, setSelectedKey] = useState<string | null>(() => entries[0]?.key ?? null);
  useEffect(() => {
    if (pasted.entry) setSelectedKey("link");
  }, [pasted.entry]);
  // First focus: the selected card, so Enter loads it straight away (D65). After showModal(), which focuses Close.
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const id = requestAnimationFrame(() => list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  const selected = selectedKey === "link" ? pasted.entry : (entries.find((e) => e.key === selectedKey) ?? null);
  const load = (e: LayoutEntry) => onLoad(e.layout, e.saved?.name ?? e.detail ?? e.title);
  const total = saved.length + (calculator ? 1 : 0);
  const sortLabel = sort === "recent" ? "Recently modified" : "Name";

  return (
    <ModalDialog labelledBy="load-layout-title" onClose={onClose} maxWidth="max-w-3xl">
      <DialogFrame
        id="load-layout-title"
        title="Load a layout"
        onClose={onClose}
        footer={
          <>
            <span className="mr-auto self-center text-meta text-fg-meta">{replacing ? "Replaces the current layout. Undo brings it back." : "Double-click a layout to load it straight away."}</span>
            <KitButton variant="ghost" size="md" onClick={onClose}>
              Cancel
            </KitButton>
            <KitButton variant="primary" size="md" disabled={!selected} onClick={() => selected && load(selected)}>
              <FolderOpen /> {replacing ? "Replace current layout" : "Load layout"}
            </KitButton>
          </>
        }
      >
        {total > 1 && (
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
            <div className="relative min-w-0 flex-1">
              <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-meta" />
              {/* type="text", not "search": Escape closes the dialog in one press (a search field clears itself first). */}
              <KitInput type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or target mutation" aria-label="Search layouts" className="w-full pl-8" />
            </div>
            <Dropdown label={`Sort saved layouts: ${sortLabel}`} width={200} align="end" className="h-8 shrink-0" button={<span className="text-secondary text-fg-body">{sortLabel}</span>}>
              {(closeMenu) => (
                <>
                  <MenuItem
                    checked={sort === "recent"}
                    onSelect={() => {
                      setSort("recent");
                      closeMenu();
                    }}
                  >
                    Recently modified
                  </MenuItem>
                  <MenuItem
                    checked={sort === "name"}
                    onSelect={() => {
                      setSort("name");
                      closeMenu();
                    }}
                  >
                    Name
                  </MenuItem>
                </>
              )}
            </Dropdown>
          </div>
        )}
        {entries.length > 0 ? (
          <div ref={list} role="listbox" aria-label="Layouts" className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {entries.map((e) => (
              <LayoutCard
                key={e.key}
                entry={e}
                selected={e.key === selectedKey}
                onSelect={() => setSelectedKey(e.key)}
                onLoad={() => load(e)}
                onDelete={
                  e.saved
                    ? () => {
                        if (selectedKey === e.key) setSelectedKey(null);
                        onDelete(e.saved!.id);
                      }
                    : undefined
                }
                onRename={e.saved ? (n) => onRename(e.saved!.id, n) : undefined}
              />
            ))}
          </div>
        ) : (
          <p className="py-6 text-center text-secondary text-fg-muted">
            {search ? `No layouts matching "${search}"` : "Nothing saved yet. Save a layout or solve one in the Calculator to see it here, or paste a share link below."}
          </p>
        )}
        {pasted.entry && (
          <div role="listbox" aria-label="Pasted layout">
            <LayoutCard entry={pasted.entry} selected={selectedKey === "link"} onSelect={() => setSelectedKey("link")} onLoad={() => load(pasted.entry!)} />
          </div>
        )}
        <div className="space-y-1.5">
          <KitTextarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder="Or paste a SkyShards share link or layout code"
            aria-label="Share link or layout code"
            invalid={!!pasted.error}
            className="h-14 w-full resize-none"
          />
          {pasted.error && (
            <p role="alert" className="text-secondary text-problem">
              {pasted.error}
            </p>
          )}
        </div>
      </DialogFrame>
    </ModalDialog>
  );
};

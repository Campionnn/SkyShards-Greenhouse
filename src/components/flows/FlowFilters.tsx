import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Download, Loader2, Search, Sprout, X } from "lucide-react";
import type { Board } from "../../leaderboard/rules";
import { START_ITEM_CAPS, type EarningIn, type RowFilters } from "../../leaderboard/view";
import { fetchGreenhouseStats, isValidUsername, PlayerImportError, profileLabel, rememberedUsername, rememberUsername, type GreenhouseStatsResponse } from "../../services/playerImport";
import { CropImage } from "../shared/CropImage";
import { nameOf, rarityOf } from "../simulator/format";
import { buttonClass, inputClass } from "../simulator/styles";
import { getRarityTextColor } from "../../utilities/rarity";
import { DialogFrame, ModalDialog } from "../ui/ModalDialog";
import type { OwnedItems } from "./flowsDisplay";

/**
 * The ranking's filter bar (docs/plans/leaderboard-boards-v2.md §7.1): earning crops / mutations,
 * and on the "with starting items" board no upkeep, a starting-items cap and "I own the starting
 * items". The page keeps the values in its URL; filtering itself is `matchesFilters` (view.ts).
 */

const pill = (active: boolean) =>
  `inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1 text-xs font-medium transition-[background-color,color,border-color,transform] duration-150 active:scale-[0.97] ${
    active ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-200" : "border-slate-600/40 bg-slate-800/60 text-slate-300 hover:bg-slate-700/60 hover:text-slate-100"
  }`;

/** Closes a popover on an outside click or Escape. */
function useDismiss(open: boolean, ref: React.RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open, ref, close]);
}

/** The searchable multi-select of earning plants, with the "in top 3" / "anywhere" mode. */
export const EarningPicker: React.FC<{
  options: readonly string[];
  value: readonly string[];
  mode: EarningIn;
  onChange: (ids: string[], mode: EarningIn) => void;
}> = ({ options, value, mode, onChange }) => {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, ref, () => setOpen(false));
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    // Selected ones first, so they're easy to untick; unknown selected ids (not on this board) stay listed.
    const all = [...new Set([...value, ...options])];
    return t ? all.filter((id) => nameOf(id).toLowerCase().includes(t) || id.includes(t)) : all;
  }, [q, options, value]);
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id], mode);
  const label = value.length === 0 ? "Any" : value.length === 1 ? nameOf(value[0]) : `${nameOf(value[0])} +${value.length - 1}`;
  return (
    <div className="relative" ref={ref}>
      <button type="button" className={pill(value.length > 0)} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="listbox" data-testid="earning-filter">
        <Sprout className="h-3.5 w-3.5 text-emerald-400" />
        <span className="text-slate-400">Earning</span>
        {value.length === 1 && <CropImage cropId={value[0]} cropName={nameOf(value[0])} size="custom" width={14} height={14} showFallback={false} />}
        <span className="max-w-[9rem] truncate">{label}</span>
        {value.length > 0 && <span className="text-[10px] font-normal text-slate-400">{mode === "any" ? "anywhere" : "top 3"}</span>}
        <ChevronDown className={`h-3 w-3 text-slate-500 transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute left-0 z-40 mt-1 w-72 rounded-lg border border-slate-600/50 bg-slate-800 p-2 shadow-xl" role="dialog" aria-label="Earning crops and mutations">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              autoFocus
              type="search"
              className={`${inputClass} w-full py-1.5 pl-7 text-xs`}
              placeholder="Find a crop or mutation"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Find a crop or mutation"
            />
          </label>
          <div className="mt-2 flex gap-1" role="group" aria-label="Where it earns">
            {(["top3", "any"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onChange([...value], m)}
                className={`flex-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
                  mode === m ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-200" : "border-slate-600/40 text-slate-400 hover:bg-slate-700/50 hover:text-slate-200"
                }`}
                title={m === "top3" ? "Among the flow's three biggest earners on this board" : "Earns any coins on this board"}
              >
                {m === "top3" ? "In its top 3" : "Anywhere"}
              </button>
            ))}
          </div>
          <ul className="scrollbar-dark mt-2 max-h-64 overflow-y-auto overscroll-contain pr-1" role="listbox" aria-multiselectable>
            {shown.length === 0 && <li className="px-2 py-3 text-center text-xs text-slate-500">Nothing matches.</li>}
            {shown.map((id) => {
              const on = value.includes(id);
              const rarity = rarityOf(id);
              return (
                <li key={id} role="option" aria-selected={on}>
                  <button type="button" onClick={() => toggle(id)} className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors ${on ? "bg-emerald-500/10" : "hover:bg-slate-700/50"}`}>
                    <span className={`grid h-3.5 w-3.5 place-items-center rounded border ${on ? "border-emerald-400 bg-emerald-500/80 text-slate-950" : "border-slate-500"}`}>{on && <Check className="h-2.5 w-2.5" strokeWidth={3} />}</span>
                    <CropImage cropId={id} cropName={nameOf(id)} size="custom" width={18} height={18} showFallback />
                    <span className={`truncate ${rarity ? getRarityTextColor(rarity) : "text-slate-200"}`}>{nameOf(id)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {value.length > 0 && (
            <button type="button" className="mt-1.5 w-full rounded-md px-2 py-1 text-[11px] text-slate-400 transition-colors hover:bg-slate-700/50 hover:text-slate-200" onClick={() => onChange([], mode)}>
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
};

const capLabel = (n: number | null) => (n === null ? "Any" : n === 0 ? "0" : `≤ ${n}`);

/** The whole filter bar. `owned` is the viewer's imported items; `onImportOwned` opens the import. */
export const FilterBar: React.FC<{
  board: Board;
  filters: RowFilters;
  earningOptions: readonly string[];
  owned: OwnedItems | null;
  onChange: (patch: Partial<RowFilters>) => void;
  onImportOwned: () => void;
}> = ({ board, filters, earningOptions, owned, onChange, onImportOwned }) => {
  const borrow = board === "ironman_borrow";
  const active = filters.earning.length > 0 || (borrow && (filters.noUpkeep || filters.maxStartItems !== null || filters.owned));
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2" data-testid="filter-bar">
      <EarningPicker options={earningOptions} value={filters.earning} mode={filters.earningIn} onChange={(earning, earningIn) => onChange({ earning, earningIn })} />
      {borrow && (
        <>
          <button type="button" className={pill(filters.noUpkeep)} aria-pressed={filters.noUpkeep} onClick={() => onChange({ noUpkeep: !filters.noUpkeep })} title="Hide flows that need some items supplied every day">
            No upkeep
          </button>
          <div className="flex items-center gap-1" role="group" aria-label="Starting items">
            <span className="mr-0.5 text-[11px] uppercase tracking-wide text-slate-500">Starting items</span>
            {START_ITEM_CAPS.map((n) => (
              <button
                key={String(n)}
                type="button"
                aria-pressed={filters.maxStartItems === n}
                onClick={() => onChange({ maxStartItems: n })}
                className={`rounded-md border px-2 py-1 text-xs font-medium tabular-nums transition-colors ${
                  filters.maxStartItems === n ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-200" : "border-transparent text-slate-400 hover:bg-slate-700/50 hover:text-slate-200"
                }`}
              >
                {capLabel(n)}
              </button>
            ))}
          </div>
          <span className="inline-flex items-center gap-1">
            <button
              type="button"
              className={pill(filters.owned && !!owned)}
              aria-pressed={filters.owned}
              onClick={() => (owned ? onChange({ owned: !filters.owned }) : onImportOwned())}
              title={owned ? `Only flows whose starting items you own (${owned.username || "imported"}${owned.profile ? `, ${owned.profile}` : ""}) and with no upkeep` : "Import your items from Hypixel to use this"}
            >
              I own the starting items
            </button>
            {owned ? (
              <button type="button" className="rounded p-1 text-slate-500 transition-colors hover:bg-slate-700/60 hover:text-slate-200" onClick={onImportOwned} title="Import your items again" aria-label="Import your items again">
                <Download className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </span>
        </>
      )}
      {active && (
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[11px] text-slate-400 transition-colors hover:text-slate-200"
          onClick={() => onChange({ earning: [], earningIn: "top3", noUpkeep: false, maxStartItems: null, owned: false })}
        >
          <X className="h-3 w-3" /> Clear filters
        </button>
      )}
    </div>
  );
};

/** The "I own the starting items" import body (no portal, for SSR tests). */
export const OwnedImportPanel: React.FC<{ owned: OwnedItems | null; onSave: (o: OwnedItems | null) => void; onClose: () => void }> = ({ owned, onSave, onClose }) => {
  const [username, setUsername] = useState(() => owned?.username || rememberedUsername());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resp, setResp] = useState<GreenhouseStatsResponse | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const load = async (profileId?: string) => {
    const name = username.trim();
    if (!isValidUsername(name)) return setError("Enter a Minecraft username.");
    abort.current?.abort();
    const c = new AbortController();
    abort.current = c;
    setLoading(true);
    setError(null);
    try {
      const r = await fetchGreenhouseStats(name, profileId, { signal: c.signal });
      if (c.signal.aborted) return;
      rememberUsername(r.username || name);
      setResp(r);
    } catch (e) {
      if (c.signal.aborted) return;
      setError(e instanceof PlayerImportError ? e.message : "Import failed.");
    } finally {
      if (abort.current === c) {
        abort.current = null;
        setLoading(false);
      }
    }
  };
  const profile = resp?.profiles.find((p) => p.profileId === resp.profileId) ?? null;
  const items = resp?.items;
  const found = items ? Object.entries(items).sort((a, b) => b[1] - a[1]) : [];
  const save = () => {
    if (!resp || !items) return;
    onSave({ username: resp.username, profile: profile ? profileLabel(profile) : "", items, at: Date.now() });
    onClose();
  };
  return (
    <DialogFrame
      id="owned-import-title"
      title={
        <>
          <Download className="h-4 w-4 text-emerald-400" /> Items you own
        </>
      }
      onClose={onClose}
      footer={
        <>
          {owned && (
            <button
              type="button"
              className={`${buttonClass.neutral} mr-auto`}
              onClick={() => {
                onSave(null);
                onClose();
              }}
            >
              Forget my items
            </button>
          )}
          <button type="button" className={buttonClass.neutral} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={buttonClass.primary} onClick={save} disabled={!items || loading}>
            <Check className="h-3.5 w-3.5" /> Use these items
          </button>
        </>
      }
    >
      <p className="text-xs text-slate-400">
        Counts the mutations, Dead Plants and Fermento in your sacks, ender chest, backpacks and inventory (the same import as the Rose Dragon Guide). The "with starting
        items" board then shows only flows whose starting items you already have. Your Inventory API must be on.
      </p>
      {owned && (
        <p className="text-[11px] text-slate-500">
          Saved: {Object.keys(owned.items).length} item types from {owned.username || "an import"}
          {owned.profile ? ` (${owned.profile})` : ""}.
        </p>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <input
          className={`${inputClass} flex-1 py-1.5 text-sm`}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Minecraft username"
          aria-label="Minecraft username"
          autoComplete="off"
          spellCheck={false}
          maxLength={25}
        />
        <button type="submit" className={buttonClass.neutral} disabled={!isValidUsername(username) || loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Look up
        </button>
      </form>
      {error && (
        <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300" role="alert">
          {error}
        </p>
      )}
      {resp && resp.profiles.length > 1 && (
        <label className="flex items-center gap-2 text-xs text-slate-400">
          Profile
          <select className={`${inputClass} flex-1 py-1.5`} value={resp.profileId} disabled={loading} onChange={(e) => void load(e.target.value)} aria-label="SkyBlock profile">
            {resp.profiles.map((p) => (
              <option key={p.profileId} value={p.profileId}>
                {profileLabel(p)}
                {p.selected ? " · active" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      {resp &&
        (items === null || items === undefined ? (
          <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            {items === null ? "Hypixel doesn't show the items on this profile. Turn on the Inventory API in SkyBlock (Settings → API Settings), wait a few minutes, then try again." : "The server didn't send item counts. Try again later."}
          </p>
        ) : (
          <div className="space-y-1.5">
            <div className="text-[11px] text-slate-400">
              {found.length} item type{found.length === 1 ? "" : "s"} on {profile ? profileLabel(profile) : "this profile"}
            </div>
            <ul className="scrollbar-dark flex max-h-48 flex-wrap gap-1 overflow-y-auto">
              {found.map(([id, n]) => (
                <li key={id} className="inline-flex items-center gap-1 rounded-md border border-slate-700/60 bg-slate-900/50 px-1.5 py-0.5 text-[11px]">
                  <CropImage cropId={id} cropName={nameOf(id)} size="custom" width={14} height={14} showFallback={false} />
                  <span className="text-slate-300">{nameOf(id)}</span>
                  <span className="tabular-nums text-slate-500">{n.toLocaleString("en-US")}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
    </DialogFrame>
  );
};

export const OwnedImportDialog: React.FC<{ owned: OwnedItems | null; onSave: (o: OwnedItems | null) => void; onClose: () => void }> = (props) => (
  <ModalDialog labelledBy="owned-import-title" onClose={props.onClose} maxWidth="max-w-md">
    <OwnedImportPanel {...props} />
  </ModalDialog>
);

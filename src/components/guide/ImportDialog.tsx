/**
 * "Import from Hypixel": type a Minecraft username, and SkyShards-API counts the Greenhouse items in
 * the player's sacks, ender chest, backpacks and inventory. The dialog lists what would change with
 * a checkbox each (new total, where it was found) and sets the ticked items as the Guide's totals.
 *
 * "Import again": once a player has imported, opening the dialog looks the same player and profile
 * up straight away. Each row then says how Hypixel's count moved since that last import. A count
 * Hypixel still shows unchanged is probably a save that doesn't include the latest harvest yet (the
 * Guide already took off what confirmed plots placed), so those rows start unticked and the dialog
 * says how to get Hypixel to save.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Clock, Download, Loader2, RefreshCw } from "lucide-react";
import type { GameData } from "../../simulator/data/types";
import { inventoryChanges, itemName, sinceLastImport, trackedFound, trackedItems, type Catalog, type InventoryChange, type LastImport } from "../../guide";
import {
  fetchGreenhouseStats,
  isValidUsername,
  ITEM_SOURCE_LABEL,
  PlayerImportError,
  profileLabel,
  rememberedUsername,
  rememberUsername,
  type GreenhouseStatsResponse,
} from "../../services/playerImport";
import { CropImage } from "../shared/CropImage";
import { Dialog } from "./primitives";
import { buttonClass, inputClass, timeAgo } from "./format";

const n = (v: number) => v.toLocaleString("en-US");

/** "64 in sacks · 146 in inventory". */
const whereFound = (sources: Record<string, number>) =>
  Object.entries(sources)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${n(v)} in ${ITEM_SOURCE_LABEL[k] ?? k}`)
    .join(" · ");

export const ImportDialog: React.FC<{
  open: boolean;
  inventory: Record<string, number>;
  catalog: Catalog;
  data: GameData;
  /** The previous lookup: opening the dialog repeats it at once, and rows compare against it. */
  lastImport?: LastImport;
  /** Set the ticked items to their imported totals; `record` is the lookup they came from. */
  onApply: (changes: InventoryChange[], record: LastImport) => void;
  /** A lookup whose counts already match the Guide's totals: remembered as an import with nothing to apply. */
  onLookup?: (record: LastImport) => void;
  onClose: () => void;
}> = (props) => (props.open ? <ImportBody {...props} /> : null);

const ImportBody: React.FC<React.ComponentProps<typeof ImportDialog>> = ({ open, inventory, catalog, data, lastImport, onApply, onLookup, onClose }) => {
  const [username, setUsername] = useState(() => lastImport?.username ?? rememberedUsername());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resp, setResp] = useState<GreenhouseStatsResponse | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  // The import this lookup is compared with: the one before the dialog opened (a lookup here replaces the stored one).
  const [previous] = useState(lastImport);
  // Rows the player ticked or unticked by hand; the rest follow the default (stale rows off).
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const found = resp?.items ?? null;
  const changes = useMemo(() => (found ? inventoryChanges(catalog, inventory, found, resp?.itemSources) : []), [catalog, inventory, found, resp]);
  const since = (c: InventoryChange) => (resp ? sinceLastImport(previous, resp.profileId, c.item, c.found) : null);
  const isOn = (c: InventoryChange) => overrides.get(c.item) ?? since(c) !== 0;
  const ticked = changes.filter(isOn);
  const stale = changes.filter((c) => since(c) === 0);
  const movedOnHypixel = found && resp && previous?.profileId === resp.profileId ? catalog.items.filter((item) => (found[item] ?? 0) !== (previous.items[item] ?? 0)).length : null;
  const profile = resp?.profiles.find((p) => p.profileId === resp.profileId) ?? null;
  const profileName = profile ? profileLabel(profile) : "this profile";

  const load = useCallback(
    async (name: string, profileId?: string) => {
      if (!isValidUsername(name)) {
        setError("Enter a Minecraft username.");
        return;
      }
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      setError(null);
      try {
        const r = await fetchGreenhouseStats(name.trim(), profileId, { signal: controller.signal });
        if (controller.signal.aborted) return;
        rememberUsername(r.username || name);
        if (r.username) setUsername(r.username);
        const at = Date.now();
        setResp(r);
        setFetchedAt(at);
        setOverrides(new Map());
        // Nothing to apply because the totals already match: that still counts as an import.
        if (r.items && inventoryChanges(catalog, inventory, r.items).length === 0) {
          const p = r.profiles.find((x) => x.profileId === r.profileId);
          onLookup?.({ username: r.username || name.trim(), profileId: r.profileId, profileName: p ? profileLabel(p) : "", fetchedAt: at, appliedAt: at, items: trackedItems(catalog, r.items) });
        }
      } catch (e) {
        if (controller.signal.aborted) return;
        setError(e instanceof PlayerImportError ? e.message : "Import failed.");
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setLoading(false);
        }
      }
    },
    [catalog, inventory, onLookup]
  );

  // "Import again": the same player and profile, looked up as soon as the dialog opens. (`load`
  // changes with the page's callbacks; reading it through a ref keeps this to one lookup per open.)
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);
  useEffect(() => {
    if (!previous) return;
    void loadRef.current(previous.username, previous.profileId);
    return () => abortRef.current?.abort();
  }, [previous]);

  const toggle = (c: InventoryChange) => setOverrides((prev) => new Map(prev).set(c.item, !isOn(c)));

  const apply = () => {
    if (!resp || !found || fetchedAt === null) return;
    onApply(ticked, { username: resp.username || username.trim(), profileId: resp.profileId, profileName: profile ? profileLabel(profile) : "", fetchedAt, appliedAt: Date.now(), items: trackedItems(catalog, found) });
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={previous ? "Import again from Hypixel" : "Import from Hypixel"}
      size="md"
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" className={buttonClass.secondary} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={buttonClass.primary} onClick={apply} disabled={!ticked.length || loading}>
            <Check className="h-4 w-4" /> {ticked.length ? `Update ${ticked.length} item${ticked.length === 1 ? "" : "s"}` : "Update"}
          </button>
        </div>
      }
    >
      <p className="mb-3 text-xs text-slate-400">
        Counts the mutations, Dead Plants and Fermento in your sacks, ender chest, backpacks and inventory, and sets them as your totals. Hypixel only saves your items
        a few minutes after you change worlds or log out (and only if your Inventory API is on), so a harvest you just made may not be in it yet.
      </p>
      <form
        className="mb-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void load(username, resp && resp.username.toLowerCase() === username.trim().toLowerCase() ? resp.profileId : undefined);
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
        <button type="submit" className={buttonClass.secondary} disabled={!isValidUsername(username) || loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : resp ? <RefreshCw className="h-4 w-4" /> : <Download className="h-4 w-4" />} {resp ? "Look up again" : "Look up"}
        </button>
      </form>

      {loading && !resp && (
        <p className="mb-3 flex items-center gap-2 text-xs text-slate-300" role="status">
          <Loader2 className="h-4 w-4 animate-spin text-emerald-400 motion-reduce:animate-none" /> Looking up {username.trim() || "your items"}…
        </p>
      )}

      {error && (
        <p className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300" role="alert">
          {error}
        </p>
      )}

      {resp && resp.profiles.length > 1 && (
        <label className="mb-3 flex items-center gap-2 text-xs text-slate-400">
          Profile
          <select className={`${inputClass} flex-1 py-1.5`} value={resp.profileId} disabled={loading} onChange={(e) => void load(username, e.target.value)} aria-label="SkyBlock profile">
            {resp.profiles.map((p) => (
              <option key={p.profileId} value={p.profileId}>
                {profileLabel(p)}
                {p.selected ? " · active" : ""}
              </option>
            ))}
          </select>
        </label>
      )}

      {resp && fetchedAt !== null && found && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-slate-600/40 bg-slate-800/50 px-3 py-2 text-xs text-slate-300">
          <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
          <span>
            Looked up {timeAgo(fetchedAt)} on {profileName}.
            {movedOnHypixel !== null && previous && (
              <>
                {" "}
                {movedOnHypixel > 0 ? (
                  <span className="text-emerald-200">
                    Hypixel shows {movedOnHypixel} item{movedOnHypixel === 1 ? "" : "s"} changed since your import {timeAgo(previous.fetchedAt)}, so this includes newer
                    harvests.
                  </span>
                ) : (
                  <span className="text-amber-200">
                    Nothing changed on Hypixel since your import {timeAgo(previous.fetchedAt)}. If you harvested since then, Hypixel hasn't saved it yet: change worlds
                    (for example /hub and back), wait a minute or two, then look up again.
                  </span>
                )}
              </>
            )}
          </span>
        </div>
      )}

      {resp && (
        <div className={loading ? "pointer-events-none opacity-60 transition-opacity" : "transition-opacity"}>
          {found === null || found === undefined ? (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              {found === null
                ? `Hypixel doesn't show the items on ${profileName}. Turn on the Inventory API in SkyBlock (Settings → API Settings), wait a few minutes, then try again.`
                : "The server didn't send item counts. Try again later."}
            </p>
          ) : changes.length === 0 ? (
            <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
              Your totals already match {profileName} ({trackedFound(catalog, found)} item{trackedFound(catalog, found) === 1 ? "" : "s"} found).
            </p>
          ) : (
            <>
              <div className="mb-1.5 flex items-center justify-between text-[11px] text-slate-400">
                <span>
                  {changes.length} change{changes.length === 1 ? "" : "s"} on {profileName}
                </span>
                <button
                  type="button"
                  className={buttonClass.ghost}
                  onClick={() => setOverrides(new Map(changes.map((c) => [c.item, ticked.length === 0] as const)))}
                >
                  {ticked.length ? "Untick all" : "Tick all"}
                </button>
              </div>
              {stale.length > 0 && previous && (
                <p className="mb-1.5 text-[11px] text-amber-200/90">
                  {stale.length} row{stale.length === 1 ? " is" : "s are"} unticked: Hypixel still shows the same count as your last import, and the Guide's number already
                  includes what you placed since. Tick {stale.length === 1 ? "it" : "them"} if Hypixel is right.
                </p>
              )}
              <ul className="divide-y divide-slate-700/40 rounded-md border border-slate-700/50 bg-slate-900/40">
                {changes.map((c) => {
                  const on = isOn(c);
                  const where = whereFound(c.sources);
                  const moved = since(c);
                  return (
                    <li key={c.item}>
                      <label className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-slate-800/60">
                        <input type="checkbox" className="h-3.5 w-3.5 accent-emerald-500" checked={on} onChange={() => toggle(c)} />
                        <CropImage cropId={c.item} cropName={itemName(data, c.item)} width={20} height={20} showFallback={false} />
                        <span className="min-w-0 flex-1">
                          <span className={`block truncate ${on ? "text-slate-200" : "text-slate-500"}`}>{itemName(data, c.item)}</span>
                          <span className="block truncate text-[11px] text-slate-500">
                            {where || "none found"}
                            {moved === 0 && <span className="text-amber-300/80"> · same on Hypixel as last import</span>}
                            {moved !== null && moved !== 0 && (
                              <span className={moved > 0 ? "text-emerald-300/80" : "text-slate-400"}>
                                {" "}
                                · {moved > 0 ? "+" : ""}
                                {n(moved)} on Hypixel since last import
                              </span>
                            )}
                          </span>
                        </span>
                        <span className={`shrink-0 tabular-nums ${on ? "text-slate-300" : "text-slate-500 line-through"}`}>
                          <span className="text-slate-500">{n(c.have)} →</span> <span className={c.found > c.have ? "text-emerald-300" : "text-amber-300"}>{n(c.found)}</span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}
    </Dialog>
  );
};

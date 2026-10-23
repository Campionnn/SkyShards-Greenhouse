/**
 * "Import from Hypixel": type a Minecraft username, and SkyShards-API counts the Greenhouse items in
 * the player's sacks, ender chest, backpacks and inventory. The dialog lists what would change with
 * a checkbox each (new total, where it was found) and sets the ticked items as the Guide's totals.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, Download, Loader2 } from "lucide-react";
import type { GameData } from "../../simulator/data/types";
import { inventoryChanges, itemName, trackedFound, type Catalog, type InventoryChange } from "../../guide";
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
import { buttonClass, inputClass } from "./format";

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
  /** Set the ticked items to their imported totals. */
  onApply: (changes: InventoryChange[]) => void;
  onClose: () => void;
}> = (props) => (props.open ? <ImportBody {...props} /> : null);

const ImportBody: React.FC<React.ComponentProps<typeof ImportDialog>> = ({ open, inventory, catalog, data, onApply, onClose }) => {
  const [username, setUsername] = useState(rememberedUsername);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resp, setResp] = useState<GreenhouseStatsResponse | null>(null);
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const found = resp?.items ?? null;
  const changes = useMemo(() => (found ? inventoryChanges(catalog, inventory, found, resp?.itemSources) : []), [catalog, inventory, found, resp]);
  const ticked = changes.filter((c) => !unticked.has(c.item));
  const profile = resp?.profiles.find((p) => p.profileId === resp.profileId) ?? null;

  const load = async (profileId?: string) => {
    const name = username.trim();
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
      const r = await fetchGreenhouseStats(name, profileId, { signal: controller.signal });
      if (controller.signal.aborted) return;
      rememberUsername(r.username || name);
      if (r.username) setUsername(r.username);
      setResp(r);
      setUnticked(new Set());
    } catch (e) {
      if (controller.signal.aborted) return;
      setError(e instanceof PlayerImportError ? e.message : "Import failed.");
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setLoading(false);
      }
    }
  };

  const toggle = (item: string) =>
    setUnticked((prev) => {
      const next = new Set(prev);
      if (next.has(item)) next.delete(item);
      else next.add(item);
      return next;
    });

  const apply = () => {
    onApply(ticked);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Import from Hypixel"
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
        Counts the mutations, Dead Plants and Fermento in your sacks, ender chest, backpacks and inventory, and sets them as your totals. Hypixel updates this
        a few minutes after you log out or change worlds, and only if your Inventory API is on.
      </p>
      <form
        className="mb-3 flex gap-2"
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
        <button type="submit" className={buttonClass.secondary} disabled={!isValidUsername(username) || loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Look up
        </button>
      </form>

      {error && (
        <p className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300" role="alert">
          {error}
        </p>
      )}

      {resp && resp.profiles.length > 1 && (
        <label className="mb-3 flex items-center gap-2 text-xs text-slate-400">
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

      {resp && (
        <div className={loading ? "pointer-events-none opacity-60 transition-opacity" : "transition-opacity"}>
          {found === null || found === undefined ? (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              {found === null
                ? `Hypixel doesn't show the items on ${profile ? profileLabel(profile) : "this profile"}. Turn on the Inventory API in SkyBlock (Settings → API Settings), wait a few minutes, then try again.`
                : "The server didn't send item counts. Try again later."}
            </p>
          ) : changes.length === 0 ? (
            <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
              Your totals already match {profile ? profileLabel(profile) : "this profile"} ({trackedFound(catalog, found)} item{trackedFound(catalog, found) === 1 ? "" : "s"} found).
            </p>
          ) : (
            <>
              <div className="mb-1.5 flex items-center justify-between text-[11px] text-slate-400">
                <span>
                  {changes.length} change{changes.length === 1 ? "" : "s"} on {profile ? profileLabel(profile) : "this profile"}
                </span>
                <button type="button" className={buttonClass.ghost} onClick={() => setUnticked(ticked.length ? new Set(changes.map((c) => c.item)) : new Set())}>
                  {ticked.length ? "Untick all" : "Tick all"}
                </button>
              </div>
              <ul className="divide-y divide-slate-700/40 rounded-md border border-slate-700/50 bg-slate-900/40">
                {changes.map((c) => {
                  const on = !unticked.has(c.item);
                  const where = whereFound(c.sources);
                  return (
                    <li key={c.item}>
                      <label className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-slate-800/60">
                        <input type="checkbox" className="h-3.5 w-3.5 accent-emerald-500" checked={on} onChange={() => toggle(c.item)} />
                        <CropImage cropId={c.item} cropName={itemName(data, c.item)} width={20} height={20} showFallback={false} />
                        <span className="min-w-0 flex-1">
                          <span className={`block truncate ${on ? "text-slate-200" : "text-slate-500"}`}>{itemName(data, c.item)}</span>
                          <span className="block truncate text-[11px] text-slate-500">{where || "none found"}</span>
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

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
import { Check, Clock, Download, LoaderCircle, RefreshCw } from "lucide-react";
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
import { LinkButton } from "../ui/Card";
import { cn } from "../ui/cn";
import { InfoHint } from "../ui/InfoHint";
import { KitButton, KitInput } from "../ui/kit";
import { DialogFrame, ModalDialog } from "../ui/ModalDialog";
import { Dropdown, MenuItem } from "../ui/Popover";
import { timeAgo } from "./format";

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
}> = (props) =>
  props.open ? (
    <ModalDialog labelledBy="guide-import-title" onClose={props.onClose} maxWidth="max-w-xl">
      <ImportPanel {...props} />
    </ModalDialog>
  ) : null;

/** The dialog's frame and body (rendered inside ModalDialog; server-renderable on its own). */
export const ImportPanel: React.FC<React.ComponentProps<typeof ImportDialog>> = ({ inventory, catalog, data, lastImport, onApply, onLookup, onClose }) => {
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
      <DialogFrame
        id="guide-import-title"
        title={previous ? "Import again from Hypixel" : "Import from Hypixel"}
        onClose={onClose}
        footer={
          <>
            <KitButton size="md" onClick={onClose}>
              Cancel
            </KitButton>
            <KitButton variant="primary" size="md" onClick={apply} disabled={!ticked.length || loading}>
              <Check /> {ticked.length ? `Update ${ticked.length} item${ticked.length === 1 ? "" : "s"}` : "Update"}
            </KitButton>
          </>
        }
      >
        <p className="flex items-start gap-1.5 text-secondary text-fg-muted">
          <span>Counts the mutations, Dead Plants and Fermento in your sacks, ender chest, backpacks and inventory, and sets them as your totals.</span>
          <InfoHint title="Why a harvest may be missing">
            Hypixel only saves your items a few minutes after you change worlds or log out (and only if your Inventory API is on), so a harvest you just made may not be in it yet.
          </InfoHint>
        </p>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void load(username, resp && resp.username.toLowerCase() === username.trim().toLowerCase() ? resp.profileId : undefined);
          }}
        >
          <KitInput
            className="min-w-0 flex-1"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Minecraft username"
            aria-label="Minecraft username"
            autoComplete="off"
            spellCheck={false}
            maxLength={25}
          />
          <KitButton type="submit" size="md" disabled={!isValidUsername(username)} loading={loading}>
            {resp ? <RefreshCw /> : <Download />} {resp ? "Look up again" : "Look up"}
          </KitButton>
        </form>

        {loading && !resp && (
          <p className="flex items-center gap-2 text-secondary text-fg-muted" role="status">
            <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> Looking up {username.trim() || "your items"}…
          </p>
        )}

        {error && (
          <p className="rounded-control border border-problem/30 bg-problem/10 px-3 py-2 text-secondary text-problem" role="alert">
            {error}
          </p>
        )}

        {resp && resp.profiles.length > 1 && (
          <div className="flex items-center gap-2 text-secondary text-fg-muted">
            Profile
            <Dropdown
              label="SkyBlock profile"
              disabled={loading}
              width={280}
              button={<span className="truncate">{profile ? `${profileLabel(profile)}${profile.selected ? " · active" : ""}` : "Pick a profile"}</span>}
            >
              {(close) =>
                resp.profiles.map((p) => (
                  <MenuItem
                    key={p.profileId}
                    checked={p.profileId === resp.profileId}
                    onSelect={() => {
                      close();
                      void load(username, p.profileId);
                    }}
                  >
                    {profileLabel(p)}
                    {p.selected ? " · active" : ""}
                  </MenuItem>
                ))
              }
            </Dropdown>
          </div>
        )}

        {resp && fetchedAt !== null && found && (
          <div className="flex items-start gap-2 rounded-control border border-line bg-surface-well px-3 py-2 text-secondary text-fg-body">
            <Clock aria-hidden className="mt-0.5 size-3.5 shrink-0 text-fg-meta" />
            <span>
              Looked up {timeAgo(fetchedAt)} on {profileName}.
              {movedOnHypixel !== null && previous && (
                <>
                  {" "}
                  {movedOnHypixel > 0 ? (
                    <span>
                      Hypixel shows {movedOnHypixel} item{movedOnHypixel === 1 ? "" : "s"} changed since your import {timeAgo(previous.fetchedAt)}, so this includes newer harvests.
                    </span>
                  ) : (
                    <span className="text-warn">
                      Nothing changed on Hypixel since your import {timeAgo(previous.fetchedAt)}. If you harvested since then, Hypixel hasn't saved it yet: change worlds (for
                      example /hub and back), wait a minute or two, then look up again.
                    </span>
                  )}
                </>
              )}
            </span>
          </div>
        )}

        {resp && (
          <div className={cn("transition-opacity duration-(--duration-hover)", loading && "pointer-events-none opacity-60")}>
            {found === null || found === undefined ? (
              <p className="rounded-control border border-warn/30 bg-warn/10 px-3 py-2 text-secondary text-warn">
                {found === null
                  ? `Hypixel doesn't show the items on ${profileName}. Turn on the Inventory API in SkyBlock (Settings → API Settings), wait a few minutes, then try again.`
                  : "The server didn't send item counts. Try again later."}
              </p>
            ) : changes.length === 0 ? (
              <p className="rounded-control border border-line bg-surface-well px-3 py-2 text-secondary text-fg-body">
                Your totals already match {profileName} ({trackedFound(catalog, found)} item{trackedFound(catalog, found) === 1 ? "" : "s"} found).
              </p>
            ) : (
              <>
                <div className="mb-1.5 flex items-center justify-between text-meta text-fg-meta">
                  <span>
                    {changes.length} change{changes.length === 1 ? "" : "s"} on {profileName}
                  </span>
                  <LinkButton className="text-meta" onClick={() => setOverrides(new Map(changes.map((c) => [c.item, ticked.length === 0] as const)))}>
                    {ticked.length ? "Untick all" : "Tick all"}
                  </LinkButton>
                </div>
                {stale.length > 0 && previous && (
                  <p className="mb-1.5 text-meta text-warn">
                    {stale.length} row{stale.length === 1 ? " is" : "s are"} unticked: Hypixel still shows the same count as your last import, and the Guide's number already includes
                    what you placed since. Tick {stale.length === 1 ? "it" : "them"} if Hypixel is right.
                  </p>
                )}
                <ul className="divide-y divide-line rounded-control border border-line bg-surface-well">
                  {changes.map((c) => {
                    const on = isOn(c);
                    const where = whereFound(c.sources);
                    const moved = since(c);
                    return (
                      <li key={c.item}>
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={on}
                          onClick={() => toggle(c)}
                          className="focus-ring-inset flex min-h-9 w-full cursor-pointer items-center gap-2 px-2.5 py-1.5 text-left text-secondary transition-colors duration-(--duration-hover) hover:bg-surface-hover pointer-coarse:min-h-11"
                        >
                          <span aria-hidden className={cn("grid size-4 shrink-0 place-items-center rounded-inner border", on ? "border-select bg-select text-surface-page" : "border-line-control")}>
                            {on && <Check className="size-3" strokeWidth={3} />}
                          </span>
                          <CropImage cropId={c.item} cropName={itemName(data, c.item)} width={20} height={20} showFallback={false} />
                          <span className="min-w-0 flex-1">
                            <span className={cn("block truncate", on ? "text-fg-body" : "text-fg-meta")}>{itemName(data, c.item)}</span>
                            <span className="block truncate text-meta text-fg-meta">
                              {where || "none found"}
                              {moved === 0 && <span className="text-warn"> · same on Hypixel as last import</span>}
                              {moved !== null && moved !== 0 && (
                                <span>
                                  {" "}
                                  · {moved > 0 ? "+" : ""}
                                  {n(moved)} on Hypixel since last import
                                </span>
                              )}
                            </span>
                          </span>
                          <span className={cn("shrink-0 tabular-nums", on ? "text-fg-body" : "text-fg-meta line-through")}>
                            <span className="text-fg-meta">{n(c.have)} →</span> <span className="font-semibold text-fg">{n(c.found)}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        )}
      </DialogFrame>
  );
};
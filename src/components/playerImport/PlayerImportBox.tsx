import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Download, UserRound } from "lucide-react";
import {
  fetchGreenhouseStats,
  IMPORT_FIELDS,
  importedFields,
  isValidUsername,
  loadManualChoices,
  PlayerImportError,
  profileLabel,
  rememberedUsername,
  rememberUsername,
  saveManualChoices,
  statsPatchFromImport,
  validChoices,
  type GreenhouseStatsResponse,
  type ImportBreakdown,
  type ImportProfile,
  type ManualChoices,
  type ManualValue,
} from "../../services/playerImport";
import type { PlayerStats } from "../../simulator/sim/state";
import { cn } from "../ui/cn";
import { KitButton, KitInput, KitLabel } from "../ui/kit";
import { DialogFrame, ModalDialog } from "../ui/ModalDialog";
import { Dropdown, MenuItem } from "../ui/Popover";
import { surface } from "../ui/surface";
import { ManualSources } from "./ManualSources";

/**
 * Import Greenhouse stats from a Minecraft username (SkyShards-API reads Hypixel). Two steps: Import
 * shows what was found with a checkbox per field, Apply hands the checked fields to `onImport`.
 * Used by the simulator's player stats and the leaderboard's "Your stats" panel.
 */
export interface PlayerImportBoxProps {
  /** The checked fields as a PlayerStats patch (cropFortune / tools replace, they are not merged). */
  onImport: (patch: Partial<PlayerStats>, info: { username: string; profile: ImportProfile | null }) => void;
  /** Unused since the import moved into a modal; kept so callers don't break. */
  compact?: boolean;
  className?: string;
  /** The button's look: "primary" where importing is the main action (the leaderboard's stats drawer), "accent" elsewhere. */
  variant?: "primary" | "accent";
}

const loadUsername = rememberedUsername;
const saveUsername = rememberUsername;

const cropLabel = (c: string) => c.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

const SourceList: React.FC<{ rows: Record<string, number> }> = ({ rows }) => {
  const entries = Object.entries(rows).filter(([, v]) => typeof v === "number" && Number.isFinite(v) && v !== 0);
  if (!entries.length) return <p className="text-fg-meta">Nothing.</p>;
  return (
    <ul className="space-y-0.5">
      {entries.map(([k, v]) => (
        <li key={k} className="flex justify-between gap-3">
          <span className="truncate text-fg-muted">{k}</span>
          <span className="tabular-nums text-fg-body">{fmt(v)}</span>
        </li>
      ))}
    </ul>
  );
};

const Group: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div>
    <KitLabel className="mb-1">{title}</KitLabel>
    {children}
  </div>
);

const BreakdownDetails: React.FC<{ breakdown?: ImportBreakdown; missing: string[] }> = ({ breakdown, missing }) => {
  const general = breakdown?.general;
  const crop = breakdown?.crop && typeof breakdown.crop === "object" ? Object.entries(breakdown.crop).filter(([, r]) => r && typeof r === "object") : [];
  const tools = breakdown?.tools && typeof breakdown.tools === "object" ? Object.entries(breakdown.tools).filter(([, r]) => r && typeof r === "object") : [];
  if (!general && !crop.length && !tools.length && !missing.length) return null;
  return (
    <details className={cn(surface.well, "group rounded-container text-secondary")}>
      <summary className="focus-ring-inset flex cursor-pointer select-none list-none items-center gap-1.5 rounded-control px-2.5 py-2 text-fg-muted transition-colors duration-(--duration-hover) hover:text-fg [&::-webkit-details-marker]:hidden">
        <ChevronDown aria-hidden className="size-3.5 -rotate-90 transition-transform duration-(--duration-ink) group-open:rotate-0" />
        Sources{missing.length > 0 && <span className="text-warn">· {missing.length} couldn't be read</span>}
      </summary>
      <div className="space-y-3 border-t border-line px-2.5 py-2">
        {general && (
          <Group title="Farming Fortune">
            <SourceList rows={general} />
          </Group>
        )}
        {crop.map(([c, rows]) => (
          <Group key={c} title={`${cropLabel(c)} Fortune`}>
            <SourceList rows={rows} />
          </Group>
        ))}
        {tools.map(([name, perCrop]) => (
          <Group key={name} title={name}>
            <div className="space-y-1.5">
              {Object.entries(perCrop)
                .filter(([, r]) => r && typeof r === "object")
                .map(([c, rows]) => (
                  <div key={c}>
                    <div className="text-fg-meta">{cropLabel(c)}</div>
                    <div className="pl-2">
                      <SourceList rows={rows} />
                    </div>
                  </div>
                ))}
            </div>
          </Group>
        ))}
        {missing.length > 0 && (
          <Group title="Couldn't be read">
            <ul className="list-disc space-y-0.5 pl-4 text-fg-muted">
              {missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </Group>
        )}
      </div>
    </details>
  );
};

/**
 * A compact "Import from Hypixel" button; the whole import (username, profile, fields, manual
 * sources, sources breakdown) opens in a modal so the stats panels stay short.
 */
export const PlayerImportBox: React.FC<PlayerImportBoxProps> = ({ onImport, className, variant = "accent" }) => {
  const [open, setOpen] = useState(false);
  const remembered = useMemo(loadUsername, [open]);
  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1", className)} data-testid="player-import">
      <KitButton variant={variant} size="md" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <UserRound /> Import from Hypixel
      </KitButton>
      <span className="min-w-0 truncate text-meta text-fg-meta">{remembered ? `last: ${remembered}` : "fill in your stats from a username"}</span>
      {open && (
        <ModalDialog labelledBy="player-import-title" onClose={() => setOpen(false)} maxWidth="max-w-xl">
          <DialogFrame
            id="player-import-title"
            title="Import from Hypixel"
            onClose={() => setOpen(false)}
          >
            <PlayerImportPanel
              onImport={(patch, info) => {
                onImport(patch, info);
                setOpen(false);
              }}
            />
          </DialogFrame>
        </ModalDialog>
      )}
    </div>
  );
};

/** The import itself (kept outside the portal so SSR tests can render it). */
export const PlayerImportPanel: React.FC<Pick<PlayerImportBoxProps, "onImport">> = ({ onImport }) => {
  const [username, setUsername] = useState(loadUsername);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resp, setResp] = useState<GreenhouseStatsResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applied, setApplied] = useState(false);
  const [stored, setStored] = useState<ManualChoices>(loadManualChoices);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const sources = useMemo(() => resp?.manual ?? [], [resp]);
  const choices = useMemo(() => validChoices(sources, stored), [sources, stored]);
  const fields = useMemo(() => (resp ? importedFields(resp, choices) : []), [resp, choices]);

  const updateStored = (next: ManualChoices) => {
    setStored(next);
    saveManualChoices(next);
    setApplied(false);
  };
  const setChoice = (id: string, value: ManualValue) => updateStored({ ...stored, [id]: value });
  const resetChoices = () => {
    const next = { ...stored };
    for (const s of sources) delete next[s.id];
    updateStored(next);
  };
  const profile = resp?.profiles.find((p) => p.profileId === resp.profileId) ?? null;
  const valid = isValidUsername(username);

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
    setApplied(false);
    try {
      const r = await fetchGreenhouseStats(name, profileId, { signal: controller.signal });
      if (controller.signal.aborted) return;
      saveUsername(r.username || name);
      if (r.username) setUsername(r.username);
      setResp(r);
      setSelected(new Set(IMPORT_FIELDS.map((f) => f.key)));
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

  const toggle = (key: string) => {
    setApplied(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const apply = () => {
    if (!resp) return;
    const patch = statsPatchFromImport(resp, selected, choices);
    if (!Object.keys(patch).length) return;
    onImport(patch, { username: resp.username, profile });
    setApplied(true);
  };

  const checkedCount = fields.filter((f) => selected.has(f.field.key)).length;

  return (
    <div className="space-y-3">
      <p className="text-secondary text-fg-muted">
        Reads your SkyBlock profile from Hypixel and fills in your Greenhouse stats. Tick what to use, set what Hypixel doesn't show, then apply.
      </p>
      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <KitInput
          className="flex-1"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Minecraft username"
          aria-label="Minecraft username"
          autoComplete="off"
          spellCheck={false}
          maxLength={25}
        />
        <KitButton type="submit" variant="primary" size="md" disabled={!valid} loading={loading}>
          <Download /> Import
        </KitButton>
      </form>

      {error && (
        <p className="rounded-control border border-problem/30 bg-problem/10 px-2.5 py-1.5 text-secondary text-problem" role="alert">
          {error}
        </p>
      )}

      {resp && resp.profiles.length > 1 && (
        <div className="flex items-center gap-2 text-secondary text-fg-muted">
          Profile
          <Dropdown
            label="SkyBlock profile"
            look="field"
            disabled={loading}
            width={280}
            className="h-8 min-w-0 flex-1 justify-between pl-2.5 font-normal"
            button={<span className="truncate">{profile ? `${profileLabel(profile)}${profile.selected ? " · active" : ""}` : ""}</span>}
          >
            {(close) =>
              resp.profiles.map((p) => (
                <MenuItem
                  key={p.profileId}
                  checked={p.profileId === resp.profileId}
                  onSelect={() => {
                    close();
                    if (p.profileId !== resp.profileId) void load(p.profileId);
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

      {resp && (
        <div className={cn("transition-opacity duration-(--duration-hover)", loading && "pointer-events-none opacity-60")}>
          {fields.length === 0 ? (
            <p className="text-secondary text-fg-meta">No Greenhouse stats found on {profile ? profileLabel(profile) : "this profile"}.</p>
          ) : (
            <div className="space-y-2">
              <ul className={cn(surface.well, "divide-y divide-line rounded-container")}>
                {fields.map(({ field, display }) => {
                  const on = selected.has(field.key);
                  return (
                    <li key={field.key}>
                      <label className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-body transition-colors duration-(--duration-hover) hover:bg-surface-hover">
                        <input type="checkbox" className="focus-ring size-3.5 shrink-0 cursor-pointer accent-go" checked={on} onChange={() => toggle(field.key)} />
                        <span className={on ? "text-fg-body" : "text-fg-meta"}>{field.label}</span>
                        <span className={cn("ml-auto truncate pl-2 text-right tabular-nums", on ? "text-fg" : "text-fg-meta line-through")}>{display}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              <ManualSources sources={sources} choices={choices} onChange={setChoice} onReset={resetChoices} />
              <BreakdownDetails breakdown={resp.breakdown} missing={resp.missing ?? []} />
              <KitButton variant={applied ? "accent" : "primary"} size="md" className="w-full" onClick={apply} disabled={checkedCount === 0 || loading}>
                {applied && <Check />}
                {applied ? "Applied" : `Apply ${checkedCount} ${checkedCount === 1 ? "stat" : "stats"}`}
              </KitButton>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
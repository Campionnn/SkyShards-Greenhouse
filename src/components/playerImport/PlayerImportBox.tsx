import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Download, Loader2, UserRound } from "lucide-react";
import {
  fetchGreenhouseStats,
  importedFields,
  isValidUsername,
  PlayerImportError,
  statsPatchFromImport,
  type GreenhouseStatsResponse,
  type ImportBreakdown,
  type ImportProfile,
} from "../../services/playerImport";
import type { PlayerStats } from "../../simulator/sim/state";

/**
 * Import Greenhouse stats from a Minecraft username (SkyShards-API reads Hypixel). Two steps: Import
 * shows what was found with a checkbox per field, Apply hands the checked fields to `onImport`.
 * Used by the simulator's player stats and the leaderboard's "Your stats" panel.
 */
export interface PlayerImportBoxProps {
  /** The checked fields as a PlayerStats patch (cropFortune / tools replace, they are not merged). */
  onImport: (patch: Partial<PlayerStats>, info: { username: string; profile: ImportProfile | null }) => void;
  /** Tighter spacing for narrow columns. */
  compact?: boolean;
  className?: string;
}

const USERNAME_KEY = "skyshards-import-username";

function loadUsername(): string {
  try {
    return localStorage.getItem(USERNAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveUsername(name: string): void {
  try {
    localStorage.setItem(USERNAME_KEY, name);
  } catch {
    // localStorage unavailable: the name is not remembered.
  }
}

const MODE_LABEL: Record<string, string> = { ironman: "Ironman", island: "Stranded", bingo: "Bingo" };

const profileLabel = (p: ImportProfile) => `${p.cuteName}${p.gameMode ? ` (${MODE_LABEL[p.gameMode] ?? p.gameMode})` : ""}`;

const cropLabel = (c: string) => c.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

const input =
  "min-w-0 bg-slate-900/70 border border-slate-600/40 rounded-md px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/30 transition-colors";

const SourceList: React.FC<{ rows: Record<string, number> }> = ({ rows }) => {
  const entries = Object.entries(rows).filter(([, v]) => typeof v === "number" && Number.isFinite(v) && v !== 0);
  if (!entries.length) return <p className="text-slate-500">Nothing.</p>;
  return (
    <ul className="space-y-0.5">
      {entries.map(([k, v]) => (
        <li key={k} className="flex justify-between gap-3">
          <span className="truncate text-slate-400">{k}</span>
          <span className="tabular-nums text-slate-200">{fmt(v)}</span>
        </li>
      ))}
    </ul>
  );
};

const Group: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div>
    <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">{title}</div>
    {children}
  </div>
);

const BreakdownDetails: React.FC<{ breakdown?: ImportBreakdown; missing: string[] }> = ({ breakdown, missing }) => {
  const general = breakdown?.general;
  const crop = breakdown?.crop && typeof breakdown.crop === "object" ? Object.entries(breakdown.crop).filter(([, r]) => r && typeof r === "object") : [];
  const tools = breakdown?.tools && typeof breakdown.tools === "object" ? Object.entries(breakdown.tools).filter(([, r]) => r && typeof r === "object") : [];
  if (!general && !crop.length && !tools.length && !missing.length) return null;
  return (
    <details className="group rounded-md border border-slate-700/50 bg-slate-900/40 text-xs">
      <summary className="flex cursor-pointer select-none list-none items-center gap-1.5 px-2.5 py-1.5 text-slate-400 hover:text-slate-200 [&::-webkit-details-marker]:hidden">
        <ChevronDown className="h-3.5 w-3.5 -rotate-90 transition-transform group-open:rotate-0" />
        Sources{missing.length > 0 && <span className="text-amber-300/80">· {missing.length} not readable</span>}
      </summary>
      <div className="max-h-72 space-y-3 overflow-y-auto border-t border-slate-700/50 px-2.5 py-2">
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
                    <div className="text-slate-500">{cropLabel(c)}</div>
                    <div className="pl-2">
                      <SourceList rows={rows} />
                    </div>
                  </div>
                ))}
            </div>
          </Group>
        ))}
        {missing.length > 0 && (
          <Group title="Not readable (counted as 0)">
            <ul className="list-disc space-y-0.5 pl-4 text-slate-400">
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

export const PlayerImportBox: React.FC<PlayerImportBoxProps> = ({ onImport, compact = false, className = "" }) => {
  const [username, setUsername] = useState(loadUsername);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resp, setResp] = useState<GreenhouseStatsResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applied, setApplied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const fields = useMemo(() => (resp ? importedFields(resp) : []), [resp]);
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
      setSelected(new Set(importedFields(r).map((f) => f.field.key)));
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
    const patch = statsPatchFromImport(resp, selected);
    if (!Object.keys(patch).length) return;
    onImport(patch, { username: resp.username, profile });
    setApplied(true);
  };

  const checkedCount = fields.filter((f) => selected.has(f.field.key)).length;
  const pad = compact ? "p-2.5 space-y-2" : "p-3 space-y-2.5";

  return (
    <div className={`rounded-lg border border-slate-600/30 bg-slate-800/40 ${pad} ${className}`} data-testid="player-import">
      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
        <UserRound className="h-3.5 w-3.5 text-emerald-400" />
        Import from Hypixel
      </div>
      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <input
          className={`${input} flex-1`}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Minecraft username"
          aria-label="Minecraft username"
          autoComplete="off"
          spellCheck={false}
          maxLength={25}
        />
        <button
          type="submit"
          disabled={!valid || loading}
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/20 px-3 py-1.5 text-sm font-medium text-emerald-300 transition-colors hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          Import
        </button>
      </form>

      {error && (
        <p className="rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-xs text-red-300" role="alert">
          {error}
        </p>
      )}

      {resp && resp.profiles.length > 1 && (
        <label className="flex items-center gap-2 text-xs text-slate-400">
          Profile
          <select
            className={`${input} flex-1 py-1 text-xs`}
            value={resp.profileId}
            disabled={loading}
            onChange={(e) => void load(e.target.value)}
            aria-label="SkyBlock profile"
          >
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
          {fields.length === 0 ? (
            <p className="text-xs text-slate-500">No Greenhouse stats found on {profile ? profileLabel(profile) : "this profile"}.</p>
          ) : (
            <div className="space-y-2">
              <ul className="divide-y divide-slate-700/40 rounded-md border border-slate-700/50 bg-slate-900/40">
                {fields.map(({ field, display }) => {
                  const on = selected.has(field.key);
                  return (
                    <li key={field.key}>
                      <label className="flex cursor-pointer items-center gap-2 px-2.5 py-1 text-xs hover:bg-slate-800/60">
                        <input type="checkbox" className="h-3.5 w-3.5 accent-emerald-500" checked={on} onChange={() => toggle(field.key)} />
                        <span className={on ? "text-slate-300" : "text-slate-500"}>{field.label}</span>
                        <span className={`ml-auto truncate pl-2 text-right tabular-nums ${on ? "text-slate-100" : "text-slate-500 line-through"}`}>{display}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              <BreakdownDetails breakdown={resp.breakdown} missing={resp.missing ?? []} />
              <button
                type="button"
                onClick={apply}
                disabled={checkedCount === 0 || loading}
                className={`flex w-full items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  applied
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300/80"
                    : "border-emerald-500/50 bg-emerald-500/25 text-emerald-200 hover:bg-emerald-500/35"
                }`}
              >
                {applied && <Check className="h-3.5 w-3.5" />}
                {applied ? "Applied" : `Apply ${checkedCount} ${checkedCount === 1 ? "stat" : "stats"}`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

import React, { useMemo, useState } from "react";
import { ChevronDown, Clock, Coins, Copy, Gauge, RefreshCw, RotateCcw, Sprout, Zap } from "lucide-react";
import type { FlowViewer, ViewerStats } from "../../hooks/useFlowViewer";
import type { FlowAuthor } from "../../leaderboard/api";
import { cycleHours, EVERY, TIER_STATS, TIERS, type TierId } from "../../leaderboard/tiers";
import { avatarUrl, TIER_LABEL } from "../../leaderboard/view";
import { ARMOR_SET_LABEL, ARMOR_SETS, type ArmorSet } from "../../simulator";
import { priceAge } from "../simulator/bazaarFormat";
import { formatDuration } from "../simulator/format";
import { InfoHint, SegmentedControl } from "../ui";

/**
 * Leaderboard controls shared by /flows and /flows/:id: the board toggle, the "Your stats" panel
 * (granular inputs snapped to the nearest stat tier) and small presentational pieces.
 */

/** The Ironman / Normal toggle, the same one the simulator header uses (site-wide profile mode). */
export const BoardToggle: React.FC<{ viewer: FlowViewer }> = ({ viewer }) => (
  <SegmentedControl
    size="xs"
    nowrap
    value={viewer.board}
    onChange={viewer.setBoard}
    options={[
      { value: "ironman", label: "Ironman", title: "NPC prices; Dead Plants and Fermento are farmed by you (placed free on the server)" },
      { value: "normal", label: "Normal", tone: "blue", title: "Bazaar prices; supplies are bought" },
    ]}
  />
);

// ---- Stat inputs ---------------------------------------------------------------------------------

type NumKey = Exclude<keyof ViewerStats, "armorSet">;

interface FieldSpec {
  key: NumKey;
  label: string;
  min: number;
  max: number;
  step?: number;
  hint?: string;
  /** Shown after the number. */
  suffix?: string;
}

/** Stats that change the simulation itself: these decide the tier. */
const SPEED_FIELDS: FieldSpec[] = [
  { key: "cropGrowth", label: "Crop Growth", min: 0, max: 210, hint: "0 to 210." },
  { key: "growthUpgradeTier", label: "Growth upgrade", min: 0, max: 9, hint: "Greenhouse Growth Speed upgrade, tier 0 to 9 (tier 9 jumps to +50%)." },
  { key: "speedAttribute", label: "Speed attribute", min: 0, max: 10, hint: "Greenhouse Speed attribute, 0 to 10." },
  { key: "floraShard", label: "Flora shard", min: 0, max: 10, hint: "Flora attribute shard, 0 to 10. Counts toward the Unique Crop Bonus." },
];
const SPAWN_FIELDS: FieldSpec[] = [
  { key: "mutationChanceBonus", label: "Bioanalysis", min: 0, max: 0.15, step: 0.05, hint: "0, 0.05 Talisman, 0.10 Ring, 0.15 Artifact." },
  { key: "miningFortune", label: "Mining Fortune", min: 0, max: 3000, step: 50, hint: "Chloronite drops (capped at 4 from 2000)." },
];
/** Yield-only stats: these scale the stored counts directly. */
const YIELD_FIELDS: FieldSpec[] = [
  { key: "farmingFortune", label: "Farming Fortune", min: 0, max: 4000, step: 10, hint: "Wiki theoretical maximum: 3059.2." },
  { key: "plantYieldUpgrade", label: "Plant Yield", min: 0, max: 0.2, step: 0.02, hint: "Greenhouse upgrade, 0 to 0.20." },
  { key: "evergreenChip", label: "Evergreen Chip", min: 0, max: 0.6, step: 0.02, hint: "0 to 0.60; multiplies crop-bundle drops." },
  { key: "overbloom", label: "Overbloom", min: 0, max: 1000, step: 1, hint: "Rare Crop chance × (1 + Overbloom/100)." },
];

const fieldInput =
  "w-full bg-slate-900/70 border border-slate-600/40 rounded-md px-2 py-1.5 text-sm text-slate-100 tabular-nums focus:outline-none focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/30 transition-colors";

const NumberStat: React.FC<{ spec: FieldSpec; value: number; onChange: (v: number) => void; accent?: string }> = ({ spec, value, onChange, accent = "border-l-slate-600/60" }) => {
  const [text, setText] = useState<string | null>(null);
  const commit = (raw: string) => {
    const n = Number(raw);
    if (raw.trim() !== "" && Number.isFinite(n)) onChange(Math.max(spec.min, Math.min(spec.max, n)));
    setText(null);
  };
  return (
    <label className={`block border-l-2 ${accent} pl-2.5 min-w-0`}>
      <span className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">
        {spec.label}
        {spec.hint && (
          <InfoHint title={spec.label} width={240}>
            {spec.hint}
          </InfoHint>
        )}
      </span>
      <input
        type="number"
        inputMode="decimal"
        min={spec.min}
        max={spec.max}
        step={spec.step ?? 1}
        className={`${fieldInput} mt-1`}
        value={text ?? String(value)}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
        }}
        aria-label={spec.label}
      />
    </label>
  );
};

/** Where the viewer's growth speed sits among the four tiers, and which one it snaps to. */
export const TierMeter: React.FC<{ viewer: FlowViewer }> = ({ viewer }) => {
  const { snap } = viewer;
  const lo = snap.scores.low;
  const hi = snap.scores.max;
  const at = (score: number) => (hi > lo ? ((score - lo) / (hi - lo)) * 100 : 100);
  const order: TierId[] = ["low", "mid", "high", "max"];
  return (
    <div className="space-y-2" data-testid="tier-meter">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Scored at</span>
        <span className="text-xs text-slate-400">
          one cycle ≈ <span className="text-slate-200 tabular-nums">{formatDuration(cycleHours(viewer.stats) * 3600)}</span>
        </span>
      </div>
      <div className="relative h-9">
        <div className="absolute inset-x-0 top-[14px] h-1 rounded-full bg-slate-700/60" />
        <div className="absolute left-0 top-[14px] h-1 rounded-full bg-gradient-to-r from-emerald-700/60 to-emerald-400/80 transition-[width] duration-300 ease-out" style={{ width: `${at(snap.score)}%` }} />
        {order.map((t) => {
          const active = t === snap.tier;
          return (
            <div key={t} className="absolute top-0 -translate-x-1/2 flex flex-col items-center" style={{ left: `${at(snap.scores[t])}%` }}>
              <span
                className={`mt-[9px] h-3.5 w-3.5 rounded-full border-2 transition-colors ${
                  active ? "border-emerald-300 bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.6)]" : "border-slate-500 bg-slate-800"
                }`}
              />
              <span className={`mt-1 text-[10px] font-medium uppercase tracking-wide ${active ? "text-emerald-300" : "text-slate-500"}`}>{TIER_LABEL[t]}</span>
            </div>
          );
        })}
        <span
          aria-hidden
          className="absolute top-[7px] h-[18px] w-0.5 -translate-x-1/2 rounded-full bg-amber-300 shadow-[0_0_6px_rgba(252,211,77,0.7)] transition-[left] duration-300 ease-out"
          style={{ left: `${at(snap.score)}%` }}
          title="You"
        />
      </div>
      <p className="text-[11px] text-slate-500 pt-1">
        Your growth speed snaps to the <span className="text-emerald-300 font-medium">{TIER_LABEL[snap.tier]}</span> tier (amber marker). Every flow was simulated
        at the four tiers; yield stats then scale the result to you.
      </p>
    </div>
  );
};

export const TierStatsTable: React.FC<{ highlight: TierId }> = ({ highlight }) => (
  <table className="w-full text-[11px]">
    <thead>
      <tr className="text-slate-500">
        <th className="text-left font-normal pr-2">Stat</th>
        {TIERS.map((t) => (
          <th key={t} className={`text-right font-normal px-1 ${t === highlight ? "text-emerald-300" : ""}`}>
            {TIER_LABEL[t]}
          </th>
        ))}
      </tr>
    </thead>
    <tbody>
      {(
        [
          ["cropGrowth", "Crop Growth"],
          ["speedAttribute", "Speed attribute"],
          ["growthUpgradeTier", "Growth upgrade"],
          ["floraShard", "Flora"],
          ["mutationChanceBonus", "Bioanalysis"],
          ["miningFortune", "Mining Fortune"],
        ] as const
      ).map(([k, label]) => (
        <tr key={k}>
          <td className="pr-2 text-slate-400">{label}</td>
          {TIERS.map((t) => (
            <td key={t} className={`text-right px-1 tabular-nums ${t === highlight ? "text-emerald-200" : "text-slate-300"}`}>
              {TIER_STATS[t][k]}
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  </table>
);

const Group: React.FC<{ icon: React.ReactNode; title: string; hint?: React.ReactNode; children: React.ReactNode }> = ({ icon, title, hint, children }) => (
  <div className="min-w-0">
    <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-300">
      <span className="text-emerald-400 [&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>
      {title}
      {hint}
    </div>
    {children}
  </div>
);

/** The online frequency: any number, with the grid's frequencies as quick picks. */
const EveryInput: React.FC<{ viewer: FlowViewer }> = ({ viewer }) => {
  const hours = cycleHours(viewer.stats) * viewer.stats.every;
  return (
    <div className="space-y-2">
      <div className="flex items-end gap-3">
        <div className="w-28">
          <NumberStat spec={{ key: "every", label: "Every", min: 1, max: 48, hint: "How often you log in, in greenhouse cycles." }} value={viewer.stats.every} onChange={(every) => viewer.setStats({ every })} accent="border-l-emerald-500/70" />
        </div>
        <div className="pb-2 text-xs text-slate-400">
          cycles <span className="text-slate-500">·</span> about every <span className="text-slate-200 tabular-nums">{formatDuration(hours * 3600)}</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Online frequency presets">
        {EVERY.map((n) => {
          const active = viewer.every === n;
          return (
            <button
              key={n}
              type="button"
              onClick={() => viewer.setStats({ every: n })}
              className={`min-w-[2.25rem] rounded-md border px-2 py-1 text-xs font-medium tabular-nums transition-[background-color,color,transform] duration-150 active:scale-[0.97] ${
                active ? "border-emerald-500/50 bg-emerald-500/20 text-emerald-200" : "border-slate-600/40 bg-slate-800/60 text-slate-400 hover:bg-slate-700/60 hover:text-slate-200"
              }`}
            >
              {n}
            </button>
          );
        })}
      </div>
      {viewer.every !== viewer.stats.every && (
        <p className="text-[11px] text-amber-200/80">Flows were simulated at {EVERY.join(", ")} cycles: showing the nearest, every {viewer.every}.</p>
      )}
    </div>
  );
};

/** "Your stats": granular inputs, the tier they snap to, and the board. */
export const StatsPanel: React.FC<{ viewer: FlowViewer; defaultOpen?: boolean }> = ({ viewer, defaultOpen = true }) => {
  // Phones start collapsed so the rankings are on screen; the summary line says what is set.
  const [open, setOpen] = useState(() => defaultOpen && (typeof window === "undefined" || window.matchMedia?.("(min-width: 1024px)").matches !== false));
  const s = viewer.stats;
  const set = (key: NumKey) => (v: number) => viewer.setStats({ [key]: v } as Partial<ViewerStats>);
  const summary = useMemo(
    () => `${TIER_LABEL[viewer.tier]} tier · every ${viewer.every} cycle${viewer.every === 1 ? "" : "s"} · ${Math.round(s.farmingFortune)} FF · ${ARMOR_SET_LABEL[s.armorSet]}`,
    [viewer.tier, viewer.every, s.farmingFortune, s.armorSet]
  );
  return (
    <section className="rounded-lg border border-slate-600/30 bg-slate-800/40" data-testid="stats-panel">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 text-left" aria-expanded={open}>
          <span className="flex items-center gap-2 whitespace-nowrap">
            <Gauge className="h-4 w-4 flex-shrink-0 text-emerald-400" />
            <span className="text-sm font-medium text-slate-200">Your stats</span>
            <ChevronDown className={`h-3.5 w-3.5 text-slate-500 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
          </span>
          {!open && <span className="min-w-0 text-xs text-slate-500">{summary}</span>}
        </button>
        <div className="flex flex-wrap items-center gap-2">
          <BoardToggle viewer={viewer} />
        </div>
      </header>
      {open && (
        <div className="grid grid-cols-1 gap-x-8 gap-y-5 border-t border-slate-700/40 px-4 py-4 lg:grid-cols-[1.15fr_1fr]">
          <div className="space-y-5 min-w-0">
            <Group icon={<Clock />} title="How often you log in">
              <EveryInput viewer={viewer} />
            </Group>
            <Group
              icon={<Zap />}
              title="Growth and spawning"
              hint={
                <InfoHint title="Stat tiers" width={340}>
                  <p className="mb-2">These change the simulation itself, so they pick which of the four simulated tiers you see.</p>
                  <TierStatsTable highlight={viewer.tier} />
                </InfoHint>
              }
            >
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {[...SPEED_FIELDS, ...SPAWN_FIELDS].map((f) => (
                  <NumberStat key={f.key} spec={f} value={s[f.key]} onChange={set(f.key)} accent="border-l-emerald-500/50" />
                ))}
              </div>
            </Group>
            <TierMeter viewer={viewer} />
          </div>
          <div className="space-y-5 min-w-0">
            <Group
              icon={<Sprout />}
              title="Yield"
              hint={
                <InfoHint title="Yield stats" width={300}>
                  The server runs every flow at the wiki maxima. These scale the stored crop and rare-crop counts to you; mutation items aren't affected. An
                  estimate, marked as such.
                </InfoHint>
              }
            >
              <div className="grid grid-cols-2 gap-3">
                {YIELD_FIELDS.map((f) => (
                  <NumberStat key={f.key} spec={f} value={s[f.key]} onChange={set(f.key)} accent="border-l-amber-400/60" />
                ))}
                <label className="col-span-2 block border-l-2 border-l-amber-400/60 pl-2.5">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Farming armor</span>
                  <select className={`${fieldInput} mt-1`} value={s.armorSet} onChange={(e) => viewer.setStats({ armorSet: e.target.value as ArmorSet })} aria-label="Farming armor">
                    {ARMOR_SETS.map((a) => (
                      <option key={a} value={a}>
                        {ARMOR_SET_LABEL[a]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </Group>
            <div className="flex flex-wrap gap-2 pt-1">
              {viewer.hasSimulatorStats && (
                <button type="button" onClick={() => viewer.resetStats("simulator")} className="inline-flex items-center gap-1.5 rounded-md border border-slate-600/40 bg-slate-800/60 px-2.5 py-1.5 text-xs text-slate-300 transition-[background-color,transform] duration-150 hover:bg-slate-700/60 active:scale-[0.97]">
                  <Copy className="h-3.5 w-3.5" /> Use my simulator stats
                </button>
              )}
              <button type="button" onClick={() => viewer.resetStats("max")} className="inline-flex items-center gap-1.5 rounded-md border border-slate-600/40 bg-slate-800/60 px-2.5 py-1.5 text-xs text-slate-300 transition-[background-color,transform] duration-150 hover:bg-slate-700/60 active:scale-[0.97]">
                <RotateCcw className="h-3.5 w-3.5" /> Max everything
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

/** Normal board: where the prices come from, with a refresh link. */
export const PriceNote: React.FC<{ viewer: FlowViewer; now: number }> = ({ viewer, now }) => {
  if (viewer.board !== "normal")
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
        <Coins className="h-3 w-3" /> NPC prices; mutation items are kept, not sold
      </span>
    );
  const { prices, loading, error, refresh } = viewer.bazaar;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
      <Coins className="h-3 w-3 text-blue-300" />
      <span>
        {loading ? "Fetching Bazaar prices..." : prices ? `Bazaar prices from ${priceAge(prices.fetchedAt, now)}` : "No Bazaar prices yet"}
        {error ? <span className="text-amber-300"> (refresh failed)</span> : null}
      </span>
      <button type="button" className="inline-flex items-center gap-1 text-emerald-300 hover:text-emerald-200 disabled:opacity-50" onClick={refresh} disabled={loading}>
        <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Refresh
      </button>
    </span>
  );
};

export const Avatar: React.FC<{ id: string; avatar: string | null; size?: number; className?: string }> = ({ id, avatar, size = 20, className = "" }) => (
  <img src={avatarUrl(id, avatar)} alt="" width={size} height={size} loading="lazy" className={`flex-shrink-0 rounded-full bg-slate-700 ${className}`} style={{ width: size, height: size }} />
);

export const AuthorLabel: React.FC<{ author: FlowAuthor; size?: number }> = ({ author, size = 20 }) => (
  <span className="inline-flex min-w-0 items-center gap-1.5">
    <Avatar id={author.id} avatar={author.avatar} size={size} />
    <span className="min-w-0 break-words">{author.name}</span>
  </span>
);

const BADGE_STYLE = {
  stale: "bg-slate-600/30 text-slate-300 border-slate-500/40",
  estimated: "bg-amber-500/15 text-amber-200 border-amber-500/30",
  new: "bg-emerald-500/15 text-emerald-200 border-emerald-500/30",
  pending: "bg-blue-500/15 text-blue-200 border-blue-500/30",
  danger: "bg-red-500/15 text-red-200 border-red-500/30",
  info: "bg-cyan-500/10 text-cyan-200 border-cyan-500/30",
  violet: "bg-violet-500/15 text-violet-200 border-violet-500/30",
} as const;

export type BadgeTone = keyof typeof BADGE_STYLE;

export const Badge: React.FC<{ tone: BadgeTone; title?: string; icon?: React.ReactNode; children: React.ReactNode }> = ({ tone, title, icon, children }) => (
  <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${BADGE_STYLE[tone]}`}>
    {icon && <span className="[&>svg]:h-2.5 [&>svg]:w-2.5">{icon}</span>}
    {children}
  </span>
);

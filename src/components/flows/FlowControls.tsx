import React from "react";
import { RefreshCw } from "lucide-react";
import type { FlowViewer } from "../../hooks/useFlowViewer";
import type { FlowAuthor } from "../../leaderboard/api";
import { EVERY, TIER_STATS, TIERS, type TierId } from "../../leaderboard/tiers";
import { avatarUrl, TIER_LABEL } from "../../leaderboard/view";
import { priceAge } from "../simulator/bazaarFormat";
import { inputClass } from "../simulator/styles";
import { InfoHint, SegmentedControl } from "../ui";

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

const Field: React.FC<{ label: React.ReactNode; children: React.ReactNode }> = ({ label, children }) => (
  <label className="flex flex-col gap-1 text-[11px] text-slate-400 min-w-0">
    <span className="flex items-center gap-1">{label}</span>
    {children}
  </label>
);

const TIER_ROWS: { key: keyof (typeof TIER_STATS)["max"]; label: string; fmt?: (n: number) => string }[] = [
  { key: "cropGrowth", label: "Crop Growth" },
  { key: "speedAttribute", label: "Speed attribute" },
  { key: "growthUpgradeTier", label: "Growth upgrade tier" },
  { key: "floraShard", label: "Flora" },
  { key: "mutationChanceBonus", label: "Bioanalysis", fmt: (n) => n.toFixed(2) },
  { key: "miningFortune", label: "Mining Fortune" },
];

export const TierStatsTable: React.FC<{ highlight: TierId }> = ({ highlight }) => (
  <table className="w-full text-[11px]">
    <thead>
      <tr className="text-slate-500">
        <th className="text-left font-normal pr-2">Stat</th>
        {TIERS.map((t) => (
          <th key={t} className={`text-right font-normal px-1 ${t === highlight ? "text-amber-300" : ""}`}>
            {TIER_LABEL[t]}
          </th>
        ))}
      </tr>
    </thead>
    <tbody>
      {TIER_ROWS.map((r) => (
        <tr key={r.key}>
          <td className="pr-2 text-slate-400">{r.label}</td>
          {TIERS.map((t) => (
            <td key={t} className={`text-right px-1 ${t === highlight ? "text-amber-200" : "text-slate-300"}`}>
              {r.fmt ? r.fmt(TIER_STATS[t][r.key]) : TIER_STATS[t][r.key]}
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  </table>
);

/** Board, frequency, tier and "use my yield stats": shared by the list and the detail page. */
export const ViewerControls: React.FC<{ viewer: FlowViewer; children?: React.ReactNode }> = ({ viewer, children }) => (
  <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
    <Field label="Board">
      <BoardToggle viewer={viewer} />
    </Field>
    <Field
      label={
        <>
          Online every
          <InfoHint title="Online frequency" width={280}>
            How often you log in, in greenhouse cycles. Every entry was simulated at each of these frequencies, so the ranking changes with how
            often you can play.
          </InfoHint>
        </>
      }
    >
      <select className={`${inputClass} w-36`} value={viewer.every} onChange={(e) => viewer.setEvery(Number(e.target.value))} aria-label="Online every N cycles">
        {EVERY.map((n) => (
          <option key={n} value={n}>
            {n} cycle{n === 1 ? "" : "s"}
          </option>
        ))}
      </select>
    </Field>
    <Field
      label={
        <>
          Stat tier
          <InfoHint title="Player-stat tiers" width={340}>
            <p>
              Entries are simulated at four stat presets. {viewer.autoTier ? <>Picked from your simulator stats: <b>{TIER_LABEL[viewer.autoTier]}</b>.</> : "Save a scenario in the simulator to pick one automatically."}
            </p>
            <TierStatsTable highlight={viewer.tier} />
          </InfoHint>
        </>
      }
    >
      <select className={`${inputClass} w-36`} value={viewer.tier} onChange={(e) => viewer.setTier(e.target.value as TierId)} aria-label="Stat tier">
        {TIERS.map((t) => (
          <option key={t} value={t}>
            {TIER_LABEL[t]}
            {t === viewer.autoTier ? " (yours)" : ""}
          </option>
        ))}
      </select>
    </Field>
    {children}
    <label
      className={`flex items-center gap-2 text-xs pb-1.5 ${viewer.viewerStats ? "text-slate-300 cursor-pointer" : "text-slate-500"}`}
      title={viewer.viewerStats ? "Scale crop drops and rare crops to the Farming Fortune, yield upgrades, Overbloom and armor in your simulator settings" : "Save a scenario in the simulator first"}
    >
      <input type="checkbox" className="accent-emerald-500" checked={viewer.useMyStats && !!viewer.viewerStats} disabled={!viewer.viewerStats} onChange={(e) => viewer.setUseMyStats(e.target.checked)} />
      Use my yield stats
      <InfoHint title="Your yield stats" width={300}>
        The server runs every entry with wiki-maximum Farming Fortune, Plant Yield, Evergreen Chip, Overbloom and armor. With this on, the stored
        counts are scaled to the values in your simulator settings. That is an estimate (labelled as such); mutation items aren't scaled.
      </InfoHint>
    </label>
  </div>
);

/** Normal board: where the prices come from, with a refresh link. */
export const PriceNote: React.FC<{ viewer: FlowViewer; now: number }> = ({ viewer, now }) => {
  if (viewer.board !== "normal") return <span className="text-[11px] text-slate-500">Ironman board: NPC prices; mutation items are kept, not sold.</span>;
  const { prices, loading, error, refresh } = viewer.bazaar;
  return (
    <span className="text-[11px] text-slate-500 flex flex-wrap items-center gap-x-2">
      <span>
        {loading ? "Fetching Bazaar prices..." : prices ? `Bazaar prices from ${priceAge(prices.fetchedAt, now)}` : "No Bazaar prices yet"}
        {error ? <span className="text-amber-300"> (refresh failed: {error})</span> : null}
      </span>
      <button type="button" className="inline-flex items-center gap-1 text-emerald-300 hover:text-emerald-200 underline-offset-2 hover:underline disabled:opacity-50" onClick={refresh} disabled={loading}>
        <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} /> Refresh prices
      </button>
    </span>
  );
};

export const Avatar: React.FC<{ id: string; avatar: string | null; size?: number; className?: string }> = ({ id, avatar, size = 20, className = "" }) => (
  <img src={avatarUrl(id, avatar)} alt="" width={size} height={size} loading="lazy" className={`rounded-full bg-slate-700 flex-shrink-0 ${className}`} style={{ width: size, height: size }} />
);

export const AuthorLabel: React.FC<{ author: FlowAuthor; size?: number }> = ({ author, size = 20 }) => (
  <span className="inline-flex items-center gap-1.5 min-w-0">
    <Avatar id={author.id} avatar={author.avatar} size={size} />
    <span className="break-words min-w-0">{author.name}</span>
  </span>
);

const BADGE_STYLE = {
  stale: "bg-slate-600/30 text-slate-300 border-slate-500/40",
  estimated: "bg-amber-500/15 text-amber-200 border-amber-500/30",
  new: "bg-emerald-500/15 text-emerald-200 border-emerald-500/30",
  pending: "bg-blue-500/15 text-blue-200 border-blue-500/30",
  danger: "bg-red-500/15 text-red-200 border-red-500/30",
} as const;

export const Badge: React.FC<{ tone: keyof typeof BADGE_STYLE; title?: string; children: React.ReactNode }> = ({ tone, title, children }) => (
  <span title={title} className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-medium uppercase tracking-wide whitespace-nowrap ${BADGE_STYLE[tone]}`}>
    {children}
  </span>
);


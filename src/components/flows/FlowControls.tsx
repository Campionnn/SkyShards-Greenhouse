import React, { useMemo, useState } from "react";
import { ChevronDown, Clock, Coins, Copy, Gauge, Heart, LogOut, RefreshCw, RotateCcw, Sprout, Wrench, X, Zap } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import type { FlowViewer, ViewerStats } from "../../hooks/useFlowViewer";
import type { FlowAuthor } from "../../leaderboard/api";
import { cycleHours, EVERY, TIER_STATS, TIERS, type TierId } from "../../leaderboard/tiers";
import { avatarUrl, TIER_LABEL, userName } from "../../leaderboard/view";
import { ARMOR_SET_LABEL, ARMOR_SETS, BAZAAR_PRODUCTS, FORTUNE_CROPS, type ArmorSet, type FarmingToolStats, type FortuneCrop } from "../../simulator";
import { PlayerImportBox } from "../playerImport/PlayerImportBox";
import { StatInput } from "../playerStats/StatInput";
import { STAT_FIELDS, type NumericStatKey } from "../playerStats/statFields";
import { BazaarPriceControls, BazaarPriceDialog } from "../simulator/BazaarPanels";
import { priceAge } from "../simulator/bazaarFormat";
import { formatDuration } from "../simulator/format";
import { DiscordIcon, InfoHint, SegmentedControl } from "../ui";
import { DialogFrame, ModalDialog } from "../ui/ModalDialog";

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

type NumKey = Exclude<keyof ViewerStats, "armorSet" | "cropFortune" | "tools">;

/** A plain number input (online frequency, per-crop fortune). */
interface FieldSpec {
  key: string;
  label: string;
  min: number;
  max: number;
  step?: number;
  hint?: string;
  /** Shown after the number. */
  suffix?: string;
}

/** A viewer stat with a shared friendly definition (statFields.ts): the stat keys both types have. */
type StatKey = NumKey & NumericStatKey;

/** Stats that change the simulation itself: these decide the tier. */
const SIM_FIELDS: StatKey[] = ["cropGrowth", "growthUpgradeTier", "speedAttribute", "floraShard", "mutationChanceBonus", "miningFortune"];
/** Yield-only stats: these scale the stored counts directly. Per-crop fortune goes after Farming Fortune. */
const YIELD_FIELDS_TOP: StatKey[] = ["farmingFortune"];
const YIELD_FIELDS_REST: StatKey[] = ["plantYieldUpgrade", "overbloom", "evergreenChip"];

const fieldInput =
  "w-full bg-slate-900/70 border border-slate-600/40 rounded-md px-2 py-1.5 text-sm text-slate-100 tabular-nums focus:outline-none focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/30 transition-colors";

const NumberStat: React.FC<{ spec: FieldSpec; value: number; onChange: (v: number) => void }> = ({ spec, value, onChange }) => {
  const [text, setText] = useState<string | null>(null);
  const commit = (raw: string) => {
    const n = Number(raw);
    if (raw.trim() !== "" && Number.isFinite(n)) onChange(Math.max(spec.min, Math.min(spec.max, n)));
    setText(null);
  };
  return (
    <label className="block min-w-0">
      <span className="flex items-center gap-1 text-xs text-slate-400">
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
          <NumberStat spec={{ key: "every", label: "Every", min: 1, max: 48, hint: "How often you log in, in greenhouse cycles." }} value={viewer.stats.every} onChange={(every) => viewer.setStats({ every })} />
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

/** Normal board: the simulator's buy / sell side, tax and price editor, shared with it. */
const BazaarPricing: React.FC<{ viewer: FlowViewer }> = ({ viewer }) => {
  const [editing, setEditing] = useState(false);
  const [now] = useState(() => Date.now());
  const itemIds = useMemo(() => Object.keys(BAZAAR_PRODUCTS), []);
  return (
    <Group icon={<Coins />} title="Bazaar prices">
      <BazaarPriceControls bazaar={viewer.bazaar} now={now} onEditPrices={() => setEditing(true)} />
      {editing && <BazaarPriceDialog bazaar={viewer.bazaar} focusItem={null} itemIds={itemIds} onClose={() => setEditing(false)} />}
    </Group>
  );
};

const CROP_LABEL: Record<FortuneCrop, string> = {
  wheat: "Wheat",
  carrot: "Carrot",
  potato: "Potato",
  pumpkin: "Pumpkin",
  melon: "Melon",
  sugar_cane: "Sugar Cane",
  cactus: "Cactus",
  cocoa_beans: "Cocoa Beans",
  nether_wart: "Nether Wart",
  mushroom: "Mushroom",
  sunflower: "Sunflower",
  moonflower: "Moonflower",
  wild_rose: "Wild Rose",
};

const cropBonusCount = (s: ViewerStats) => FORTUNE_CROPS.filter((c) => (s.cropFortune[c] ?? 0) !== 0).length;

/** A tool's highest per-crop fortunes, "Wheat 310 · Carrot 120 · +3". */
function toolText(t: FarmingToolStats): string {
  const rows = FORTUNE_CROPS.map((c) => [c, t.fortune[c] ?? 0] as const)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  if (!rows.length) return "no crop fortune";
  const shown = rows.slice(0, 2).map(([c, v]) => `${CROP_LABEL[c]} ${Math.round(v)}`);
  return rows.length > 2 ? `${shown.join(" · ")} · +${rows.length - 2}` : shown.join(" · ");
}

/** Crop-specific fortune and tools: a one-line summary with an Edit button; the 13 inputs and the tool list open in a modal. */
const PerCropFortune: React.FC<{ viewer: FlowViewer }> = ({ viewer }) => {
  const s = viewer.stats;
  const count = cropBonusCount(s);
  const [open, setOpen] = useState(false);
  const text = [count ? `${count} crop bonus${count === 1 ? "" : "es"}` : "", s.tools.length ? `${s.tools.length} tool${s.tools.length === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ") || "none set";
  return (
    <div className="col-span-2">
      <div className="flex items-center gap-2 rounded-md border border-slate-700/50 bg-slate-900/30 px-2.5 py-1.5 text-xs">
        <Wrench className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
        <span className="text-slate-300">Per-crop fortune &amp; tools</span>
        <span className="ml-auto truncate text-[11px] text-slate-500">{text}</span>
        <button type="button" onClick={() => setOpen(true)} className="shrink-0 rounded-md border border-slate-600/40 bg-slate-800/60 px-2 py-0.5 text-[11px] text-slate-300 transition-colors hover:bg-slate-700/60">
          Edit
        </button>
      </div>
      {open && (
        <ModalDialog labelledBy="viewer-crop-fortune-title" onClose={() => setOpen(false)} maxWidth="max-w-xl">
          <DialogFrame
            id="viewer-crop-fortune-title"
            title="Per-crop fortune & tools"
            onClose={() => setOpen(false)}
            footer={
              <button type="button" onClick={() => setOpen(false)} className="rounded-md bg-emerald-500/80 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500">
                Done
              </button>
            }
          >
            <PerCropFortuneBody viewer={viewer} />
          </DialogFrame>
        </ModalDialog>
      )}
    </div>
  );
};

/** The editor inside the per-crop modal (kept outside the portal for SSR tests). */
export const PerCropFortuneBody: React.FC<{ viewer: FlowViewer }> = ({ viewer }) => {
  const s = viewer.stats;
  const count = cropBonusCount(s);
  const setCrop = (c: FortuneCrop) => (v: number) => viewer.setStats({ cropFortune: { ...s.cropFortune, [c]: v } });
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-xs text-slate-400">Crop bonus on top of Farming Fortune (Wheat Fortune, Mushroom Fortune, ...). Leave tools out; they are added per harvest below.</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {FORTUNE_CROPS.map((c) => (
            <NumberStat key={c} spec={{ key: c, label: CROP_LABEL[c], min: 0, max: 2000, step: 5 }} value={s.cropFortune[c] ?? 0} onChange={setCrop(c)} />
          ))}
        </div>
        {count > 0 && (
          <button type="button" onClick={() => viewer.setStats({ cropFortune: {} })} className="text-[11px] text-slate-400 transition-colors hover:text-slate-200">
            Clear crop bonuses
          </button>
        )}
      </div>
      {s.tools.length === 0 ? (
        <p className="text-xs text-slate-500">No tools. Import from Hypixel to fill in your farming tools.</p>
      ) : (
        <div className="rounded-md border border-slate-700/50 bg-slate-900/30 px-2.5 py-1.5" data-testid="viewer-tools">
          <div className="mb-1 flex items-center gap-1.5 text-xs text-slate-400">
            <Wrench className="h-3.5 w-3.5 text-emerald-400" />
            Tools
            <InfoHint title="Tools" width={260}>
              Each crop bundle is scaled with the tool that earns the most on it, as the simulator does per harvest.
            </InfoHint>
            <button type="button" onClick={() => viewer.setStats({ tools: [] })} className="ml-auto text-[11px] text-slate-500 transition-colors hover:text-slate-200">
              Clear
            </button>
          </div>
          <ul className="space-y-0.5">
            {s.tools.map((t, i) => (
              <li key={`${t.name}-${i}`} className="flex items-center gap-2 text-xs">
                <span className="min-w-0 truncate text-slate-200" title={t.name}>
                  {t.name}
                </span>
                <span className="ml-auto whitespace-nowrap text-[11px] tabular-nums text-slate-500">{toolText(t)}</span>
                <button
                  type="button"
                  onClick={() => viewer.setStats({ tools: s.tools.filter((_, j) => j !== i) })}
                  className="rounded p-0.5 text-slate-500 transition-colors hover:bg-slate-700/60 hover:text-slate-200"
                  title={`Remove ${t.name}`}
                  aria-label={`Remove ${t.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        </div>
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
  const crops = cropBonusCount(s);
  const toolCount = s.tools.length;
  const summary = useMemo(() => {
    const perCrop = [crops ? `+${crops} crop bonus${crops === 1 ? "" : "es"}` : "", toolCount ? `${toolCount} tool${toolCount === 1 ? "" : "s"}` : ""].filter(Boolean).join(", ");
    return `${TIER_LABEL[viewer.tier]} tier · every ${viewer.every} cycle${viewer.every === 1 ? "" : "s"} · ${Math.round(s.farmingFortune)} FF${perCrop ? ` (${perCrop})` : ""} · ${ARMOR_SET_LABEL[s.armorSet]}`;
  }, [viewer.tier, viewer.every, s.farmingFortune, s.armorSet, crops, toolCount]);
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
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {SIM_FIELDS.map((k) => (
                  <StatInput key={k} def={STAT_FIELDS[k]} variant="stacked" commitOn="blur" value={s[k]} onChange={set(k)} />
                ))}
              </div>
            </Group>
            <TierMeter viewer={viewer} />
          </div>
          <div className="space-y-5 min-w-0">
            <PlayerImportBox compact onImport={(patch) => viewer.setStats(patch)} />
            <Group
              icon={<Sprout />}
              title="Yield"
              hint={
                <InfoHint title="Yield stats" width={300}>
                  The server runs every flow at the wiki maxima, with no crop bonus or tools. These scale the stored crop and rare-crop counts to you; mutation
                  items aren't affected. An estimate, marked as such.
                </InfoHint>
              }
            >
              <div className="grid grid-cols-2 gap-3">
                {YIELD_FIELDS_TOP.map((k) => (
                  <StatInput key={k} def={STAT_FIELDS[k]} variant="stacked" commitOn="blur" className="col-span-2" value={s[k]} onChange={set(k)} />
                ))}
                <PerCropFortune viewer={viewer} />
                {YIELD_FIELDS_REST.map((k) => (
                  <StatInput key={k} def={STAT_FIELDS[k]} variant="stacked" commitOn="blur" className={STAT_FIELDS[k].kind === "chip" ? "col-span-2" : "col-span-2 sm:col-span-1"} value={s[k]} onChange={set(k)} />
                ))}
                <label className="col-span-2 block">
                  <span className="text-xs text-slate-400">Farming armor</span>
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
          {viewer.board === "normal" && (
            <div className="border-t border-slate-700/40 pt-4 lg:col-span-2">
              <BazaarPricing viewer={viewer} />
            </div>
          )}
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

/**
 * The leaderboard login: "Log in with Discord" when logged out, the avatar, name and a log-out
 * button when logged in. Login returns to the current page.
 */
export const AccountControl: React.FC = () => {
  const { user, loading, banned, login, logout } = useAuth();
  if (loading) return <span className="inline-flex h-7 w-24 animate-pulse rounded-md bg-slate-700/40" aria-label="Checking your login" />;
  if (user)
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-600/40 bg-slate-800/60 py-1 pl-1.5 pr-1 text-xs text-slate-200" data-testid="account-control">
        <Avatar id={user.id} avatar={user.avatar} size={20} />
        <span className="max-w-[9rem] truncate" title={`Logged in with Discord as ${userName(user)}`}>
          {userName(user)}
        </span>
        <button
          type="button"
          onClick={logout}
          className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-700/60 hover:text-slate-100"
          title="Log out"
          aria-label="Log out"
        >
          <LogOut className="h-3.5 w-3.5" />
        </button>
      </span>
    );
  return (
    <span className="inline-flex items-center gap-2" data-testid="account-control">
      {banned && <span className="text-[11px] text-red-300">This account is banned from the leaderboard.</span>}
      <button
        type="button"
        onClick={() => login()}
        title="Log in to like and submit flows. Only your Discord name and avatar are used."
        className="inline-flex items-center gap-1.5 rounded-md bg-[#5865F2]/80 px-3 py-1.5 text-xs font-medium text-white transition-[background-color,transform] duration-150 hover:bg-[#5865F2] active:scale-[0.97]"
      >
        <DiscordIcon className="h-3.5 w-3.5" /> Log in with Discord
      </button>
    </span>
  );
};

/**
 * Heart + like count. `onToggle` is omitted for a read-only count (own flow); a logged-out click
 * goes through the login (the caller's toggle handles that).
 */
export const LikeButton: React.FC<{
  count: number;
  liked: boolean;
  busy?: boolean;
  onToggle?: () => void;
  size?: "sm" | "md";
  title?: string;
}> = ({ count, liked, busy = false, onToggle, size = "sm", title }) => {
  const icon = size === "md" ? "h-3.5 w-3.5" : "h-3 w-3";
  const box = size === "md" ? "gap-1.5 px-3 py-1.5 text-xs" : "gap-1 px-1.5 py-0.5 text-[11px]";
  const tone = liked ? "border-rose-500/40 bg-rose-500/15 text-rose-200" : "border-slate-600/50 bg-slate-800/70 text-slate-300";
  const content = (
    <>
      <Heart className={`${icon} transition-transform duration-150 ${liked ? "fill-rose-400 text-rose-400" : ""}`} />
      <span className="tabular-nums">{count.toLocaleString("en-US")}</span>
    </>
  );
  if (!onToggle)
    return (
      <span className={`inline-flex items-center rounded-md border ${box} border-slate-700/50 text-slate-400`} title={title ?? `${count} like${count === 1 ? "" : "s"}`}>
        {content}
      </span>
    );
  return (
    <button
      type="button"
      aria-pressed={liked}
      disabled={busy}
      title={title ?? (liked ? "Remove your like" : "Like this flow")}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={`inline-flex items-center rounded-md border font-medium transition-[background-color,color,transform] duration-150 hover:border-rose-500/40 hover:text-rose-200 active:scale-[0.95] disabled:opacity-60 ${box} ${tone}`}
    >
      {content}
    </button>
  );
};

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

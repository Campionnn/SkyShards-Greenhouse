import React, { useCallback, useMemo, useState } from "react";
import { ChevronDown, Copy, Heart, LogOut, RefreshCw, RotateCcw, X } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import type { FlowViewer, ViewerStats } from "../../hooks/useFlowViewer";
import type { FlowAuthor } from "../../leaderboard/api";
import { TIER_STATS, TIERS, type TierId } from "../../leaderboard/tiers";
import { avatarUrl, TIER_LABEL, userName } from "../../leaderboard/view";
import { ARMOR_SET_LABEL, ARMOR_SETS, BAZAAR_PRODUCTS, FORTUNE_CROPS, type ArmorSet, type FarmingToolStats, type FortuneCrop } from "../../simulator";
import { PlayerImportBox } from "../playerImport/PlayerImportBox";
import { StatInput } from "../playerStats/StatInput";
import { STAT_FIELDS, type NumericStatKey } from "../playerStats/statFields";
import { BazaarPriceControls, BazaarPriceDialog } from "../simulator/BazaarPanels";
import { priceAge } from "../simulator/bazaarFormat";
import { LinkButton } from "../ui/Card";
import { cn } from "../ui/cn";
import { DiscordIcon } from "../ui/DiscordIcon";
import { InfoHint } from "../ui/InfoHint";
import { IconButton, KitButton, KitInput, KitLabel, Pill, Segmented, Switch, type Tone } from "../ui/kit";
import { DialogFrame, ModalDialog } from "../ui/ModalDialog";
import { Dropdown, MenuItem, Popover } from "../ui/Popover";
import { EveryNumberInput, EveryRadios, SnapNote } from "./stats/FrequencyPicker";
import { everyTime, statsSummaryLong } from "./stats/statsSummary";

/**
 * Leaderboard controls shared by /flows and /flows/:id: the board toggle, the "Your stats" form
 * (granular inputs snapped to the nearest stat tier; shown in StatsDrawer) and small
 * presentational pieces (badges, likes, the login).
 */

/** The two boards; the default follows the site-wide profile mode. */
export const BoardToggle: React.FC<{ viewer: FlowViewer; className?: string }> = ({ viewer, className }) => (
  <Segmented
    label="Board"
    className={className}
    value={viewer.board}
    onChange={viewer.setBoard}
    options={[
      {
        value: "ironman",
        label: "Ironman",
        title: "Ironman from nothing: the flow's starting items are made first (with the site's builder), then it runs. NPC prices; Dead Plants and Fermento are farmed by you",
      },
      { value: "normal", label: "Normal", title: "Bazaar prices; supplies are bought" },
    ]}
  />
);

/** The ironman board's "I have the starting items" switch: ranks by the number with the starting items already owned. */
export const KitSwitch: React.FC<{ viewer: FlowViewer; className?: string }> = ({ viewer, className }) => {
  if (viewer.board !== "ironman") return null;
  const on = viewer.kit;
  return (
    <span
      className={cn("inline-flex", className)}
      title={on ? "Ranked as if you already own each flow's starting items" : "Ranked from nothing: making each flow's starting items first counts. Turn on if you already own them"}
      data-testid="kit-switch"
    >
      <Switch checked={on} onChange={viewer.setKit} label="I have the starting items" showLabel />
    </span>
  );
};

// ---- Stat inputs ---------------------------------------------------------------------------------

type NumKey = Exclude<keyof ViewerStats, "armorSet" | "cropFortune" | "tools">;

/** A viewer stat with a shared friendly definition (statFields.ts): the stat keys both types have. */
type StatKey = NumKey & NumericStatKey;

/** Stats that change the simulation itself: these decide the tier. */
const SIM_FIELDS: StatKey[] = ["cropGrowth", "growthUpgradeTier", "speedAttribute", "floraShard", "mutationChanceBonus", "miningFortune"];
/** Yield-only stats: these scale the stored counts directly. Per-crop fortune goes after Farming Fortune. */
const YIELD_FIELDS_TOP: StatKey[] = ["farmingFortune"];
const YIELD_FIELDS_REST: StatKey[] = ["plantYieldUpgrade", "overbloom", "evergreenChip"];

/** A plain number input that commits on blur / Enter (per-crop fortune). The hint sits beside the label, not inside it. */
const NumberStat: React.FC<{ id: string; label: string; min: number; max: number; step?: number; value: number; onChange: (v: number) => void }> = ({ id, label, min, max, step, value, onChange }) => {
  const [text, setText] = useState<string | null>(null);
  const commit = (raw: string) => {
    const n = Number(raw);
    if (raw.trim() !== "" && Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n)));
    setText(null);
  };
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="truncate text-secondary text-fg-muted">
        {label}
      </label>
      <KitInput
        id={id}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step ?? 1}
        className="w-full tabular-nums"
        value={text ?? String(value)}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
        }}
      />
    </div>
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
    <div className="space-y-1.5" data-testid="tier-meter">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-secondary">
        <span className="text-fg-muted">
          Scored at <b className="font-semibold text-fg">{TIER_LABEL[snap.tier]}</b> tier
        </span>
        <span className="text-fg-meta">
          one cycle ≈ <span className="tabular-nums text-fg-body">{everyTime(viewer, 1)}</span>
        </span>
      </div>
      <div className="relative mx-1.5 h-1 rounded-full bg-line" role="img" aria-label={`Your growth speed snaps to the ${TIER_LABEL[snap.tier]} tier`}>
        {order.map((t) => (
          <span
            key={t}
            className={cn("absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full", t === snap.tier ? "size-3 bg-select" : "size-2 bg-line-control")}
            style={{ left: `${at(snap.scores[t])}%` }}
          />
        ))}
        <span aria-hidden title="You" className="absolute -top-1.5 h-4 w-0.5 -translate-x-1/2 rounded-full bg-warn" style={{ left: `${Math.max(0, Math.min(100, at(snap.score)))}%` }} />
      </div>
      <div className="relative mx-1.5 h-4 text-meta text-fg-meta">
        {order.map((t, i) => (
          <span
            key={t}
            className={cn("absolute top-0", i === 0 ? "left-0 -translate-x-1.5" : i === order.length - 1 ? "right-0 translate-x-1.5" : "-translate-x-1/2", t === snap.tier && "text-select-fg")}
            style={i === 0 || i === order.length - 1 ? undefined : { left: `${at(snap.scores[t])}%` }}
          >
            {TIER_LABEL[t]}
          </span>
        ))}
      </div>
      <p className="text-meta text-fg-meta">Your growth speed snaps to the nearest tier (the yellow marker is you); yield stats then scale the result to you.</p>
    </div>
  );
};

export const TierStatsTable: React.FC<{ highlight: TierId }> = ({ highlight }) => (
  <table className="w-full text-meta tabular-nums">
    <thead>
      <tr className="text-fg-meta">
        <th className="pr-2 text-left font-medium">Stat</th>
        {TIERS.map((t) => (
          <th key={t} className={cn("px-1 text-right font-medium", t === highlight && "text-select-fg")}>
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
          <td className="pr-2 text-fg-meta">{label}</td>
          {TIERS.map((t) => (
            <td key={t} className={cn("px-1 text-right", t === highlight ? "text-fg" : "text-fg-body")}>
              {TIER_STATS[t][k]}
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  </table>
);

/** A form section: an uppercase label (with an optional hint beside it) over its controls. */
const Section: React.FC<{ title: string; hint?: React.ReactNode; className?: string; children: React.ReactNode }> = ({ title, hint, className, children }) => (
  <section className={cn("min-w-0 space-y-2.5", className)}>
    <KitLabel actions={hint}>{title}</KitLabel>
    {children}
  </section>
);

/** The online frequency: any number, with the grid's frequencies as quick picks. */
const EveryInput: React.FC<{ viewer: FlowViewer }> = ({ viewer }) => (
  <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-2">
      <EveryNumberInput viewer={viewer} id="stats-every" />
      <label htmlFor="stats-every" className="text-secondary text-fg-muted">
        cycles · about every <b className="font-semibold tabular-nums text-fg-body">{everyTime(viewer, viewer.stats.every)}</b>
      </label>
      <InfoHint title="Login frequency" width={260}>
        How often you log in, in greenhouse cycles: any number from 1 to 48. It commits on Enter or when you leave the box.
      </InfoHint>
    </div>
    <EveryRadios viewer={viewer} label="Online frequency presets" />
    <SnapNote viewer={viewer} />
  </div>
);

/** Normal board: the simulator's buy / sell side, tax and price editor, shared with it. */
const BazaarPricing: React.FC<{ viewer: FlowViewer }> = ({ viewer }) => {
  const [editing, setEditing] = useState(false);
  const [now] = useState(() => Date.now());
  const itemIds = useMemo(() => Object.keys(BAZAAR_PRODUCTS), []);
  return (
    <Section title="Bazaar prices">
      <BazaarPriceControls bazaar={viewer.bazaar} now={now} onEditPrices={() => setEditing(true)} />
      {editing && <BazaarPriceDialog bazaar={viewer.bazaar} focusItem={null} itemIds={itemIds} onClose={() => setEditing(false)} />}
    </Section>
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
const PerCropFortune: React.FC<{ viewer: FlowViewer; className?: string }> = ({ viewer, className }) => {
  const s = viewer.stats;
  const count = cropBonusCount(s);
  const [open, setOpen] = useState(false);
  const text = [count ? `${count} crop bonus${count === 1 ? "" : "es"}` : "", s.tools.length ? `${s.tools.length} tool${s.tools.length === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ") || "none set";
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className="text-secondary text-fg-muted">Per-crop fortune &amp; tools</span>
      <span className="flex h-8 items-center justify-between gap-2 text-body">
        <span className="min-w-0 truncate text-fg-meta">{text}</span>
        <KitButton size="sm" onClick={() => setOpen(true)} aria-label="Edit per-crop fortune and tools">
          Edit
        </KitButton>
      </span>
      {open && (
        <ModalDialog labelledBy="viewer-crop-fortune-title" onClose={() => setOpen(false)} maxWidth="max-w-xl">
          <DialogFrame
            id="viewer-crop-fortune-title"
            title="Per-crop fortune & tools"
            onClose={() => setOpen(false)}
            footer={
              <KitButton variant="primary" size="md" onClick={() => setOpen(false)}>
                Done
              </KitButton>
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
      <section className="space-y-2">
        <KitLabel actions={count > 0 ? <LinkButton onClick={() => viewer.setStats({ cropFortune: {} })}>Clear crop bonuses</LinkButton> : undefined}>Crop fortune on top of Farming Fortune</KitLabel>
        <p className="text-secondary text-fg-muted">Wheat Fortune, Mushroom Fortune, ... Leave tools out; they are added per harvest below.</p>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
          {FORTUNE_CROPS.map((c) => (
            <NumberStat key={c} id={`crop-fortune-${c}`} label={CROP_LABEL[c]} min={0} max={2000} step={5} value={s.cropFortune[c] ?? 0} onChange={setCrop(c)} />
          ))}
        </div>
      </section>
      {s.tools.length === 0 ? (
        <p className="text-secondary text-fg-meta">No tools. Import from Hypixel to fill in your farming tools.</p>
      ) : (
        <section className="space-y-1.5" data-testid="viewer-tools">
          <KitLabel
            actions={
              <span className="flex items-center gap-2">
                <InfoHint title="Tools" width={260}>
                  Each crop bundle is scaled with the tool that earns the most on it, as the simulator does per harvest.
                </InfoHint>
                <LinkButton onClick={() => viewer.setStats({ tools: [] })}>Clear</LinkButton>
              </span>
            }
          >
            Tools
          </KitLabel>
          <ul className="divide-y divide-line">
            {s.tools.map((t, i) => (
              <li key={`${t.name}-${i}`} className="flex items-center gap-2 py-1 text-body">
                <span className="min-w-0 truncate text-fg-body" title={t.name}>
                  {t.name}
                </span>
                <span className="ml-auto whitespace-nowrap text-secondary tabular-nums text-fg-meta">{toolText(t)}</span>
                <IconButton aria-label={`Remove ${t.name}`} onClick={() => viewer.setStats({ tools: s.tools.filter((_, j) => j !== i) })}>
                  <X />
                </IconButton>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};

/** Farming armor as a field dropdown. */
const ArmorField: React.FC<{ viewer: FlowViewer; className?: string }> = ({ viewer, className }) => (
  <div className={cn("flex min-w-0 flex-col gap-1", className)}>
    <span className="text-secondary text-fg-muted">Farming armor</span>
    <Dropdown
      label="Farming armor"
      look="field"
      className="h-8 w-full justify-between pl-2.5"
      button={<span className="truncate">{ARMOR_SET_LABEL[viewer.stats.armorSet]}</span>}
    >
      {(close) =>
        ARMOR_SETS.map((a: ArmorSet) => (
          <MenuItem
            key={a}
            checked={viewer.stats.armorSet === a}
            onSelect={() => {
              viewer.setStats({ armorSet: a });
              close();
            }}
          >
            {ARMOR_SET_LABEL[a]}
          </MenuItem>
        ))
      }
    </Dropdown>
  </div>
);

/**
 * The whole "Your stats" form (F110–F124), in the drawer's order: import, presets, board, login
 * frequency, growth (+ tier meter), yield (+ per-crop modal), and Bazaar prices on Normal.
 */
export const StatsForm: React.FC<{ viewer: FlowViewer }> = ({ viewer }) => {
  const s = viewer.stats;
  const set = (key: NumKey) => (v: number) => viewer.setStats({ [key]: v } as Partial<ViewerStats>);
  return (
    <div className="@container space-y-5" data-testid="stats-panel">
      <PlayerImportBox variant="primary" onImport={(patch) => viewer.setStats(patch)} />
      <div className="flex flex-wrap items-center gap-1">
        {viewer.hasSimulatorStats && (
          <KitButton variant="ghost" onClick={() => viewer.resetStats("simulator")}>
            <Copy /> Use my simulator stats
          </KitButton>
        )}
        <KitButton variant="ghost" onClick={() => viewer.resetStats("max")}>
          <RotateCcw /> Max everything
        </KitButton>
      </div>
      <Section title="Board">
        <BoardToggle viewer={viewer} />
        <p className="text-meta text-fg-meta">Also sets the simulator's profile.</p>
      </Section>
      <Section title="How often you log in">
        <EveryInput viewer={viewer} />
      </Section>
      <Section
        title="Growth and spawning"
        hint={
          <InfoHint title="Stat tiers" width={340}>
            <p className="mb-2">These change the simulation itself, so they pick which of the four simulated tiers you see.</p>
            <TierStatsTable highlight={viewer.tier} />
          </InfoHint>
        }
      >
        <TierMeter viewer={viewer} />
        <div className="grid gap-x-3 gap-y-2.5 @md:grid-cols-2">
          {SIM_FIELDS.map((k) => (
            <StatInput key={k} def={STAT_FIELDS[k]} variant="stacked" commitOn="blur" value={s[k]} onChange={set(k)} />
          ))}
        </div>
      </Section>
      <Section
        title="Yield"
        hint={
          <InfoHint title="Yield stats" width={300}>
            The server runs every flow at the wiki maxima, with no crop bonus or tools. These scale the stored crop and rare-crop counts to you; mutation items
            aren't affected. An estimate, marked as such.
          </InfoHint>
        }
      >
        <div className="grid gap-x-3 gap-y-2.5 @md:grid-cols-2">
          {YIELD_FIELDS_TOP.map((k) => (
            <StatInput key={k} def={STAT_FIELDS[k]} variant="stacked" commitOn="blur" value={s[k]} onChange={set(k)} />
          ))}
          <PerCropFortune viewer={viewer} />
          {YIELD_FIELDS_REST.map((k) => (
            <StatInput key={k} def={STAT_FIELDS[k]} variant="stacked" commitOn="blur" className={STAT_FIELDS[k].kind === "chip" ? "@md:col-span-2" : undefined} value={s[k]} onChange={set(k)} />
          ))}
          <ArmorField viewer={viewer} />
        </div>
      </Section>
      {viewer.board === "normal" && <BazaarPricing viewer={viewer} />}
    </div>
  );
};

/**
 * "Your stats" inline (legacy layout): a collapsible header with the board toggle over the same
 * form the drawer shows. The pages now open StatsDrawer instead; kept for callers and tests.
 */
export const StatsPanel: React.FC<{ viewer: FlowViewer; defaultOpen?: boolean }> = ({ viewer, defaultOpen = true }) => {
  // Phones start collapsed so the rankings are on screen; the summary line says what is set.
  const [open, setOpen] = useState(() => defaultOpen && (typeof window === "undefined" || window.matchMedia?.("(min-width: 1024px)").matches !== false));
  return (
    <section className="rounded-container border border-line bg-surface-card">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="focus-ring flex min-w-[min(100%,16rem)] flex-1 cursor-pointer flex-wrap items-center gap-x-2 gap-y-0.5 rounded-inner text-left"
          aria-expanded={open}
        >
          <span className="flex items-center gap-1.5 whitespace-nowrap text-title text-fg">
            Your stats
            <ChevronDown aria-hidden className={cn("size-3.5 text-fg-meta transition-transform duration-(--duration-ink)", open && "rotate-180")} />
          </span>
          {!open && <span className="min-w-0 text-secondary text-fg-meta">{statsSummaryLong(viewer)}</span>}
        </button>
        <BoardToggle viewer={viewer} />
      </header>
      {open && (
        <div className="border-t border-line px-4 py-4">
          <StatsForm viewer={viewer} />
        </div>
      )}
    </section>
  );
};

/** Ironman: NPC prices. Normal: where the Bazaar prices come from, with a refresh link. */
export const PriceNote: React.FC<{ viewer: FlowViewer; now: number }> = ({ viewer, now }) => {
  if (viewer.board !== "normal") return <span className="text-meta text-fg-meta">NPC prices; mutation items are kept, not sold</span>;
  const { prices, loading, error, refresh } = viewer.bazaar;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 text-meta text-fg-meta">
      <span>
        {loading ? "Fetching Bazaar prices..." : prices ? `Bazaar prices from ${priceAge(prices.fetchedAt, now)}` : "No Bazaar prices yet"}
        {error ? <span className="text-warn"> (refresh failed)</span> : null}
      </span>
      <LinkButton className="inline-flex items-center gap-1" onClick={refresh} disabled={loading}>
        <RefreshCw aria-hidden className={cn("size-3", loading && "animate-spin motion-reduce:animate-pulse")} /> Refresh
      </LinkButton>
    </span>
  );
};

export const Avatar: React.FC<{ id: string; avatar: string | null; size?: number; className?: string }> = ({ id, avatar, size = 20, className = "" }) => (
  <img src={avatarUrl(id, avatar)} alt="" width={size} height={size} loading="lazy" className={cn("shrink-0 rounded-full bg-surface-hover", className)} style={{ width: size, height: size }} />
);

export const AuthorLabel: React.FC<{ author: FlowAuthor; size?: number }> = ({ author, size = 20 }) => (
  <span className="inline-flex min-w-0 items-center gap-1.5">
    <Avatar id={author.id} avatar={author.avatar} size={size} />
    <span className="min-w-0 break-words">{author.name}</span>
  </span>
);

/** Discord's brand button (kept blurple by the user's choice, 2026-10-31). */
const discordButton =
  // design-guard-ignore: Discord brand colour (user kept the blurple login button)
  "hit-area focus-ring inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-control bg-[#5865F2] px-3 font-semibold text-fg transition-[background-color,scale] duration-(--duration-hover) hover:bg-[#4752C4] active:scale-97 disabled:opacity-40";

/** The "Log in with Discord" button (the login page and the like prompt). */
export const DiscordLoginButton = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { size?: "sm" | "md" }>(
  ({ size = "md", className, children, ...rest }, ref) => (
    <button ref={ref} type="button" {...rest} className={cn(discordButton, size === "sm" ? "h-7 text-secondary" : "h-8 text-body", className)}>
      <DiscordIcon className="size-3.5" /> {children ?? "Log in with Discord"}
    </button>
  ),
);
DiscordLoginButton.displayName = "DiscordLoginButton";

/**
 * The leaderboard login: "Log in with Discord" when logged out, the avatar, name and a log-out
 * button when logged in. Login returns to the current page.
 */
export const AccountControl: React.FC<{ className?: string }> = ({ className }) => {
  const { user, loading, banned, login, logout } = useAuth();
  if (loading) return <span className={cn("inline-flex h-8 w-28 animate-pulse rounded-control bg-surface-hover motion-reduce:animate-none", className)} aria-label="Checking your login" />;
  if (user)
    return (
      <span className={cn("inline-flex h-8 items-center gap-1.5 rounded-control border border-line-strong bg-surface-control pr-0.5 pl-1.5 text-body text-fg-body", className)} data-testid="account-control">
        <Avatar id={user.id} avatar={user.avatar} size={20} />
        <span className="max-w-36 truncate" title={`Logged in with Discord as ${userName(user)}`}>
          {userName(user)}
        </span>
        <IconButton aria-label="Log out" onClick={logout}>
          <LogOut />
        </IconButton>
      </span>
    );
  return (
    <span className={cn("inline-flex items-center gap-2", className)} data-testid="account-control">
      {banned && <span className="text-meta text-problem">This account is banned from the leaderboard.</span>}
      <DiscordLoginButton onClick={() => login()} title="Log in to like and submit flows. Only your Discord name and avatar are used." />
    </span>
  );
};

/**
 * The "log in to like" prompt a logged-out heart click opens, anchored under the heart. A kit
 * dialog popover: it takes focus (the login button), Tab stays inside, Escape or an outside press
 * closes it and returns focus to the heart. Confirming runs `onLogin` (the caller's toggle: it
 * remembers the like and redirects to Discord). Clicks inside never reach the ranking row behind.
 */
const LikeLoginPopover: React.FC<{ anchor: HTMLButtonElement | null; open: boolean; onLogin: () => void; onClose: () => void }> = ({ anchor, open, onLogin, onClose }) => (
  <Popover anchor={anchor} open={open} onClose={onClose} label="Log in to like flows" width={256} align="end" initialFocus="last" className="p-3">
    <div data-testid="like-login-popover">
      <p className="flex items-center gap-1.5 text-body font-semibold text-fg">
        <Heart aria-hidden className="size-3.5 fill-restart text-restart" /> Log in to like flows
      </p>
      <p className="mt-1 text-secondary text-fg-muted">Likes are tied to your Discord account (only your name and avatar are used). This flow is liked once you're back.</p>
      <div className="mt-3 flex justify-end gap-2">
        <KitButton variant="ghost" onClick={onClose}>
          Not now
        </KitButton>
        <DiscordLoginButton size="sm" onClick={onLogin} />
      </div>
    </div>
  </Popover>
);

/**
 * Heart + like count. `onToggle` is omitted for a read-only count (own flow). With `needsLogin`
 * (logged out) a click opens a small "log in to like" prompt first; its button runs `onToggle`,
 * which remembers the like and goes through the Discord login.
 */
export const LikeButton: React.FC<{
  count: number;
  liked: boolean;
  busy?: boolean;
  onToggle?: () => void;
  needsLogin?: boolean;
  size?: "sm" | "md";
  title?: string;
  className?: string;
}> = ({ count, liked, busy = false, onToggle, needsLogin = false, size = "sm", title, className }) => {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [asking, setAsking] = useState(false);
  const closeAsk = useCallback(() => setAsking(false), []);
  const box = size === "md" ? "h-8 gap-1.5 px-2.5 text-body [&>svg]:size-4" : "h-7 gap-1 px-2 text-secondary [&>svg]:size-3.5";
  const content = (
    <>
      <Heart aria-hidden className={cn("transition-colors duration-(--duration-hover)", liked && "fill-restart text-restart")} />
      <span className="tabular-nums">{count.toLocaleString("en-US")}</span>
    </>
  );
  if (!onToggle)
    return (
      <span className={cn("inline-flex shrink-0 items-center rounded-control text-fg-muted", box, className)} title={title ?? `${count} like${count === 1 ? "" : "s"}`}>
        {content}
      </span>
    );
  return (
    <>
      <button
        ref={setAnchor}
        type="button"
        aria-pressed={needsLogin ? undefined : liked}
        aria-haspopup={needsLogin ? "dialog" : undefined}
        aria-expanded={needsLogin ? asking : undefined}
        aria-label={needsLogin ? `Like (${count}): log in with Discord first` : liked ? `Remove your like (${count})` : `Like this flow (${count})`}
        disabled={busy}
        title={asking ? undefined : (title ?? (needsLogin ? "Log in with Discord to like this flow" : liked ? "Remove your like" : "Like this flow"))}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          if (needsLogin) setAsking((a) => !a);
          else onToggle();
        }}
        className={cn(
          "hit-area focus-ring relative inline-flex shrink-0 cursor-pointer items-center rounded-control border font-medium transition-[background-color,border-color,color,scale] duration-(--duration-hover) active:scale-97 disabled:pointer-events-none disabled:opacity-40",
          box,
          liked ? "border-restart/40 bg-restart/10 text-restart" : "border-line-strong bg-surface-control text-fg-body hover:border-restart/40 hover:text-restart",
          asking && "border-restart/40 text-restart",
          className,
        )}
      >
        {content}
      </button>
      {needsLogin && (
        <LikeLoginPopover
          anchor={anchor}
          open={asking}
          onClose={closeAsk}
          onLogin={() => {
            setAsking(false);
            onToggle();
          }}
        />
      )}
    </>
  );
};

/** Status badge tones on the kit's Pill. Old names stay (callers pass them); each maps to a role. */
const BADGE_TONE = {
  stale: "neutral",
  estimated: "warn",
  new: "neutral",
  pending: "script",
  danger: "problem",
  info: "neutral",
  violet: "script",
  warn: "warn",
} as const satisfies Record<string, Tone>;

export type BadgeTone = keyof typeof BADGE_TONE;

export const Badge: React.FC<{ tone: BadgeTone; title?: string; icon?: React.ReactNode; children: React.ReactNode; className?: string }> = ({ tone, title, icon, children, className }) => (
  <Pill tone={BADGE_TONE[tone]} title={title} className={cn("whitespace-nowrap", className)}>
    {icon}
    {children}
  </Pill>
);


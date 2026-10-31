import type { CellKind } from "../../../leaderboard/rules";
import { prepDays, stopsAt, type BoardNumber, type NeedLine } from "../../../leaderboard/view";
import { formatCoins, nameOf } from "../../simulator/format";

/** Text and constants for the /flows/:id page (kept apart from the components for fast refresh). */

/** Seeds the server runs per cell: 5 at the Max tier, 3 at the others (worker.py). */
export const SEEDS_MAX_TIER = 5;
export const SEEDS_OTHER_TIERS = 3;

/** Rows a list shows before "Show all". */
export const LIST_ROWS = 8;

/** The three board numbers' names. */
export const KIND_NAME: Record<CellKind, string> = { ironman: "From nothing", ironman_kit: "With the starting items", normal: "Normal" };
/** Short names for phones. */
export const KIND_SHORT: Record<CellKind, string> = { ironman: "From nothing", ironman_kit: "With items", normal: "Normal" };
/** The board each number belongs to. */
export const KIND_BOARD: Record<CellKind, string> = { ironman: "Ironman", ironman_kit: "Ironman", normal: "Bazaar" };

/** The detail page's sections (the `?tab=` values). */
export type DetailTab = "need" | "earn" | "freq" | "flow" | "proof";
export const DETAIL_TABS: { value: DetailTab; label: string; short: string }[] = [
  { value: "need", label: "What you need", short: "Needs" },
  { value: "earn", label: "Earnings", short: "Earnings" },
  { value: "freq", label: "Login frequency", short: "Frequency" },
  { value: "flow", label: "How it works", short: "Flow" },
  { value: "proof", label: "Effort and seeds", short: "Effort" },
];
export const tabFrom = (raw: string | null): DetailTab => (DETAIL_TABS.some((t) => t.value === raw) ? (raw as DetailTab) : "need");

/** The sub-line under a board number (F58). */
export function numberSub(n: BoardNumber, numbers: readonly BoardNumber[]): { text: string; warn: boolean } {
  if (n.profitPerDay === null) return { text: "not verified yet", warn: false };
  if (n.kind === "normal")
    return {
      text: [n.boughtPerDay > 0 ? `${formatCoins(n.boughtPerDay)}/day bought` : null, n.buildCost > 0 ? `${formatCoins(n.buildCost)} to build` : null].filter(Boolean).join(" · ") || "nothing to buy",
      warn: false,
    };
  const kitValue = numbers.find((x) => x.kind === "ironman_kit")?.profitPerDay ?? null;
  if (n.kind === "ironman" && n.prep !== null && !n.prep.done) return { text: "can't make its starting items in time", warn: true };
  if (n.kind === "ironman" && stopsAt(n.slowing, n.profitPerDay, kitValue)) return { text: "stops once its starting items run out", warn: true };
  if (n.slowing) return { text: "settles lower once its starting items run out", warn: false };
  if (n.kind === "ironman_kit") return { text: "if you own the starting items", warn: false };
  if (!n.prep) return { text: "builder first, then the flow", warn: false };
  if (Object.keys(n.prep.kit).length === 0) return { text: "no starting items needed", warn: false };
  const d = Math.max(1, Math.round(prepDays(n.prep)));
  return { text: `starting items made in ${d} day${d === 1 ? "" : "s"}`, warn: false };
}

/** "−42% vs max stats" (null when either side is missing or zero). */
export function deltaText(mine: number | null, max: number | null): string | null {
  if (mine === null || max === null || max === 0) return null;
  const d = Math.round(((mine - max) / Math.abs(max)) * 100);
  if (d === 0) return "same as max stats";
  return `${d > 0 ? "+" : "−"}${Math.abs(d)}% vs max stats`;
}

/** Forgiving as shown: over 100% (logging in later earns more) reads "100%+". */
export function forgivingText(r: number | null): string {
  if (r === null || !Number.isFinite(r)) return "n/a";
  return r > 1.005 ? "100%+" : `${Math.round(r * 100)}%`;
}

/** "625 items" and "277 Turtlellini + 2 more" for the starting items. */
export function needSummary(lines: readonly NeedLine[]): { value: string; sub: string } {
  if (!lines.length) return { value: "Nothing", sub: "starts from an empty inventory" };
  const total = lines.reduce((a, l) => a + l.needs, 0);
  const top = lines[0];
  return { value: `${total.toLocaleString("en-US")} item${total === 1 ? "" : "s"}`, sub: `${top.needs.toLocaleString("en-US")} ${nameOf(top.item)}${lines.length > 1 ? ` + ${lines.length - 1} more` : ""}` };
}

/** The upkeep as its largest item ("256 Turtlellini") and the rest ("+ 80 Ashwreath, 73 Chocoberry"). */
export function upkeepSummary(lines: readonly { item: string; perDay: number }[]): { value: string; sub: string } {
  if (!lines.length) return { value: "None", sub: "gives back everything it borrows" };
  const up = (n: number) => Math.ceil(n - 1e-9).toLocaleString("en-US");
  const [top, ...rest] = lines;
  return { value: `${up(top.perDay)} ${nameOf(top.item)}`, sub: rest.length ? `+ ${rest.map((l) => `${up(l.perDay)} ${nameOf(l.item)}`).join(", ")} a day` : "a day" };
}

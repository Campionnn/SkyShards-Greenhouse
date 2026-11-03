import { useMemo } from "react";
import type { FlowDetail } from "../../../leaderboard/api";
import { valueResult } from "../../../leaderboard/pricing";
import type { CellKind } from "../../../leaderboard/rules";
import type { TierId } from "../../../leaderboard/tiers";
import {
  boardNumbers,
  earningTargets,
  findCell,
  itemBreakdown,
  kitSummaryText,
  moneyBySource,
  mutationsPerDay,
  needLines,
  payloadStepNamer,
  profitByEvery,
  rampDays,
  revenueSplit,
  slackFrom,
  spreadAt,
  stallInfo,
  starvedList,
  steadyRate,
  stopsAt,
  suppliesOf,
  suppliesText,
  upkeepLines,
  upkeepNeedText,
  usedUpLines,
  viewerResult,
} from "../../../leaderboard/view";
import { defaultViewerStats, yieldOf, type FlowViewer } from "../../../hooks/useFlowViewer";
import { defaultGameData } from "../../../simulator";
import { formatCoins } from "../../simulator/format";

const DATA = defaultGameData();
const MAX_YIELD = yieldOf(defaultViewerStats());

/**
 * Everything the detail page shows for the viewer's board, starting-items switch, tier, frequency,
 * yield stats and prices: priced on the client from the stored counts (view.ts), like before the
 * revamp. `maxNumbers` are the same three numbers at the simulated maxima, for "−x% vs max stats".
 */
export function detailModel(detail: FlowDetail, viewer: FlowViewer) {
  const kind: CellKind = viewer.cellKind;
  const board = viewer.board;
  const settings = { quotes: viewer.quotes, pricing: viewer.bazaar.pricing, viewerStats: viewer.viewerStats, useMyStats: true as const };
  // The viewer's tier, or the Max tier standing in while that tier is still being verified.
  const exact = findCell(detail.cells, kind, viewer.tier, viewer.every) ?? null;
  const cell = exact ?? findCell(detail.cells, kind, "max", viewer.every) ?? null;
  const tierShown: TierId = exact ? viewer.tier : "max";
  const points = profitByEvery(DATA, detail.cells, kind, tierShown, settings);
  const shown = cell ? viewerResult(DATA, cell.median, settings) : null;
  const quotes = board === "normal" ? viewer.quotes : {};
  const value = shown ? valueResult(DATA, shown.result, board, quotes, viewer.bazaar.pricing) : null;
  const numbers = boardNumbers(DATA, detail.cells, viewer.tier, viewer.every, settings);
  const maxNumbers = boardNumbers(DATA, detail.cells, "max", viewer.every, { ...settings, viewerStats: MAX_YIELD });
  const steady = cell ? steadyRate(DATA, cell.median, { board, ...settings }) : null;
  // How the starting items are made: the "from nothing" cell's prep (this tier, else Max).
  const fromNothing = numbers.find((n) => n.kind === "ironman");
  const prep = fromNothing?.prep ?? null;
  const kitN = numbers.find((n) => n.kind === "ironman_kit")?.profitPerDay ?? null;
  const fnCell = findCell(detail.cells, "ironman", viewer.tier, viewer.every) ?? findCell(detail.cells, "ironman", "max", viewer.every);
  const need = upkeepNeedText(fnCell?.median.upkeep);
  const stopsNote =
    fromNothing && prep?.done && stopsAt(fromNothing.slowing, fromNothing.profitPerDay, kitN)
      ? `From nothing it stops once the starting items run out${need ? `: it uses ${need} that it doesn't grow` : ""}. Leftover placed items that never helped enough mutations don't decay, so the plots stay blocked (no room for Lonelily). With the items topped up: ${kitN !== null ? formatCoins(kitN) : "?"}/day.`
      : null;

  const firstThumb = detail.summary?.plots.find((p) => p.thumb)?.thumb ?? null;
  const median = cell?.median ?? null;
  return {
    kind,
    board,
    cell,
    exact: !!exact,
    tierShown,
    points,
    forgiving: slackFrom(points, viewer.every),
    shown,
    value,
    split: shown ? revenueSplit(DATA, shown.result, board, quotes, viewer.bazaar.pricing) : null,
    items: shown ? itemBreakdown(DATA, shown.result, board, viewer.quotes, viewer.bazaar.pricing) : [],
    sources: shown ? moneyBySource(DATA, shown.result.bySource, board, quotes, viewer.bazaar.pricing).filter((l) => l.coinsPerDay > 0) : [],
    earning: earningTargets(DATA, detail.summary?.targets ?? [], shown?.result.bySource, board, quotes, viewer.bazaar.pricing),
    numbers,
    maxNumbers,
    stepName: payloadStepNamer(detail.payload?.plots),
    steady,
    rampDays: median ? rampDays(median) : undefined,
    stall: median ? stallInfo(median.starved) : null,
    slowing: median?.slowing === true,
    prep,
    stopsNote,
    starved: median ? starvedList(median.starved) : [],
    spread: cell ? spreadAt(cell.spread, viewer.every) : null,
    seedCount: cell?.seeds ?? 0,

    supplies: shown ? suppliesText(suppliesOf(shown.result)) : "none",
    mutationsPerDay: shown ? mutationsPerDay(DATA, shown.result) : 0,
    kitSummary: median ? kitSummaryText(median) : null,
    needLines: median ? needLines(median) : [],
    usedUp: median ? usedUpLines(median.usedUp) : [],
    upkeep: median ? upkeepLines(median.upkeep) : [],
    heroLayout: detail.thumb?.layout ?? (firstThumb ? { code: firstThumb } : (detail.payload?.plots?.[0]?.flow.steps[0]?.layout ?? null)),
  };
}

export type DetailModel = ReturnType<typeof detailModel>;

export function useDetailModel(detail: FlowDetail, viewer: FlowViewer): DetailModel {
  const { cells, summary, payload, thumb } = detail;
  const { cellKind, board, tier, every, quotes, viewerStats } = viewer;
  const pricing = viewer.bazaar.pricing;
  return useMemo(
    () => detailModel({ ...detail, cells, summary, payload, thumb }, viewer),
    // The model depends on these inputs only (the viewer object is new every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cells, summary, payload, thumb, cellKind, board, tier, every, quotes, viewerStats, pricing],
  );
}

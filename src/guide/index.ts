/**
 * The Rose Dragon Guide library: one exact login plan plus a simulated forecast.
 *
 *   const guideEnv = createGuideEnv();
 *   const flow = await loadShippedFlow();
 *   const catalog = buildCatalog(flow, guideEnv.env.resolveLayout);
 *   const outcomes = decideLogin(flow, toInput(state), guideEnv);   // Plot 1 -> 2 -> 3, shared stock
 *   const runs = runForecast(flow, toInput(state), guideEnv, PRECISION_SEEDS.quick);
 *   const forecast = summarise(runs, state.inventory);
 *   const plan = buildPlan(runs);
 */
export { createGuideEnv, decideLogin, plotOrder, projectLogin, type GuideEnv, type LoginResult } from "./project";
export {
  ALOE_FRAGMENT,
  SUPPLY_ITEMS,
  DONE,
  GROUP_LABELS,
  HUB,
  SHIPPED_FLOW_URL,
  SUPPLIES,
  buildCatalog,
  farmOf,
  goalItems,
  groupedItems,
  itemGroup,
  itemName,
  loadShippedFlow,
  parseFlows,
  simulatorScenario,
  type Catalog,
  type Farm,
  type FlowsFile,
  type ItemGroup,
} from "./flow";
export { DEFAULT_MAX_CYCLES, PRECISION_SEEDS, SUPPLY_TOP_UP, runForecast, runOne } from "./forecast";
export { buildPlan, medoid, sequenceDistance, spread, summarise } from "./aggregate";
export { describeWhy, explain, verbOf, type Explanation, type Verb } from "./explain";
export { GENERAL_TIPS, farmTips, scriptKnobs, type ScriptKnobs } from "./tips";
export {
  STORAGE_VERSION,
  allActed,
  confirmPlot,
  goalOwned,
  skipPlot,
  withSettings,
  zombudYield,
  type ConfirmExtras,
  emptyFacts,
  hasFacts,
  initialState,
  restoreState,
  setFacts,
  setFarm,
  setItem,
  startNewCheckIn,
  toInput,
  undoPlot,
  validate,
  type Confirmation,
  type GuideState,
} from "./checkin";
export { DEFAULT_CHECK_EVERY, GUIDE_DEFAULT_STATS, activityFor, guideDefaultSettings, hoursPerCycle, hoursToCycles } from "./schedule";
export type * from "./types";


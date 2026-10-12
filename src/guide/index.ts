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
  BOUGHT_SUPPLIES,
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
  STARTER_SUPPLIES,
  allActed,
  confirmPlot,
  confirmationOf,
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
export { HOURS_PER_CYCLE, cyclesFromSchedule, hoursToCycles, scheduleHours } from "./schedule";
export type * from "./types";


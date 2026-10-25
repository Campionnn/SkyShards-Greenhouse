import React from "react";
import { Activity } from "lucide-react";
import { EFFORT_WEIGHTS, type RunSummary } from "../../simulator";
import { effortResult } from "../../leaderboard/result";
import { EffortBreakdown, EffortMeter } from "../flows/FlowVisuals";
import { EFFORT_LABEL } from "../flows/flowsDisplay";
import { InfoHint, Panel } from "../ui";
import { formatCount } from "./format";

/** "Watering 1, Harvests 1, ..." in the engine's order, for the help text. */
const WEIGHT_LIST = Object.entries(EFFORT_WEIGHTS)
  .map(([k, w]) => `${EFFORT_LABEL[k] ?? k} ${w}`)
  .join(", ");

/**
 * How much work the run takes per login: the same effort numbers the leaderboard ranks by
 * (`RunSummary.effort`, priced into per-login rates by `effortResult`), so a flow's effort can be
 * read here before it is submitted. Follows the run live, like the other report panels.
 */
export const EffortPanel: React.FC<{ summary: RunSummary }> = ({ summary }) => {
  const effort = effortResult(summary.effort);
  const none = effort.sessions === 0;
  return (
    <Panel
      title="Effort"
      icon={<Activity />}
      description="How much work the player does each time they log in. The leaderboard shows the same numbers."
      actions={
        <InfoHint title="How effort is counted" width={320}>
          A weighted count of what the player does while online: {WEIGHT_LIST}. Watering a plot counts once per login, however many plants need
          it. A step change counts on top of what it places and breaks, and its ground comes with it. Something put down and broken again in the
          same login (a crop replanted, then cleared by a step change) counts for neither. Average per login and the heaviest login so far.
        </InfoHint>
      }
    >
      {none ? (
        <p className="text-xs text-slate-500">No logins yet. Run the simulation, or check the online schedule in Settings.</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
            <div>
              <div className="text-2xl font-semibold leading-none tabular-nums text-slate-100">{effort.avg.toFixed(effort.avg < 10 ? 1 : 0)}</div>
              <div className="mt-1 text-[11px] text-slate-500">avg per login</div>
            </div>
            <div>
              <div className="text-2xl font-semibold leading-none tabular-nums text-slate-300">{formatCount(effort.peak)}</div>
              <div className="mt-1 text-[11px] text-slate-500">heaviest login</div>
            </div>
            <div className="pb-0.5">
              <EffortMeter avg={effort.avg} peak={effort.peak} />
              <div className="mt-1 text-[11px] text-slate-500">{formatCount(effort.sessions)} logins</div>
            </div>
          </div>
          <EffortBreakdown effort={effort} />
        </div>
      )}
    </Panel>
  );
};

import React from "react";
import { SkipForward } from "lucide-react";
import type { StopPosition } from "../../../simulator/worker/protocol";
import { cn } from "../../ui/cn";
import { KitButton } from "../../ui/kit";
import { surface } from "../../ui/surface";
import { describeStop, stopPlace } from "./stepBy";

// Shown while the page is stopped inside a cycle (Step by: detail): which cycle, where in it, and
// what just happened. The plots and numbers below show the state right after that moment.

export const StopBar: React.FC<{ position: StopPosition; onFinish: () => void }> = ({ position, onFinish }) => {
  const { stop } = position;
  const script = stop.kind === "scriptAction" || stop.kind === "scriptHook";
  return (
    <div role="status" data-testid="stop-bar" className={cn("flex min-w-0 items-center gap-3 px-3 py-2", surface.card, "border-select/40")}>
      <span className="shrink-0 text-secondary tabular-nums text-fg-meta">
        Cycle {position.cycle.toLocaleString("en-US")} · {position.index} of {position.count}
      </span>
      <span className="shrink-0 text-secondary text-fg-muted">{stopPlace(stop)}</span>
      <span className={cn("min-w-0 flex-1 truncate text-body", script ? "text-script" : "text-fg")} title={describeStop(stop)}>
        {describeStop(stop)}
      </span>
      <KitButton variant="ghost" onClick={onFinish} aria-label="Finish cycle" title="Finish this cycle (the rest of it runs at once)" className="shrink-0">
        <SkipForward /> <span className="max-sm:hidden">Finish cycle</span>
      </KitButton>
    </div>
  );
};

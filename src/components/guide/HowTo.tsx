/**
 * How to use the Guide. The three steps live in the title's InfoHint; on a first visit they also show
 * as one line under the header ("Got it" folds it away, remembered in `skyshards-guide-howto`).
 */
import React, { useState } from "react";
import { InfoHint } from "../ui/InfoHint";
import { LinkButton } from "../ui/Card";
import { LocalStorageManager } from "../../utilities/localStorageManager";

const steps = (plotCount: number, loginOrder: string) => [
  "Update what you own: Import again, or Add harvest.",
  `Do each plot in the game, in order: ${loginOrder}.`,
  `Press the button on all ${plotCount} cards. Next time you're online, press Next check-in.`,
];

/** The first-visit line: the same steps, shorter. */
const shortSteps = (plotCount: number, loginOrder: string) => [
  "Update what you own",
  `Do each plot in the game, ${loginOrder}`,
  `Press the button on all ${plotCount} cards`,
];

/** The "?" next to the page title. */
export const HowToHint: React.FC<{ plotCount: number; loginOrder: string }> = ({ plotCount, loginOrder }) => (
  <InfoHint title="How to use this guide" width={360} label="How to use this guide">
    <ol className="list-decimal space-y-1 pl-4">
      {steps(plotCount, loginOrder).map((s) => (
        <li key={s}>{s}</li>
      ))}
    </ol>
    <p>
      The cards are the Rose Dragon flow's own decisions for exactly what you entered. Pressing a card's button takes off what that plot placed; harvests are random, so you add
      those (or import them). Hover or tap any cell of a farm to see what it is. Only have Plots 1 and 2? Pick 2 plots: each version keeps its own inventory and progress.
    </p>
  </InfoHint>
);

/** First visit only: the steps in one line, until "Got it". */
export const HowTo: React.FC<{ plotCount: number; loginOrder: string }> = ({ plotCount, loginOrder }) => {
  const [hidden, setHidden] = useState(() => typeof localStorage !== "undefined" && LocalStorageManager.loadGuideHowToHidden());
  if (hidden) return null;
  return (
    <section className="flex items-start gap-3 text-secondary text-fg-muted" aria-label="How to use this guide">
      <ol className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-4 gap-y-1">
        {shortSteps(plotCount, loginOrder).map((s, i) => (
          <li key={s} className="flex min-w-0 items-baseline gap-1.5">
            <span className="tabular-nums text-fg-meta">{i + 1}</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
      <LinkButton
        className="shrink-0"
        onClick={() => {
          LocalStorageManager.saveGuideHowToHidden(true);
          setHidden(true);
        }}
      >
        Got it
      </LinkButton>
    </section>
  );
};

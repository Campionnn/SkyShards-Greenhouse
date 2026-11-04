/**
 * "How to use this guide", near the top of the page instead of behind a tooltip. Open by default;
 * folding it away is remembered (`skyshards-guide-howto`), and the fold keeps a one-line summary.
 */
import React, { useState } from "react";
import { BookOpen, ChevronDown } from "lucide-react";
import { LocalStorageManager } from "../../utilities/localStorageManager";

export const HowTo: React.FC<{ plotCount: number; loginOrder: string }> = ({ plotCount, loginOrder }) => {
  const [hidden, setHidden] = useState(() => typeof localStorage !== "undefined" && LocalStorageManager.loadGuideHowToHidden());
  const toggle = () => {
    LocalStorageManager.saveGuideHowToHidden(!hidden);
    setHidden(!hidden);
  };
  const steps = [
    {
      title: "Update what you own",
      body: "After harvesting, press Import again (it reads your sacks and storage from Hypixel) or Add a harvest to type it in. The cards are only as good as these numbers.",
    },
    {
      title: `Do each plot's card, ${loginOrder}`,
      body: "Each card says what to do on that plot right now, with the farm drawn cell by cell. Do it in the game, then press the card's green button. The plots are worked out in this order against the same stock, so doing them in order never runs you short.",
    },
    {
      title: `Press the button on all ${plotCount} cards`,
      body: "A pressed card turns into \"Plot N is set up\" and waits; it doesn't change again until the next visit. Once every plot is done, press \"I'm back: next check-in\" next time you're online.",
    },
  ];
  return (
    <section className="rounded-lg border border-slate-600/30 bg-slate-800/40" aria-label="How to use this guide">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!hidden}
        className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-4 py-2.5 text-left text-sm transition-colors hover:bg-slate-700/20"
      >
        <BookOpen className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
        <span className="font-medium text-slate-200">How to use this guide</span>
        {hidden && <span className="hidden min-w-0 truncate text-xs text-slate-400 sm:inline">Update what you own → do each plot's card → press all {plotCount} buttons</span>}
        <span className="ml-auto flex shrink-0 items-center gap-1 text-xs text-slate-400">
          {hidden ? "Show" : "Hide"} <ChevronDown className={`h-4 w-4 transition-transform motion-reduce:transition-none ${hidden ? "" : "rotate-180"}`} />
        </span>
      </button>
      {!hidden && (
        <div className="border-t border-slate-600/30 px-4 py-3">
          <ol className="grid gap-3 md:grid-cols-3">
            {steps.map((s, i) => (
              <li key={s.title} className="flex gap-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-xs font-semibold text-emerald-300">{i + 1}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-slate-100">{s.title}</span>
                  <span className="block text-xs leading-relaxed text-slate-400">{s.body}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
            The cards are the shipped Rose Dragon flow's own decisions for exactly what you entered. Pressing a card's button takes off what that plot placed; harvests
            are random, so you add those (or import them). Hover or tap any cell of a farm to see what it is. Only have Plots 1 and 2? Switch to{" "}
            <strong className="text-slate-400">2 plots</strong> at the top: each version keeps its own inventory and progress.
          </p>
        </div>
      )}
    </section>
  );
};

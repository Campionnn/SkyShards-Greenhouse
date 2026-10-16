/**
 * Turning a projected plot outcome into words a player can act on.
 *
 * The decision itself is never guessed here; this only explains the script's own answer.
 */
import type { GameData } from "../simulator/data/types";
import { DONE, HUB, SUPPLIES, itemName, type Catalog, farmOf } from "./flow";
import type { PlotOutcome } from "./types";

export type Verb = "switch" | "stay" | "rebuild" | "clear" | "supplies" | "wait" | "done";

export interface Explanation {
  verb: Verb;
  /** "Switch to Commons farm", "Keep Rares", ... */
  headline: string;
  /** One plain sentence: why. */
  reason: string;
}

export function verbOf(outcome: PlotOutcome): Verb {
  if (outcome.action === "done" || outcome.to === DONE) return "done";
  if (outcome.to === SUPPLIES) return "supplies";
  if (outcome.action === "refresh") return "rebuild";
  if (outcome.to === HUB) return outcome.from === HUB ? "wait" : "clear";
  if (outcome.action === "enter") return "switch";
  return "stay";
}

/** The script's machine reason as a sentence. `name` turns a step id into a farm name. */
export function describeWhy(why: string, name: (id: string) => string): string {
  if (!why) return "";
  if (why === "goal complete" || why === "the step's own exit finished the flow") return "Every Rose Dragon legendary is already in your inventory.";
  if (why === "idle") return "The plot was free, and this is the most useful farm you can afford.";
  if (why === "shellfruit popped") return "The Shellfruit have been popped and harvested.";
  if (why === "refresh short") return "The farm needs rebuilding, but you don't have the inputs.";
  if (why === "waiting for the Blastberries to prime") return "The Blastberries aren't all primed yet, so the Shellfruit can't be popped this visit.";
  if (why.startsWith("finishing nearly grown targets")) return "Some targets are nearly fully grown, so it's worth letting them finish.";
  const m = /^(working|keeping|satisfied|short|narrow|join|preempt|handover|special|left|refresh|rebuild) (.+?)( standing)?$/.exec(why);
  if (!m) return why;
  const farm = name(m[2]);
  switch (m[1]) {
    case "working":
      return `${farm} is still making items the plan needs.`;
    case "keeping":
      return `Nothing better can start yet, so ${farm} stays standing.`;
    case "satisfied":
      return `You have enough of everything ${farm} makes.`;
    case "short":
      return `${farm} is missing inputs that your stock can't replace.`;
    case "narrow":
      return `${farm} is short on inputs, so only the part still worth running is kept.`;
    case "join":
      return `${farm} keeps running, and the other farm that fits beside it can start too.`;
    case "preempt":
      return `${farm} costs nothing to leave, and a higher-priority farm can start now.`;
    case "handover":
      return `${farm} has made enough for now, and a higher-priority farm can start.`;
    case "special":
      return `${farm} finished its special step.`;
    case "left":
      return `${farm} reached its own exit condition.`;
    case "refresh":
      return `${farm} was harvested or lost a plant, so it has to be rebuilt.`;
    case "rebuild":
      return `${farm} lost a ring input, so it has to be rebuilt.`;
    default:
      return why;
  }
}

/** Why an empty plot waits: Dead Plants / Fermento (and how many), or nothing affordable at all. */
function waitingOn(outcome: PlotOutcome, name: (id: string) => string, data: GameData): string {
  const block = outcome.supplyBlock;
  if (block?.need.length) {
    const need = block.need.map((b) => `${b.count} more ${itemName(data, b.item)}`).join(" and ");
    return `It's only short on supplies: with ${need} this plot could start ${name(block.farm)}.`;
  }
  return "Nothing you can afford is worth starting on this plot yet.";
}

export function explain(outcome: PlotOutcome, catalog: Catalog, data: GameData): Explanation {
  const name = (id: string) => {
    try {
      return farmOf(catalog, outcome.plotId, id).name;
    } catch {
      return id;
    }
  };
  const to = name(outcome.to);
  const reason = describeWhy(outcome.why, name);
  switch (verbOf(outcome)) {
    case "done":
      return { verb: "done", headline: "Done", reason: reason || "Every Rose Dragon legendary is owned." };
    case "supplies": {
      const block = outcome.supplyBlock;
      const need = block?.need.length ? block.need.map((b) => `${b.count} more ${itemName(data, b.item)}`).join(" and ") : "more Dead Plants or Fermento";
      return {
        verb: "supplies",
        headline: `Needs ${need}`,
        reason: block
          ? `${name(block.farm)} is the next farm for this plot, and all it's missing is ${need}. Dead Plants and Fermento have to be farmed separately: farm them, add them under What you own, or skip this plot for now.`
          : "The next farm is only short on Dead Plants or Fermento, which have to be farmed separately. Farm some and add them under What you own, or skip this plot for now.",
      };
    }
    case "rebuild":
      return {
        verb: "rebuild",
        headline: `Rebuild ${to}`,
        reason: `${reason} Break any roots, harvest anything fully grown, then put back every placed input that is missing or damaged. The picture shows the full farm.`.trim(),
      };
    case "clear":
      return {
        verb: "clear",
        headline: "Clear to empty farmland",
        reason: `${reason} ${waitingOn(outcome, name, data)} Empty farmland grows Lonelilies while it waits.`.trim(),
      };
    case "wait":
      return {
        verb: "wait",
        headline: "Leave it empty for now",
        reason: `${waitingOn(outcome, name, data)} Empty farmland grows Lonelilies while it waits.`,
      };
    case "switch": {
      if (outcome.to === "lonelily")
        return {
          verb: "switch",
          headline: `Switch to ${to}`,
          reason: "Lonelilies only spawn on farmland with nothing around them, and they cost nothing. Clear the plot, keep only the crops shown on the picture, and leave the rest empty. It is the most useful thing this plot can do with what you own right now.",
        };
      const free = outcome.spent.length === 0;
      return { verb: "switch", headline: `Switch to ${to}`, reason: free && outcome.why === "idle" ? "The plot was free, and this farm costs nothing to build." : reason };
    }
    default: {
      const waiting = outcome.waitFor.filter((w) => w.target > w.have);
      const until = waiting.length
        ? `Keep it until you have ${waiting
            .slice(0, 3)
            .map((w) => `${w.target} ${itemName(data, w.item)}`)
            .join(", ")}${waiting.length > 3 ? ` and ${waiting.length - 3} more` : ""}.`
        : "";
      return { verb: "stay", headline: `Keep ${to}`, reason: [reason, until].filter(Boolean).join(" ") };
    }
  }
}

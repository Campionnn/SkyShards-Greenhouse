/**
 * "While you're here" tips: the only authored text in the Guide.
 *
 * The flows file has no per-farm instructions, so these come from the game mechanics the simulator
 * models (see the greenhouse-simulator skill, mechanics.md) and from the plot script's own KNOBS,
 * which are read out of the shipped script rather than copied here.
 */
import type { FlowsFile } from "./flow";

export interface ScriptKnobs {
  /** Magic Jellybeans are broken at this stage or later. */
  jellyStage: number;
  /** All-in Aloe is broken at this stage or later (or earlier when that already covers the goal). */
  aloeStage: number;
}

const DEFAULT_KNOBS: ScriptKnobs = { jellyStage: 12, aloeStage: 10 };

/** Read `const KNOBS = {...};` from the first plot script, falling back to the shipped values. */
export function scriptKnobs(flow: FlowsFile): ScriptKnobs {
  const source = flow.plots[0]?.script?.source ?? "";
  const match = /^const KNOBS = (\{.*\});\s*$/m.exec(source);
  if (!match) return DEFAULT_KNOBS;
  try {
    const raw = JSON.parse(match[1]) as Partial<Record<keyof ScriptKnobs, unknown>>;
    return {
      jellyStage: typeof raw.jellyStage === "number" ? raw.jellyStage : DEFAULT_KNOBS.jellyStage,
      aloeStage: typeof raw.aloeStage === "number" ? raw.aloeStage : DEFAULT_KNOBS.aloeStage,
    };
  } catch {
    return DEFAULT_KNOBS;
  }
}

/** Tips for a farm, from what its target cells grow and what it places. */
export function farmTips(products: string[], placed: string[], knobs: ScriptKnobs): string[] {
  const has = (id: string) => products.includes(id);
  const uses = (id: string) => placed.includes(id);
  const tips: string[] = [];
  if (has("magic_jellybean"))
    tips.push(`Break Magic Jellybeans once they reach stage ${knobs.jellyStage} or higher. Don't wait for stage 120: the plan never needs it.`);
  if (has("all_in_aloe"))
    tips.push(
      `Break All-in Aloe at stage ${knobs.aloeStage} or higher. Each harvest drops fragments, and 9 fragments make 1 All-in Aloe, so enter your fragments under What you own.`
    );
  if (has("shellfruit") || (uses("blastberry") && uses("turtlellini")))
    tips.push(
      "Wait until every placed Blastberry is primed (one cycle after placing). Then break the Blastberries: each Turtlellini caught in two blasts becomes a Shellfruit you can harvest."
    );
  if (has("devourer"))
    tips.push(
      "While the Devourer is growing, don't replace its ring inputs. Break its roots each visit, because a root destroys whatever stands next to it."
    );
  if (has("glasscorn")) tips.push("Harvest Glasscorn at stage 7 or 8. After stage 8 it resets to stage 1.");
  if (has("snoozling")) tips.push("Wake any sleeping Snoozling. They fall asleep at stages 5, 10 and 15 and stop growing until you do.");
  if (has("thunderling")) tips.push("Discharge Thunderlings every visit. At stage 9 (16,000 charge) they stop growing until you do.");
  if (has("zombud")) tips.push("Before harvesting a Zombud, fill its empty ring cells with Dead Plants. Each Dead Plant there becomes one more Zombud.");
  if (has("chorus_fruit"))
    tips.push("Chorus Fruit teleports every stage while it grows, turning the cells it lands on into End Stone. Harvest it once it's fully grown.");
  if (has("cheesebite")) tips.push("Vacuum the rats on Cheesebites (they appear at stages 4 and 7 and stop growth).");
  if (has("noctilume")) tips.push("Change the time of day each visit so Noctilumes keep growing.");
  if (has("fleshtrap")) tips.push("Feed Fleshtraps every visit; they only grow while fed.");
  if (has("soggybud")) tips.push("Soggybuds drink from watered neighbours. Keep the crops around them watered.");
  if (has("timestalk") || has("phantomleaf")) tips.push("Harvest Phantomleaf and Timestalk as soon as they're fully grown; they're goal items.");
  return tips;
}

/** Tips that apply on every visit, whatever the farm. */
export const GENERAL_TIPS = [
  "Water everything each visit. Dried-out plants stop growing and stop counting as inputs.",
  "Harvest fully grown targets, and clear any Dead Plants that aren't part of the layout.",
];

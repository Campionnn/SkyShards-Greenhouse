import { useMemo, useState } from "react";
import { applyRules, ruleDifferences, type RuleKind } from "../../../leaderboard/rules";
import { nearestEvery } from "../../../leaderboard/tiers";
import { profileRuleKind, ruleDifferenceLines } from "../../../leaderboard/view";
import { CONFIG_META, type ProfileMode, type Scenario } from "../../../simulator";

// The leaderboard rules for the board the site's Ironman / Normal switch is on: what differs from
// the server's set-up, and applying it. Shared by the command bar's Rules chip and the Leaderboard tab.

const CONFIG_LABELS: Record<string, string> = Object.fromEntries(CONFIG_META.map((m) => [m.key, m.label]));

export interface LeaderboardRules {
  kind: RuleKind;
  /** "Ironman" | "Normal" */
  board: string;
  /** Human-readable differences from the board's set-up; empty = under the rules. */
  differences: string[];
  on: boolean;
  /** Online every N cycles to apply with (defaults to the scenario's own, snapped to the board's frequencies). */
  every: number;
  setEvery: (n: number) => void;
  /** Apply the rules (max stats, defaults, empty start, online every N, a new random seed); returns the scenario before, for Undo. */
  apply: () => Scenario;
}

export function useLeaderboardRules(scenario: Scenario, onChange: (sc: Scenario) => void, profile: ProfileMode): LeaderboardRules {
  const kind = profileRuleKind(profile);
  const board = kind === "normal" ? "Normal" : "Ironman";
  const { settings } = scenario;
  const differences = useMemo(() => {
    // The profile is site-wide (not in the scenario), so diff with the board's profile set.
    const withProfile: Scenario = { ...scenario, settings: { ...settings } };
    if (kind === "normal") withProfile.settings.profile = "normal";
    else delete withProfile.settings.profile;
    return ruleDifferenceLines(ruleDifferences(withProfile, kind), CONFIG_LABELS);
  }, [scenario, settings, kind]);
  const [every, setEvery] = useState<number>(settings.activity.kind === "everyN" ? nearestEvery(settings.activity.n) : 1);
  const apply = () => {
    const before = scenario;
    const ruled = applyRules(scenario, kind, every, Math.floor(Math.random() * 2 ** 31));
    const next: Scenario = { ...ruled, settings: { ...ruled.settings } };
    if (settings.profile) next.settings.profile = settings.profile;
    else delete next.settings.profile;
    onChange(next);
    return before;
  };
  return { kind, board, differences, on: differences.length === 0, every, setEvery, apply };
}

import { useCallback, useEffect, useRef, useState } from "react";
import { submissionFromScenario } from "../../leaderboard/rules";
import type { Scenario } from "../../simulator";
import { useToast } from "../ui";

/**
 * The simulator's "Watch from nothing": the two parts of the Ironman board's main number, run in
 * the simulator as a preview. The user's own flows are never replaced or saved over: the page runs
 * `previewScenarioOf(preview)` instead of the user's scenario until they go back.
 */
export interface FromNothingPreview {
  /** The starting items (whole units) the flow needs, from a borrow run. */
  kit: Record<string, number>;
  every: number;
  part: "builder" | "flow";
  /** Part 1: the site's builder from an empty inventory; null when the flow needs no starting items. */
  builder: Scenario | null;
  /** Part 2: the user's flow, strict ironman, starting with exactly the kit. */
  flow: Scenario;
}

/** The scenario the preview runs now. */
export const previewScenarioOf = (p: FromNothingPreview): Scenario => (p.part === "builder" && p.builder ? p.builder : p.flow);

/** The preview with the running part's seed changed. */
export function withPreviewSeed(p: FromNothingPreview, seed: number): FromNothingPreview {
  const sc = previewScenarioOf(p);
  const next = { ...sc, settings: { ...sc.settings, seed } };
  return p.part === "builder" && p.builder ? { ...p, builder: next } : { ...p, flow: next };
}

/**
 * The page's preview state. `start(every)` finds the scenario's starting items (a borrow run in a
 * worker, a few seconds; `preparing` is its progress) and opens the preview on the builder part.
 */
export function useFromNothingPreview(scenario: Scenario) {
  const { toast } = useToast();
  const [preview, setPreview] = useState<FromNothingPreview | null>(null);
  const [preparing, setPreparing] = useState<number | null>(null);
  // The latest request; older ones (cancelled, or superseded) are ignored when they finish.
  const request = useRef(0);

  const start = useCallback(
    async (every: number) => {
      const id = ++request.current;
      setPreparing(0);
      try {
        // Lazy: the builder flow is a big file the simulator otherwise never needs.
        const { fromNothingParts } = await import("../../leaderboard/worker/builderImport");
        const parts = await fromNothingParts(scenario, submissionFromScenario(scenario), every, (f) => {
          if (id === request.current) setPreparing(f);
        });
        if (id !== request.current) return;
        setPreview({ kit: parts.kit, every, part: parts.builder ? "builder" : "flow", builder: parts.builder, flow: parts.flow });
      } catch (e) {
        if (id === request.current) toast({ title: "Could not find the starting items", description: e instanceof Error ? e.message : String(e), variant: "error" });
      } finally {
        if (id === request.current) setPreparing(null);
      }
    },
    [scenario, toast]
  );

  /** Stop: cancels a request in progress and leaves the preview. */
  const exit = useCallback(() => {
    request.current++;
    setPreparing(null);
    setPreview(null);
  }, []);

  // Editing the user's own scenario (or loading another) ends the preview: it was made from the old one.
  const shown = useRef(scenario);
  useEffect(() => {
    if (shown.current === scenario) return;
    shown.current = scenario;
    exit();
  }, [scenario, exit]);

  return { preview, setPreview, preparing, start, exit };
}

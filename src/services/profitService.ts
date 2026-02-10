// =============================================================================
// Profit Service
// =============================================================================
// API client for the /profit endpoints. Provides mutation profit ranking
// and layout profit calculation.

const API_BASE = import.meta.env.DEV ? "/api" : "https://api.skyshards.com";

// =============================================================================
// Types
// =============================================================================

export interface ProfitParams {
  desk_growth_level: number; // 0-9 (5% growth speed per level)
  desk_yield_level: number;  // 0-9 (levels 1-8: 2% yield, level 9: 4% yield)
  unique_crop_count: number; // 1-12 (5% growth speed + 3% yield per unique)
  farming_fortune: number;   // >= 0
  evergreen: number;         // 0-0.6
  bioanalysis_talisman: number; // 0, 0.05, 0.10, 0.15 (multiplies mutation_chance)
  missed_stages_per_day: number; // 0-12 (reduces efficiency of instant mutations)
}

export interface MutationProfitResult {
  mutation_id: string;
  mutation_name: string;
  rarity: string;
  growth_stages: number;
  decay_hours: number;
  mutation_chance: number;
  success_probability: number;
  hours_per_cycle: number;
  drops: Record<string, number>;
  drop_value_per_harvest: number;
  effective_drops_multiplier: number;
  coins_per_day_single: number;
  optimal_count: number;
  coins_per_day_grid: number;
  has_improved_harvest: boolean;
  requirement_chain: string[];
  growing_info: string | null;
  harvest_info: string | null;
}

export interface OptimalProfitResponse {
  mutations: MutationProfitResult[];
  params_used: ProfitParams;
}

export interface LayoutProfitResponse {
  total_coins_per_day: number;
  mutations: MutationProfitResult[];
  params_used: ProfitParams;
}

// =============================================================================
// Default Parameters
// =============================================================================

export const DEFAULT_PROFIT_PARAMS: ProfitParams = {
  desk_growth_level: 0,
  desk_yield_level: 0,
  unique_crop_count: 1,
  farming_fortune: 0,
  evergreen: 0,
  bioanalysis_talisman: 0,
  missed_stages_per_day: 0,
};

// =============================================================================
// API Functions
// =============================================================================

/**
 * Fetch optimal profit ranking for all mutations.
 * Uses dense packing solver to determine max mutations per 10x10 grid.
 * First call may be slow (~6 min) as packing counts are computed and cached.
 */
export async function fetchOptimalProfits(
  params: ProfitParams,
  abortSignal?: AbortSignal
): Promise<OptimalProfitResponse> {
  const response = await fetch(`${API_BASE}/profit/optimal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ params }),
    signal: abortSignal,
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || `Failed to fetch profits: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Calculate profit for a specific layout (mutation counts).
 */
export async function fetchLayoutProfit(
  params: ProfitParams,
  mutationCounts: Record<string, number>,
  abortSignal?: AbortSignal
): Promise<LayoutProfitResponse> {
  const response = await fetch(`${API_BASE}/profit/layout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      params,
      mutation_counts: mutationCounts,
    }),
    signal: abortSignal,
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || `Failed to calculate layout profit: ${response.statusText}`);
  }

  return response.json();
}

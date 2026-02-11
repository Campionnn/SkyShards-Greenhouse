import React, { useState, useCallback, useRef, useMemo } from "react";
import { TrendingUp, Loader2, AlertCircle, ChevronDown, ChevronUp, Info } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { fetchOptimalProfits, DEFAULT_PROFIT_PARAMS } from "../services/profitService";
import type { ProfitParams, MutationProfitResult } from "../services/profitService";

// =============================================================================
// Constants
// =============================================================================

const RARITY_COLORS: Record<string, string> = {
  common: "text-slate-300",
  uncommon: "text-green-400",
  rare: "text-blue-400",
  epic: "text-purple-400",
  legendary: "text-amber-400",
};

const RARITY_BG: Record<string, string> = {
  common: "bg-slate-500/20 border-slate-500/30",
  uncommon: "bg-green-500/20 border-green-500/30",
  rare: "bg-blue-500/20 border-blue-500/30",
  epic: "bg-purple-500/20 border-purple-500/30",
  legendary: "bg-amber-500/20 border-amber-500/30",
};

type SortField = "coins_per_day_grid" | "coins_per_day_single" | "drop_value_per_harvest" | "hours_per_cycle" | "optimal_count" | "rarity";
type SortDirection = "asc" | "desc";

const RARITY_ORDER: Record<string, number> = {
  common: 0,
  uncommon: 1,
  rare: 2,
  epic: 3,
  legendary: 4,
};

// =============================================================================
// Parameter Input Component
// =============================================================================

interface ParamInputProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  description: string;
  isFloat?: boolean;
}

const ParamInput: React.FC<ParamInputProps> = ({
  label,
  value,
  onChange,
  min,
  max,
  step,
  description,
  isFloat = false,
}) => {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-slate-300">{label}</label>
        <span className="text-xs text-slate-500">{description}</span>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(isFloat ? parseFloat(e.target.value) : parseInt(e.target.value, 10))}
          className="flex-1 h-1.5 bg-slate-700 rounded-full appearance-none cursor-pointer accent-emerald-500"
        />
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={isFloat ? value.toFixed(step < 0.1 ? 2 : 1) : value}
          onChange={(e) => {
            const v = isFloat ? parseFloat(e.target.value) : parseInt(e.target.value, 10);
            if (!isNaN(v) && v >= min && v <= max) onChange(v);
          }}
          className="w-16 px-2 py-1 text-xs text-center bg-slate-800 border border-slate-600/50 rounded text-slate-200 focus:outline-none focus:border-emerald-500/50"
        />
      </div>
    </div>
  );
};

// =============================================================================
// Sort Header Component
// =============================================================================

interface SortHeaderProps {
  label: string;
  field: SortField;
  currentSort: SortField;
  currentDirection: SortDirection;
  onSort: (field: SortField) => void;
  className?: string;
}

const SortHeader: React.FC<SortHeaderProps> = ({
  label,
  field,
  currentSort,
  currentDirection,
  onSort,
  className = "",
}) => {
  const isActive = currentSort === field;
  return (
    <button
      onClick={() => onSort(field)}
      className={`flex items-center gap-0.5 text-xs font-medium cursor-pointer hover:text-emerald-300 transition-colors ${
        isActive ? "text-emerald-400" : "text-slate-400"
      } ${className}`}
    >
      <span>{label}</span>
      {isActive && (
        currentDirection === "desc"
          ? <ChevronDown className="w-3 h-3" />
          : <ChevronUp className="w-3 h-3" />
      )}
    </button>
  );
};

// =============================================================================
// Mutation Row Component
// =============================================================================

interface MutationRowProps {
  mutation: MutationProfitResult;
  rank: number;
}

const MutationRow: React.FC<MutationRowProps> = ({ mutation, rank }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const rarityColor = RARITY_COLORS[mutation.rarity] || "text-slate-300";
  const rarityBg = RARITY_BG[mutation.rarity] || "bg-slate-500/20 border-slate-500/30";

  return (
    <>
      <tr
        onClick={() => setIsExpanded(!isExpanded)}
        className="border-b border-slate-700/50 hover:bg-slate-800/50 cursor-pointer transition-colors"
      >
        <td className="px-3 py-2 text-xs text-slate-500 text-center">{rank}</td>
        <td className="px-3 py-2">
          <span className={`text-sm font-medium ${rarityColor}`}>
            {mutation.mutation_name}
          </span>
        </td>
        <td className="px-3 py-2 text-center">
          <span className={`text-xs px-1.5 py-0.5 rounded border ${rarityBg} ${rarityColor}`}>
            {mutation.rarity}
          </span>
        </td>
        <td className="px-3 py-2 text-xs text-slate-300 text-center">{mutation.growth_stages}</td>
        <td className="px-3 py-2 text-xs text-slate-300 text-right">{mutation.hours_per_cycle.toFixed(2)}h</td>
        <td className="px-3 py-2 text-xs text-slate-300 text-right">{formatCoins(mutation.drop_value_per_harvest)}</td>
        <td className="px-3 py-2 text-xs text-emerald-400 text-right font-medium">{formatCoins(mutation.coins_per_day_single)}</td>
        <td className="px-3 py-2 text-xs text-slate-300 text-center">{mutation.optimal_count}</td>
        <td className="px-3 py-2 text-right">
          <span className="text-sm font-bold text-emerald-300">{formatCoins(mutation.coins_per_day_grid)}</span>
        </td>
        <td className="px-3 py-2 text-center">
          {isExpanded
            ? <ChevronUp className="w-3.5 h-3.5 text-slate-500 inline" />
            : <ChevronDown className="w-3.5 h-3.5 text-slate-500 inline" />
          }
        </td>
      </tr>
      <AnimatePresence>
        {isExpanded && (
          <tr>
            <td colSpan={10} className="p-0">
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="px-4 py-3 bg-slate-800/60 border-b border-slate-700/50">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div>
                      <span className="text-slate-500">Mutation Chance:</span>
                      <span className="ml-1 text-slate-300">{(mutation.mutation_chance * 100).toFixed(0)}%</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Decay:</span>
                      <span className="ml-1 text-slate-300">{mutation.decay_hours > 0 ? `${mutation.decay_hours}h` : "None"}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Drops Multiplier:</span>
                      <span className="ml-1 text-slate-300">{mutation.effective_drops_multiplier.toFixed(2)}x</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Improved Harvest:</span>
                      <span className={`ml-1 ${mutation.has_improved_harvest ? "text-green-400" : "text-slate-500"}`}>
                        {mutation.has_improved_harvest ? "Yes" : "No"}
                      </span>
                    </div>
                  </div>
                  {/* Drops breakdown */}
                  <div className="mt-2">
                    <span className="text-slate-500 text-xs">Drops: </span>
                    <span className="text-xs text-slate-300">
                      {Object.entries(mutation.drops)
                        .map(([cropId, count]) => `${formatCropName(cropId)} x${count}`)
                        .join(", ")}
                    </span>
                  </div>
                  {mutation.requirement_chain.length > 0 && (
                    <div className="mt-1">
                      <span className="text-slate-500 text-xs">Requires mutations: </span>
                      <span className="text-xs text-amber-300">
                        {mutation.requirement_chain.map(formatCropName).join(", ")}
                      </span>
                    </div>
                  )}
                  {mutation.growing_info && (
                    <div className="mt-1">
                      <span className="text-slate-500 text-xs">Growing: </span>
                      <span className="text-xs text-slate-300">{mutation.growing_info}</span>
                    </div>
                  )}
                  {mutation.harvest_info && (
                    <div className="mt-1">
                      <span className="text-slate-500 text-xs">Harvest: </span>
                      <span className="text-xs text-slate-300">{mutation.harvest_info}</span>
                    </div>
                  )}
                </div>
              </motion.div>
            </td>
          </tr>
        )}
      </AnimatePresence>
    </>
  );
};

// =============================================================================
// Helpers
// =============================================================================

function formatCoins(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(3)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(3)}K`;
  return value.toFixed(3);
}

function formatCropName(id: string): string {
  return id
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// =============================================================================
// Main Page Component
// =============================================================================

export const ProfitPage: React.FC = () => {
  // Parameters
  const [params, setParams] = useState<ProfitParams>({ ...DEFAULT_PROFIT_PARAMS });

  // Results
  const [mutations, setMutations] = useState<MutationProfitResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  // Sorting
  const [sortField, setSortField] = useState<SortField>("coins_per_day_grid");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  // Abort controller
  const abortRef = useRef<AbortController | null>(null);

  const updateParam = useCallback(<K extends keyof ProfitParams>(key: K, value: ProfitParams[K]) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleCalculate = useCallback(async () => {
    // Cancel any in-flight request
    if (abortRef.current) {
      abortRef.current.abort();
    }
    abortRef.current = new AbortController();

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetchOptimalProfits(params, abortRef.current.signal);
      setMutations(response.mutations);
      setHasLoaded(true);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to calculate profits");
    } finally {
      setIsLoading(false);
      abortRef.current = null;
    }
  }, [params]);

  const handleSort = useCallback((field: SortField) => {
    setSortField((prev) => {
      if (prev === field) {
        setSortDirection((d) => (d === "desc" ? "asc" : "desc"));
        return prev;
      }
      setSortDirection("desc");
      return field;
    });
  }, []);

  const sortedMutations = useMemo(() => {
    const sorted = [...mutations];
    sorted.sort((a, b) => {
      let aVal: number;
      let bVal: number;

      if (sortField === "rarity") {
        aVal = RARITY_ORDER[a.rarity] ?? 0;
        bVal = RARITY_ORDER[b.rarity] ?? 0;
      } else {
        aVal = a[sortField];
        bVal = b[sortField];
      }

      return sortDirection === "desc" ? bVal - aVal : aVal - bVal;
    });
    return sorted;
  }, [mutations, sortField, sortDirection]);

  return (
    <div className="container mx-auto px-2 sm:px-4 py-4 sm:py-6 max-w-screen-xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-emerald-500/20 border border-emerald-500/20 rounded-lg flex items-center justify-center">
          <TrendingUp className="w-5 h-5 text-emerald-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-100">Profit Calculator</h1>
          <p className="text-xs text-slate-400">Rank mutations by expected coins/day on a full 10x10 grid</p>
        </div>
      </div>

      {/* Parameters Panel */}
      <div className="bg-slate-800/40 border border-slate-600/30 rounded-lg p-4 mb-4">
        <h2 className="text-sm font-medium text-slate-200 mb-3">Greenhouse Parameters</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <ParamInput
            label="Desk Growth Level"
            value={params.desk_growth_level}
            onChange={(v) => updateParam("desk_growth_level", v)}
            min={0}
            max={9}
            step={1}
            description="0-9 (5%/level, +10% at 9)"
          />
          <ParamInput
            label="Desk Yield Level"
            value={params.desk_yield_level}
            onChange={(v) => updateParam("desk_yield_level", v)}
            min={0}
            max={9}
            step={1}
            description="0-9 (2%/level, +4% at 9)"
          />
          <ParamInput
            label="Unique Crops"
            value={params.unique_crop_count}
            onChange={(v) => updateParam("unique_crop_count", v)}
            min={0}
            max={12}
            step={1}
            description="1-12"
          />
          <ParamInput
            label="Farming Fortune"
            value={params.farming_fortune}
            onChange={(v) => updateParam("farming_fortune", v)}
            min={0}
            max={3000}
            step={10}
            description="0+"
          />
          <ParamInput
            label="Evergreen"
            value={params.evergreen}
            onChange={(v) => updateParam("evergreen", v)}
            min={0}
            max={0.6}
            step={0.1}
            description="0-0.6"
            isFloat
          />
          <ParamInput
            label="Bioanalysis Talisman"
            value={params.bioanalysis_talisman * 100}
            onChange={(v) => updateParam("bioanalysis_talisman", v / 100)}
            min={0}
            max={15}
            step={5}
            description="0%, 5%, 10%, or 15%"
            isFloat
          />
          <ParamInput
            label="Missed Stages/Day"
            value={params.missed_stages_per_day}
            onChange={(v) => updateParam("missed_stages_per_day", v)}
            min={0}
            max={12}
            step={1}
            description="0-12"
          />
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={handleCalculate}
            disabled={isLoading}
            className="px-5 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors duration-200 flex items-center gap-2 cursor-pointer"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Calculating...</span>
              </>
            ) : (
              <>
                <TrendingUp className="w-4 h-4" />
                <span>Calculate Profits</span>
              </>
            )}
          </button>
          {isLoading && (
            <span className="text-xs text-slate-500">
              First load may take a few minutes while packing counts are computed...
            </span>
          )}
        </div>
      </div>

      {/* Info Banner */}
      {!hasLoaded && !isLoading && (
        <div className="bg-slate-800/40 border border-slate-600/30 rounded-lg p-4 flex items-start gap-3">
          <Info className="w-5 h-5 text-slate-400 mt-0.5 shrink-0" />
          <div className="text-xs text-slate-400 space-y-1">
            <p>Configure your greenhouse parameters above and click <strong className="text-slate-300">Calculate Profits</strong> to rank all mutations by expected coins/day.</p>
            <p>The calculator uses the CP-SAT solver to determine how many of each mutation fit in an optimal 10x10 grid, then computes coins/day based on growth speed, drop values, and yield bonuses.</p>
            <p className="text-amber-400/80">The first calculation may take several minutes while dense packing counts are computed. Results are cached server-side after that.</p>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-4 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <span className="text-sm text-red-300">{error}</span>
        </div>
      )}

      {/* Results Table */}
      {hasLoaded && mutations.length > 0 && (
        <div className="bg-slate-800/40 border border-slate-600/30 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-700 bg-slate-800/60">
                  <th className="px-3 py-2 text-xs text-slate-500 text-center w-10">#</th>
                  <th className="px-3 py-2 text-left">
                    <span className="text-xs font-medium text-slate-400">Mutation</span>
                  </th>
                  <th className="px-3 py-2 text-center">
                    <SortHeader label="Rarity" field="rarity" currentSort={sortField} currentDirection={sortDirection} onSort={handleSort} className="justify-center" />
                  </th>
                  <th className="px-3 py-2 text-center">
                    <span className="text-xs font-medium text-slate-400">Stages</span>
                  </th>
                  <th className="px-3 py-2 text-right">
                    <SortHeader label="Cycle" field="hours_per_cycle" currentSort={sortField} currentDirection={sortDirection} onSort={handleSort} className="justify-end" />
                  </th>
                  <th className="px-3 py-2 text-right">
                    <SortHeader label="Harvest" field="drop_value_per_harvest" currentSort={sortField} currentDirection={sortDirection} onSort={handleSort} className="justify-end" />
                  </th>
                  <th className="px-3 py-2 text-right">
                    <SortHeader label="Coins/Day" field="coins_per_day_single" currentSort={sortField} currentDirection={sortDirection} onSort={handleSort} className="justify-end" />
                  </th>
                  <th className="px-3 py-2 text-center">
                    <SortHeader label="Count" field="optimal_count" currentSort={sortField} currentDirection={sortDirection} onSort={handleSort} className="justify-center" />
                  </th>
                  <th className="px-3 py-2 text-right">
                    <SortHeader label="Grid/Day" field="coins_per_day_grid" currentSort={sortField} currentDirection={sortDirection} onSort={handleSort} className="justify-end" />
                  </th>
                  <th className="px-3 py-2 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {sortedMutations.map((mutation, index) => (
                  <MutationRow
                    key={mutation.mutation_id}
                    mutation={mutation}
                    rank={index + 1}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Summary Footer */}
          <div className="border-t border-slate-700 bg-slate-800/60 px-4 py-3 flex items-center justify-between">
            <span className="text-xs text-slate-400">{mutations.length} mutations ranked</span>
            <div className="text-xs text-slate-400">
              <span>Best single-mutation grid: </span>
              <span className="text-emerald-300 font-bold">
                {formatCoins(mutations[0]?.coins_per_day_grid ?? 0)} coins/day
              </span>
              <span className="ml-1 text-slate-500">
                ({mutations[0]?.mutation_name})
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="bg-slate-800/40 border border-slate-600/30 rounded-lg p-8 flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
          <span className="text-sm text-slate-300">Computing optimal packing & profit rankings...</span>
          <span className="text-xs text-slate-500">This may take a few minutes on first load</span>
        </div>
      )}
    </div>
  );
};

export interface CropDefinition {
  id: string; // API key and image file name
  name: string;
  size: number;
  priority: number;
  ground: string; // farmland, sand, soul_sand, mycelium, netherrack or end_stone
  growth_stages: number | null;
  positive_buffs: string[];
  negative_buffs: string[];
  drops: Record<string, number>;
  isMutation?: boolean;
}

export interface MutationRequirement {
  crop: string; // crop id
  count: number;
}

export interface MutationDefinition {
  id: string; // API key and image file name
  name: string;
  size: number;
  ground: string;
  requirements: MutationRequirement[];
  special?: string; // special spawn condition
  rarity: string;
  growth_stages: number;
  positive_buffs: string[];
  negative_buffs: string[];
  drops: Record<string, number>;
  requires_watering: boolean;
}

export interface MutationGoal {
  mutation: string;
  maximize: boolean;
  count: number | null;
  // Per-target override of the request effect weights, merged key by key.
  effect_weights?: Record<string, number>;
}

// A pre-placed crop or mutation.
export interface LockDefinition {
  name: string; // crop or mutation id
  size: number;
  position: [number, number];
}

export interface SolveRequest {
  cells: [number, number][];
  targets: MutationGoal[];
  priorities?: Record<string, number>;
  locks?: LockDefinition[];
  // Value of each effect on a spawned target, in plain mutation spots (0.5 = a
  // spot with this effect counts as 1.5). Negative effects take negative
  // weights; missing or 0 = ignored.
  effect_weights?: Record<string, number>;
  // Plants the solver may place as effect sources (default: every base crop
  // with buffs). Used only when effect_weights is set.
  buff_crops?: string[];
  // Minimum distinct crop groups on the grid (0-12).
  unique_crops?: number;
  // Solver time budget in seconds; the public API ignores it.
  time_limit?: number;
}

export interface CropPlacement {
  crop: string;
  position: [number, number];
  size: number;
  locked?: boolean;
}

export interface MutationResult {
  mutation: string;
  position: [number, number];
  size: number;
  // Effects held once spawned here, after immunity and improved-override rules.
  effects?: string[];
  // Contribution to the score: spawn rate plus weighted effect value.
  value?: number;
}

export interface SolveResponse {
  status: string;
  total_cells_used?: number;
  placements: CropPlacement[];
  mutations: MutationResult[];
  cache_hit?: string;
  // Seconds the solver was given; absent when answered from the cache.
  time_limit?: number | null;
  // Objective: expected spawns/tick of maximize targets plus weighted effect
  // value over all target spots.
  score?: number;
  effect_value?: number;
  expected_spawns_per_tick?: number;
  // Effect weights used, resolved per target mutation.
  effect_weights?: Record<string, Record<string, number>>;
  // Buff-source crops the solver could place.
  buff_crops?: string[];
  unique_crops?: { requested: number; target: number; achieved: number; crops: string[] };
  // Debug statistics; not displayed.
  effect_model_stats?: Record<string, unknown>;
}

/**
 * Result statuses the API can return:
 * - OPTIMAL: CP-SAT proved no better layout exists
 * - FEASIBLE: a valid layout, but the time budget ran out before it could be proven best
 * - CANCELLED: the user stopped the solve; best layout found so far
 * - SOLVING: frontend-only, a live preview while the job runs
 */
export type SolveResultStatus = "OPTIMAL" | "FEASIBLE" | "CANCELLED" | "SOLVING";

/**
 * cache_hit values:
 * - exact_optimal: this exact setup was already proven optimal; returned instantly
 * - resume_stopped: earlier solves stopped improving; saved best returned instantly
 * - resume: continued from an earlier solve of this exact setup
 * - warm_start: seeded with a saved layout for a similar setup
 * - priority_variant: reused limits proven for the same setup with other priorities
 */
export type CacheHitKind = "exact_optimal" | "resume_stopped" | "resume" | "warm_start" | "priority_variant";

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface JobProgress {
  phase: string;
  percentage: number | null;
  solutions_found: number;
  best_objective: number | null;
  best_bound: number | null;
  current_activity: string;
  elapsed_seconds: number;
  // Current best solution, for live preview.
  preview_placements: CropPlacement[] | null;
  preview_mutations: MutationResult[] | null;
  preview_cells_used: number | null;
  // Absent from older API versions.
  time_limit_seconds?: number | null;
  // Decoded objective; absent from older API and local solver versions.
  // Lexicographic: score, then fewer priority points, then fewer cells.
  stage?: "maximizing" | "tie_breaking" | null;
  tie_break?: "priority" | "cells" | null;
  has_score?: boolean | null;
  has_priority?: boolean | null;
  best_score?: number | null;
  score_bound?: number | null;
  best_priority?: number | null;
  best_cells?: number | null;
  best_mutations?: number | null;
}

export interface JobSubmitRequest {
  type: "greenhouse" | "greenhouse_expansion";
  params: Record<string, unknown>;
}

export interface JobSubmitResponse {
  job_id: string;
  status: string;
  message: string;
}

export interface JobStatusResponse {
  id: string;
  status: JobStatus;
  request_type?: string;
  request_params?: Record<string, unknown>;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  progress: JobProgress | null;
  queue_position: number | null;
  result: SolveResponse | null;
  error: string | null;
}

export interface ExpansionRequest {
  unlocked_cells: [number, number][];
  locked_cells: [number, number][];
}

export interface ExpansionStep {
  order: number;
  cell: [number, number];
  gloomgourd_potential: number;
  gloomgourd_gain: number;
}

export interface ExpansionResponse {
  steps: ExpansionStep[];
  total_steps: number;
  final_gloomgourd_count: number;
}

export type CellState = "locked" | "unlocked";

export interface GridCell {
  row: number;
  col: number;
  state: CellState;
}

export interface SelectedMutation {
  id: string; // mutation id
  name: string;
  mode: "maximize" | "target";
  targetCount: number;
}

export interface SolverState {
  isLoading: boolean;
  error: string | null;
  result: SolveResponse | null;
}

export interface ExpansionState {
  isLoading: boolean;
  error: string | null;
  steps: ExpansionStep[];
  showOverlay: boolean;
}

export interface LockedPlacement {
  id: string; // unique per placement
  crop: string; // crop or mutation id, e.g. "pumpkin"
  position: [number, number];
  size: number;
  ground: string;
}

export type CropFilterCategory =
  | "all"
  | "crops"
  | "mutations"
  | "common"
  | "uncommon"
  | "rare"
  | "epic"
  | "legendary";

export interface SelectedCropForPlacement {
  id: string;
  name: string;
  size: number;
  ground: string;
}

export function getCropImagePath(cropId: string): string {
  return `/greenhouse/crops/${cropId}.png`;
}

export function getGroundImagePath(groundType: string): string {
  return `/greenhouse/ground/${groundType}.png`;
}

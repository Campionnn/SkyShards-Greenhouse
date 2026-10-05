/** Event marks drawn on the grid for the last simulated cycle. */
export type Mark =
  | "harvested"
  | "spawned"
  | "decayed"
  | "extended"
  | "dried"
  | "destroyed"
  | "debt"
  | "borrowed"
  | "teleported"
  | "exploded"
  | "groundFixed";

/** Sandy tint for a dried-out (halted) plant, distinct from a Dead Plant's grey. */
export const DRY_FILTER = "sepia(0.85) saturate(0.6) brightness(0.8)";

export const MARK_STYLE: Record<Mark, { ring: string; glyph: string; color: string; label: string }> = {
  harvested: { ring: "rgba(234,179,8,0.9)", glyph: "✦", color: "text-yellow-300", label: "harvested" },
  spawned: { ring: "rgba(52,211,153,0.9)", glyph: "+", color: "text-emerald-300", label: "spawned" },
  decayed: { ring: "rgba(248,113,113,0.9)", glyph: "✕", color: "text-red-300", label: "decayed" },
  extended: { ring: "rgba(129,140,248,0.9)", glyph: "⧗", color: "text-indigo-300", label: "decay timer extended (minimum mutations not met)" },
  dried: { ring: "rgba(217,119,6,0.95)", glyph: "◌", color: "text-amber-500", label: "dried out (halted until watered)" },
  destroyed: { ring: "rgba(251,146,60,0.9)", glyph: "✕", color: "text-orange-300", label: "destroyed" },
  debt: { ring: "rgba(239,68,68,0.95)", glyph: "!", color: "text-red-400", label: "short of an item" },
  borrowed: { ring: "rgba(244,114,182,0.9)", glyph: "−", color: "text-pink-300", label: "placed on mutation debt (no stock)" },
  teleported: { ring: "rgba(192,132,252,0.9)", glyph: "»", color: "text-purple-300", label: "teleported here" },
  exploded: { ring: "rgba(244,63,94,0.95)", glyph: "✹", color: "text-rose-400", label: "exploded" },
  groundFixed: { ring: "rgba(163,230,53,0.9)", glyph: "▦", color: "text-lime-300", label: "ground fixed" },
};

/** Non-event grid indicators: slot outlines, plant borders, tints and badges. Key order is the legend order. */
export const INDICATOR_LABEL = {
  slotReady: "empty checked target (cyan: ready or not yet evaluated)",
  slotBlocked: "checked target blocked by something else",
  slotRequirements: "checked target without its requirements (not sustainable)",
  halted: "checked target standing there dried out (halted: downtime, still sustainable)",
  slotUnchecked: "target not checked",
  missing: "missing - no stock to re-place",
  spawn: "natural spawn",
  rival: "rival",
  root: "devourer root",
  growing: "still growing (bar = progress)",
  dead: "dead plant",
  dry: "dried out - halted until watered",
  sleepy: "asleep / rat present / overcharged",
  primed: "blastberry primed",
  unmet: "target requirements unmet",
} as const;

export type Indicator = keyof typeof INDICATOR_LABEL;

/** One icon shown on a hovered grid element; `label` overrides the legend text with something more specific. */
export type GridMarker = { mark: Mark; label?: string } | { indicator: Indicator; label?: string };

// Display helpers shared by the wiki page and the info modal.

export function formatName(name: string): string {
  return name
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// Minimum mutations: a number, "infinite" (never decays), or null (N/A: timer-only).
export function formatMinimumMutations(value: number | "infinite" | null): string {
  if (value === "infinite") return "Infinite";
  if (value === null) return "None";
  return String(value);
}

export function formatRarity(rarity: string): string {
  return rarity.charAt(0).toUpperCase() + rarity.slice(1);
}

export function getRarityColor(rarity: string | null | undefined): string {
  switch (rarity?.toLowerCase()) {
    case "uncommon":
      return "text-green-400";
    case "rare":
      return "text-blue-400";
    case "epic":
      return "text-purple-400";
    case "legendary":
      return "text-yellow-400";
    default:
      return "text-slate-300";
  }
}

export function getRarityBgColor(rarity: string | null | undefined): string {
  switch (rarity?.toLowerCase()) {
    case "uncommon":
      return "bg-green-500/20 border-green-500/30";
    case "rare":
      return "bg-blue-500/20 border-blue-500/30";
    case "epic":
      return "bg-purple-500/20 border-purple-500/30";
    case "legendary":
      return "bg-yellow-500/20 border-yellow-500/30";
    default:
      return "bg-slate-500/20 border-slate-500/30";
  }
}

// The four surfaces (docs/design-system/foundations.md "Surfaces"). Built on the semantic tokens in
// index.css @theme, so a palette change re-skins them without touching this file.
// panel = docked side panels and bars, card = a self-contained block of results or settings,
// well = inputs and recessed areas, raised = anything floating (menus, popovers, canvas nodes).
export const surface = {
  panel: "bg-surface-panel border-line",
  card: "rounded-container bg-surface-card border border-line",
  well: "rounded-control bg-surface-well border border-line-control",
  raised: "rounded-container bg-surface-raised border border-line-strong shadow-raised backdrop-blur-md",
} as const;

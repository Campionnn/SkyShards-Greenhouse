import { extendTailwindMerge } from "tailwind-merge";

// Joins class names and resolves Tailwind conflicts so a caller's className wins over the kit's
// defaults (e.g. cn("text-fg-meta", "text-problem") → "text-problem"). It knows the design-system
// tokens in index.css @theme, so `text-body` (a size) and `text-fg-meta` (a colour) don't cancel out.
const merge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["label", "meta", "secondary", "body", "title", "hero"],
      radius: ["inner", "control", "container"],
      shadow: ["raised"],
    },
  },
});

export type ClassValue = string | false | null | undefined | 0;

export function cn(...classes: ClassValue[]): string {
  return merge(classes.filter(Boolean).join(" "));
}

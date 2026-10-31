import type { StatOption } from "./statFields";

/** One entry of a stat's select: a string value (the number as text, or "custom") and its label. */
export interface Choice {
  value: string;
  label: string;
}

export const CUSTOM = "custom";
export const same = (a: number, b: number) => Math.abs(a - b) < 1e-9;
export const shortNumber = (v: number) => String(Number(v.toFixed(4)));

/** The select's entries and the current one; a value that matches none gets a leading "Custom (x)" so it isn't silently changed. */
export function selectChoices(options: readonly StatOption[], value: number): { choices: Choice[]; current: string } {
  const match = options.find((o) => same(o.value, value));
  const choices = options.map((o) => ({ value: String(o.value), label: o.label }));
  return match ? { choices, current: String(match.value) } : { choices: [{ value: CUSTOM, label: `Custom (${shortNumber(value)})` }, ...choices], current: CUSTOM };
}

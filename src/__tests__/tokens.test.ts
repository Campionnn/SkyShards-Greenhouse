// Token contrast: every text and role colour in src/index.css @theme meets WCAG on every surface
// it is used on, computed from the real values (not from the names).
//
// How a token is resolved:
// - `var(--x)` is looked up in the palette being checked, then @theme, then Tailwind's own
//   node_modules/tailwindcss/theme.css (where --color-slate-*, --color-emerald-* … live);
// - `oklch()`, `oklab()`, hex, `rgb()`, `transparent`, `black`, `white` are parsed;
// - `color-mix(in oklab, A p%, B)` is mixed in Oklab with premultiplied alpha, as browsers do, so
//   `color-mix(in oklab, X 40%, transparent)` is X at 40% opacity;
// - translucent colours are composited (in sRGB, as browsers paint) over the backdrop they sit on:
//   a card over the page, a card over a panel, a hover fill over a card, and so on.
//
// Palettes are a parameter. The default palette is @theme itself; every `[data-palette="name"]`
// block found in src/index.css is checked too, with its declarations overriding @theme. A palette
// file elsewhere can be checked with `checkPalette(themeFrom(css, overrides))`.
// Same maths as research/design-audit-v2/system/data/contrast.mjs.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Vars = Map<string, string>;
/** sRGB 0..1 (gamma-encoded) + alpha. */
export interface Rgba { r: number; g: number; b: number; a: number }

// ---------- CSS parsing ----------
function declarations(body: string): Vars {
  const vars: Vars = new Map();
  const clean = body.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of clean.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)) vars.set(m[1], m[2].trim());
  return vars;
}

function blocks(css: string, selector: RegExp): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const re = /([^{};]+)\{([^{}]*)\}/g;
  for (const m of clean.matchAll(re)) if (selector.test(m[1].trim())) out.push({ selector: m[1].trim(), body: m[2] });
  return out;
}

const tailwindVars = declarations(readFileSync("node_modules/tailwindcss/theme.css", "utf8"));
const indexCss = readFileSync("src/index.css", "utf8");

/** The @theme tokens of a stylesheet, with optional overrides layered on top (a palette). */
export function themeFrom(css: string, overrides: Vars = new Map()): Vars {
  const theme: Vars = new Map();
  for (const b of blocks(css, /^@theme\b/)) for (const [k, v] of declarations(b.body)) theme.set(k, v);
  for (const [k, v] of overrides) theme.set(k, v);
  return theme;
}

/** Every `[data-palette="…"]` block in the stylesheet, as name → overrides. */
export function palettesIn(css: string): Map<string, Vars> {
  const out = new Map<string, Vars>();
  for (const b of blocks(css, /\[data-palette/)) {
    const name = b.selector.match(/\[data-palette\s*=\s*["']?([\w-]+)["']?\s*\]/)?.[1] ?? b.selector;
    const prev = out.get(name) ?? new Map();
    for (const [k, v] of declarations(b.body)) prev.set(k, v);
    out.set(name, prev);
  }
  return out;
}

// ---------- colour maths ----------
type Lab = [number, number, number];
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toGamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

function oklabToRgb([L, a, b]: Lab): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  const [r, g, bb] = lin.map((x) => toGamma(clamp01(x)));
  return [r, g, bb];
}
function rgbToOklab(r: number, g: number, b: number): Lab {
  const [lr, lg, lb] = [r, g, b].map(toLinear);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

/** Colour in Oklab + alpha: what color-mix(in oklab) works on. */
interface Okc { lab: Lab; a: number }
const num = (s: string, pctScale = 1) => (s.endsWith("%") ? (parseFloat(s) / 100) * pctScale : parseFloat(s));
const alphaOf = (s: string | undefined) => (s === undefined ? 1 : num(s));

function splitTop(s: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === sep && depth === 0) { parts.push(cur.trim()); cur = ""; } else cur += ch;
  }
  parts.push(cur.trim());
  return parts;
}

export function parseColour(value: string, lookup: (name: string) => string | undefined, depth = 0): Okc {
  const v = value.trim();
  if (depth > 20) throw new Error(`token cycle at ${v}`);
  const varM = v.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/);
  if (varM) {
    const found = lookup(varM[1]) ?? varM[2];
    if (found === undefined) throw new Error(`unknown token ${varM[1]}`);
    return parseColour(found, lookup, depth + 1);
  }
  if (v === "transparent") return { lab: [0, 0, 0], a: 0 };
  if (v === "black") return { lab: rgbToOklab(0, 0, 0), a: 1 };
  if (v === "white") return { lab: rgbToOklab(1, 1, 1), a: 1 };
  const hex = v.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join("");
    const n = [0, 2, 4, 6].map((i) => (i < h.length ? parseInt(h.slice(i, i + 2), 16) / 255 : 1));
    return { lab: rgbToOklab(n[0], n[1], n[2]), a: n[3] };
  }
  const fn = v.match(/^([a-z-]+)\((.*)\)$/is);
  if (!fn) throw new Error(`cannot parse colour "${v}"`);
  const [name, inner] = [fn[1].toLowerCase(), fn[2]];
  if (name === "color-mix") {
    const [space, ...rest] = splitTop(inner, ",");
    if (!/^in\s+oklab$/i.test(space)) throw new Error(`color-mix space "${space}" not supported (use in oklab)`);
    const items = rest.map((it) => {
      const pm = it.match(/^(.*?)(?:\s+([\d.]+%))?$/s)!;
      return { c: parseColour(pm[1], lookup, depth + 1), p: pm[2] ? parseFloat(pm[2]) / 100 : undefined };
    });
    const [x, y] = items;
    const px = x.p ?? (y.p !== undefined ? 1 - y.p : 0.5);
    const py = y.p ?? 1 - px;
    const sum = px + py;
    const [wx, wy] = [px / sum, py / sum];
    const a = x.c.a * wx + y.c.a * wy;
    const lab = (a === 0 ? [0, 0, 0] : [0, 1, 2].map((i) => (x.c.lab[i] * x.c.a * wx + y.c.lab[i] * y.c.a * wy) / a)) as Lab;
    return { lab, a: a * Math.min(1, sum) };
  }
  const [chan, alpha] = inner.split("/").map((s) => s.trim());
  const parts = chan.split(/[\s,]+/).filter(Boolean);
  if (name === "oklch") {
    const L = num(parts[0]), C = num(parts[1], 0.4), h = (parseFloat(parts[2]) * Math.PI) / 180;
    return { lab: [L, C * Math.cos(h), C * Math.sin(h)], a: alphaOf(alpha) };
  }
  if (name === "oklab") return { lab: [num(parts[0]), num(parts[1], 0.4), num(parts[2], 0.4)], a: alphaOf(alpha) };
  if (name === "rgb" || name === "rgba") {
    const [r, g, b] = parts.slice(0, 3).map((p) => (p.endsWith("%") ? parseFloat(p) / 100 : parseFloat(p) / 255));
    return { lab: rgbToOklab(r, g, b), a: alphaOf(alpha ?? parts[3]) };
  }
  throw new Error(`colour function ${name}() not supported`);
}

const toRgba = (c: Okc): Rgba => { const [r, g, b] = oklabToRgb(c.lab); return { r, g, b, a: c.a }; };
/** Paints `top` over an opaque `under` (sRGB, as the browser composites). */
export const over = (top: Rgba, under: Rgba): Rgba => ({
  r: top.r * top.a + under.r * (1 - top.a),
  g: top.g * top.a + under.g * (1 - top.a),
  b: top.b * top.a + under.b * (1 - top.a),
  a: 1,
});
const lum = (c: Rgba) => 0.2126 * toLinear(c.r) + 0.7152 * toLinear(c.g) + 0.0722 * toLinear(c.b);
export function contrast(fg: Rgba, bg: Rgba): number {
  const f = fg.a < 1 ? over(fg, bg) : fg;
  const [x, y] = [lum(f), lum(bg)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
export const hex = (c: Rgba) => "#" + [c.r, c.g, c.b].map((v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, "0")).join("");

// ---------- the checks ----------
export interface Pair { fg: string; bg: string; ratio: number; min: number; detail: string }

/** Resolves a palette's tokens and measures every pair the system promises. */
export function checkPalette(theme: Vars): Pair[] {
  const lookup = (n: string) => theme.get(n) ?? tailwindVars.get(n);
  const tok = (t: string) => toRgba(parseColour(`var(--color-${t})`, lookup));
  const page = tok("surface-page");
  if (page.a < 1) throw new Error("surface-page must be opaque");
  const panel = over(tok("surface-panel"), page);
  const card = over(tok("surface-card"), page);
  const backdrops: Record<string, Rgba> = {
    "surface-page": page,
    "surface-panel": panel,
    "surface-card (over page)": card,
    "surface-card (over panel)": over(tok("surface-card"), panel),
    "surface-raised (over page)": over(tok("surface-raised"), page),
    "surface-hover (over card)": over(tok("surface-hover"), card),
    "surface-hover (over raised)": over(tok("surface-hover"), over(tok("surface-raised"), page)),
  };
  const pairs: Pair[] = [];
  const add = (fg: string, bgName: string, bg: Rgba, min: number, fgColour = tok(fg)) => {
    const r = contrast(fgColour, bg);
    pairs.push({ fg, bg: bgName, ratio: r, min, detail: `${hex(fgColour.a < 1 ? over(fgColour, bg) : fgColour)} on ${hex(bg)}` });
  };

  for (const fg of ["fg", "fg-body", "fg-muted", "fg-meta"]) for (const [n, b] of Object.entries(backdrops)) add(fg, n, b, 4.5);
  for (const role of ["go-fg", "select-fg", "coin", "warn", "problem", "script", "restart"]) {
    add(role, "surface-card (over page)", card, 4.5);
    add(role, "surface-page", page, 4.5);
  }
  add("on-go", "go", over(tok("go"), page), 4.5);
  for (const n of ["surface-page", "surface-card (over page)", "surface-raised (over page)"]) {
    add("focus", n, backdrops[n], 3);
    add("select", n, backdrops[n], 3); // tab ink, selected outlines (WCAG 1.4.11)
  }
  // WCAG 1.4.11: an input's boundary must stand out from what is around it.
  add("line-control", "surface-card (over page)", card, 3);
  add("line-control", "surface-page", page, 3);
  return pairs;
}

const failures = (pairs: Pair[]) => pairs.filter((p) => p.ratio < p.min);
const table = (pairs: Pair[]) =>
  pairs.map((p) => `${p.ratio < p.min ? "FAIL" : "ok  "} ${p.fg.padEnd(13)} on ${p.bg.padEnd(28)} ${p.ratio.toFixed(2).padStart(5)} (min ${p.min})  ${p.detail}`).join("\n");

const PALETTES: [string, Vars][] = [["default (@theme)", themeFrom(indexCss)], ...[...palettesIn(indexCss)].map(([n, o]) => [`[data-palette="${n}"]`, themeFrom(indexCss, o)] as [string, Vars])];

describe.each(PALETTES)("token contrast · %s", (_name, theme) => {
  it("every promised text, role, focus and boundary pair meets WCAG", () => {
    const pairs = checkPalette(theme);
    if (process.env.TOKENS_TABLE) console.log(table(pairs));
    const bad = failures(pairs);
    expect(bad, `\n${table(bad)}\n`).toEqual([]);
  });
});

describe("token contrast maths", () => {
  const lookup = (n: string) => tailwindVars.get(n);
  const c = (v: string) => toRgba(parseColour(v, lookup));

  it("matches known WCAG ratios", () => {
    expect(contrast(c("#ffffff"), c("#000000"))).toBeCloseTo(21, 5);
    expect(contrast(c("#777777"), c("#ffffff"))).toBeCloseTo(4.48, 2);
  });

  it("resolves Tailwind palette refs (slate-950 = #020618)", () => {
    expect(hex(c("var(--color-slate-950)"))).toBe("#020618");
  });

  it("color-mix with transparent is the colour at that opacity", () => {
    const m = c("color-mix(in oklab, var(--color-slate-800) 40%, transparent)");
    expect(m.a).toBeCloseTo(0.4, 5);
    expect(hex({ ...m, a: 1 })).toBe(hex(c("var(--color-slate-800)")));
  });

  it("would have caught the old line-control (slate-600 at 60%, measured 1.6:1 against the card)", () => {
    const old = themeFrom(indexCss, new Map([["--color-line-control", "color-mix(in oklab, var(--color-slate-600) 60%, transparent)"]]));
    const bad = failures(checkPalette(old)).filter((p) => p.fg === "line-control");
    expect(bad.map((p) => p.bg)).toEqual(["surface-card (over page)", "surface-page"]);
    expect(bad[0].ratio).toBeLessThan(2);
  });

  it("would catch slate-500 as meta text", () => {
    const old = themeFrom(indexCss, new Map([["--color-fg-meta", "var(--color-slate-500)"]]));
    expect(failures(checkPalette(old)).some((p) => p.fg === "fg-meta")).toBe(true);
  });

  it("picks up [data-palette] blocks as overrides", () => {
    const css = `@theme { --color-fg: #fff; } [data-palette="neon"] { --color-fg: #0f0; --color-go: #f0f; }`;
    const p = palettesIn(css);
    expect([...p.keys()]).toEqual(["neon"]);
    expect(themeFrom(css, p.get("neon")).get("--color-fg")).toBe("#0f0");
  });
});

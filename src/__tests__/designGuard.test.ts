// Design guard: fails when a guarded folder uses styling the design system has retired.
//
// It scans every .ts/.tsx file under GUARDED (tests excluded) line by line and reports
// `file:line [rule] match → fix`. The rules mirror docs/design-system (foundations.md,
// principles.md) and the sprint brief (research/design-audit-v2/SPRINT-BRIEF.md): kit code uses
// the semantic token utilities from src/index.css @theme, never raw palette steps, ad-hoc sizes,
// radii, shadows or z-indices.
//
// Escape hatch, one line at a time, reason required:
//   className="… bg-black/60 …" // design-guard-ignore: scrim has no token yet
//   {/* design-guard-ignore: <reason> */}   ← on its own line, it covers the next line
// A comment-only line with the marker covers the line below it; a marker after code covers its own line.
//
// Add a folder to GUARDED once its page is revamped (page-revamp skill, step "Finish").
// To write the full list to a file: DESIGN_GUARD_OUT=research/design-audit-v2/guard/baseline.txt npx vitest run src/__tests__/designGuard.test.ts
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/** Folders that must stay on the design system. Grow this list; never shrink it. */
export const GUARDED: string[] = ["src/components/ui", "src/components/layout", "src/components/simulator/page", "src/components/simulator/flowgraph", "src/components/flows", "src/components/playerStats", "src/components/playerImport", "src/components/guide", "src/components/calculator", "src/components/grid", "src/components/shared"];

/**
 * Files inside a guarded folder that are knowingly off-system, each with the reason and the plan
 * that removes it. They are skipped by the scan, but the test fails when a listed file no longer
 * exists or has become clean, so this list can only shrink. Never add a file to make the guard pass.
 */
export const PENDING: Record<string, string> = {
  "src/components/ui/Panel.tsx": "legacy, @deprecated; deleted when the last page migrates (migration.md)",
  "src/components/ui/ToggleSwitch.tsx": "legacy, @deprecated; deleted when the last page migrates (migration.md)",
  "src/components/ui/MutationRequirementGrid.tsx": "page component living in ui/; migrated in its page revamp (page-audit.md)",
};

export interface Rule {
  id: string;
  /** Global regex; every match on a line is one violation. */
  re: RegExp;
  fix: string;
}

const FAMILIES = "slate|gray|zinc|neutral|stone|emerald|green|red|amber|yellow|sky|violet|blue|purple|pink|rose|indigo|teal|cyan|orange|lime|fuchsia";
// A utility starts at a class boundary: start, space, quote, backtick, `:` (variant) or `!`.
const B = String.raw`(?<![\w-])`;
const E = String.raw`(?![\w-])`;

export const RULES: Rule[] = [
  {
    id: "type-size",
    re: new RegExp(String.raw`${B}text-(?:xs|sm|base|lg|xl|[2-9]xl)(?![\w-])|${B}text-\[\d[\d.]*(?:px|rem|em)\]`, "g"),
    fix: "use a type role: text-label | text-meta (11) · text-secondary (12) · text-body (13) · text-title (15) · text-hero (22)",
  },
  {
    id: "radius",
    re: new RegExp(String.raw`${B}rounded(?:-(?:t|r|b|l|s|e|tl|tr|bl|br|ss|se|es|ee))?(?:-(?:xs|sm|md|lg|xl|2xl|3xl|4xl)|-\[[^\]]*\])?${E}`, "g"),
    fix: "use rounded-inner (6) · rounded-control (8) · rounded-container (12) · rounded-full · rounded-none",
  },
  {
    id: "palette-colour",
    re: new RegExp(
      String.raw`${B}(?:[a-z]+-)+?(?:${FAMILIES})-(?:50|[1-9]00|950)(?![\w])|${B}(?:[a-z]+-)+?(?:black|white)(?:\/[\d.]+)?${E}|--color-(?:${FAMILIES}|black|white)\b`,
      "g",
    ),
    fix: "use a semantic token: bg-surface-* · border-line* · text-fg* · go / go-fg / on-go · coin · warn · problem · script · restart · focus",
  },
  {
    id: "decoration",
    re: new RegExp(String.raw`${B}bg-(?:gradient|linear|radial|conic)-|${B}bg-clip-text${E}|${B}drop-shadow(?:-[\w\[\]().,%/-]+)?|${B}shadow-\[|${B}shadow-(?:2xs|xs|sm|md|lg|xl|2xl)${E}`, "g"),
    fix: "flat surfaces; the only shadow is shadow-raised (floating surfaces). No gradients, gradient text or glows",
  },
  {
    id: "z-index",
    re: new RegExp(String.raw`${B}-?z-\[[^\]]*\]`, "g"),
    fix: "use the z ladder: z-(--z-sticky|bar|workspace|drawer|popover|menu|toast|tooltip)",
  },
  {
    id: "raw-colour",
    re: /(?<![\w&/-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])|(?<![\w-])(?:rgba?|hsla?|oklch|oklab|lab|lch|color-mix)\(/g,
    fix: "no literal colours in components: use a --color-* token (add one to src/index.css @theme if it is missing)",
  },
  {
    id: "layout-transition",
    re: new RegExp(
      String.raw`${B}transition-all${E}|${B}transition-\[[^\]]*(?:width|height|all|inset|top|left|right|bottom|margin|padding)[^\]]*\]|transition(?:Property)?:\s*["'\`][^"'\`]*\b(?:width|height|all|top|left|margin|padding)\b`,
      "g",
    ),
    fix: "animate transform / opacity / colours only (transition-colors, transition-[transform,opacity])",
  },
  {
    id: "native-select",
    re: /<select\b/g,
    fix: "use Dropdown (look=\"field\") from ui/Popover",
  },
  {
    id: "native-dialog",
    re: /\b(?:window|globalThis)\.(?:confirm|alert|prompt)\s*\(/g,
    fix: "undoable → toast with Undo; not undoable → a kit dialog",
  },
];

const LEGACY_NAMES = ["Panel", "SectionLabel", "SegmentedControl", "ToggleSwitch", "buttonClass", "inputClass"];
const LEGACY_FIX: Record<string, string> = {
  Panel: "Card / DisclosureCard (ui/Card)",
  SectionLabel: "KitLabel",
  SegmentedControl: "Segmented or Tabs (ui/kit)",
  ToggleSwitch: "Switch (ui/kit)",
  buttonClass: "KitButton / IconButton / LinkButton",
  inputClass: "KitInput",
};

export interface Violation {
  file: string;
  line: number;
  rule: string;
  match: string;
  fix: string;
}

const IGNORE = /design-guard-ignore\b(?::?\s*([^*\n]*?))?\s*(?:\*\/\s*\}?)?\s*$/;
const isCommentOnly = (t: string) => /^(\/\/|\/\*|\*|\{\s*\/\*)/.test(t);

/** Scans one file's text. Exported so the rule tests below and other tools can reuse it. */
export function scanSource(text: string, file: string): Violation[] {
  const lines = text.split(/\r?\n/);
  const out: Violation[] = [];
  const ignored = new Set<number>(); // 0-based line indexes covered by an escape comment

  lines.forEach((raw, i) => {
    const m = raw.match(IGNORE);
    if (!m) return;
    const reason = (m[1] ?? "").replace(/^[-–—:\s]+/, "").trim();
    if (!reason) {
      out.push({ file, line: i + 1, rule: "ignore-without-reason", match: "design-guard-ignore", fix: "write why: // design-guard-ignore: <reason>" });
      return;
    }
    ignored.add(isCommentOnly(raw.trim()) ? i + 1 : i);
  });

  lines.forEach((raw, i) => {
    const t = raw.trim();
    if (!t || ignored.has(i)) return;
    if (/^(\/\/|\/\*|\*)/.test(t) && !/\*\/./.test(t)) return; // comments don't ship
    if (/^\{\s*\/\*.*\*\/\s*\}$/.test(t)) return; // nor JSX comments
    for (const r of RULES) {
      for (const m of raw.matchAll(r.re)) out.push({ file, line: i + 1, rule: r.id, match: m[0], fix: r.fix });
    }
  });

  // Legacy imports (handles multi-line import lists).
  for (const m of text.matchAll(/^\s*import\s+(?:type\s+)?([^;"']*?)\s+from\s+["']([^"']+)["']/gm)) {
    const spec = m[1];
    const path = m[2];
    const line = text.slice(0, m.index).split(/\r?\n/).length;
    if (ignored.has(line - 1)) continue;
    const names = LEGACY_NAMES.filter((n) => new RegExp(String.raw`\b${n}\b`).test(spec));
    if (/(?:^|\/)(?:Panel|ToggleSwitch)$|simulator\/styles$/.test(path) && names.length === 0) names.push(path);
    for (const n of names) out.push({ file, line, rule: "legacy-import", match: `${n} from "${path}"`, fix: `use ${LEGACY_FIX[n] ?? "the kit equivalent (docs/design-system/migration.md)"}` });
  }
  return out;
}

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) files.push(p);
  }
  return files;
}

export function scanFolder(folder: string): Violation[] {
  return walk(folder).flatMap((f) => scanSource(readFileSync(f, "utf8"), relative(process.cwd(), f).split(sep).join("/")));
}

export function formatReport(vs: Violation[]): string {
  if (vs.length === 0) return "design guard: no violations";
  const byFile = new Map<string, number>();
  const byRule = new Map<string, number>();
  for (const v of vs) {
    byFile.set(v.file, (byFile.get(v.file) ?? 0) + 1);
    byRule.set(v.rule, (byRule.get(v.rule) ?? 0) + 1);
  }
  const lines = [`design guard: ${vs.length} violation(s) in ${byFile.size} file(s)`, "", "Per file:"];
  for (const [f, n] of [...byFile].sort((a, b) => b[1] - a[1])) lines.push(`  ${String(n).padStart(4)}  ${f}`);
  lines.push("", "Per rule:");
  for (const [r, n] of [...byRule].sort((a, b) => b[1] - a[1])) lines.push(`  ${String(n).padStart(4)}  ${r}  → ${RULES.find((x) => x.id === r)?.fix ?? vs.find((v) => v.rule === r)?.fix}`);
  lines.push("", "Violations (file:line [rule] match):");
  for (const v of vs) lines.push(`  ${v.file}:${v.line}  [${v.rule}]  ${v.match}`);
  lines.push("", "Escape one line only with a reason: // design-guard-ignore: <why>");
  return lines.join("\n");
}

describe("design guard rules", () => {
  const hits = (code: string) => scanSource(code, "x.tsx").map((v) => v.rule);
  it.each([
    ['<p className="text-sm text-fg">', "type-size"],
    ['<p className="md:text-[12.5px]">', "type-size"],
    ['<p className="text-lg">', "type-size"],
    ['<div className="rounded-md">', "radius"],
    ['<div className="rounded">', "radius"],
    ['<div className="rounded-t-lg">', "radius"],
    ['<div className="rounded-[7px]">', "radius"],
    ['<div className="bg-slate-800/40">', "palette-colour"],
    ['<div className="hover:text-emerald-300">', "palette-colour"],
    ['<div className="ring-red-500/30">', "palette-colour"],
    ['<div className="bg-[var(--color-slate-900)]">', "palette-colour"],
    ['<div className="bg-gradient-to-r">', "decoration"],
    ['<div className="bg-linear-to-b">', "decoration"],
    ['<b className="bg-clip-text">', "decoration"],
    ['<div className="shadow-[0_0_8px_rgba(52,211,153,.6)]">', "decoration"],
    ['<div className="drop-shadow-lg">', "decoration"],
    ['<div className="shadow-sm">', "decoration"],
    ['<div className="z-[60]">', "z-index"],
    ['const c = "#0b1120";', "raw-colour"],
    ['<div className="hover:bg-[color-mix(in_oklab,var(--color-go)_85%,white)]">', "raw-colour"],
    ['<div className="bg-black/60">', "palette-colour"],
    ['<div className="text-white">', "palette-colour"],
    ['style={{ color: "rgba(0,0,0,.5)" }}', "raw-colour"],
    ['<div className="transition-all">', "layout-transition"],
    ['<div className="transition-[width,transform]">', "layout-transition"],
    ["<select value={v}>", "native-select"],
    ["if (window.confirm('Sure?')) go();", "native-dialog"],
    ['import { Panel } from "./Panel";', "legacy-import"],
    ['import {\n  KitButton,\n  buttonClass,\n} from "../simulator/styles";', "legacy-import"],
  ])("flags %s", (code, rule) => {
    expect(hits(code)).toContain(rule);
  });

  it.each([
    '<p className="text-body text-fg-meta">',
    '<p className="text-label uppercase text-fg-muted">',
    '<div className="rounded-control rounded-container rounded-inner rounded-full rounded-none rounded-t-container">',
    '<div className="bg-surface-card border-line-control text-go-fg bg-problem/10 ring-focus">',
    '<div className="shadow-raised z-(--z-popover) duration-(--duration-pop)">',
    '<div className="transition-colors transition-[transform,opacity] z-0">',
    '<a href="#inventory">',
    "// a comment that mentions text-sm and rounded-md is fine",
    "import { Card } from './Card';",
    'const label = "Context menu";',
    '<div className="text-coin whitespace-nowrap forced-colors:bg-[Highlight]">',
  ])("allows %s", (code) => {
    expect(hits(code)).toEqual([]);
  });

  it("an escape comment with a reason covers its line, or the next line when it stands alone", () => {
    expect(hits('<div className="bg-black/60 z-[60]" /> {/* design-guard-ignore: scrim layer, no token yet */}')).toEqual([]);
    expect(hits('// design-guard-ignore: legacy site chrome\n<div className="rounded-md">')).toEqual([]);
    expect(hits('// design-guard-ignore: one line only\n<div className="rounded-control">\n<div className="rounded-md">')).toEqual(["radius"]);
  });

  it("an escape comment without a reason is itself a violation", () => {
    expect(hits('<div className="rounded-md"> // design-guard-ignore')).toEqual(["ignore-without-reason", "radius"]);
  });
});

describe("design guard", () => {
  it.each(GUARDED)("%s uses only design-system styling", (folder) => {
    const all = scanFolder(folder);
    const vs = all.filter((v) => !(v.file in PENDING));
    const out = process.env.DESIGN_GUARD_OUT;
    if (out) {
      const pending = all.filter((v) => v.file in PENDING);
      const note = Object.entries(PENDING).filter(([f]) => f.startsWith(`${folder}/`)).map(([f, why]) => `  ${String(pending.filter((v) => v.file === f).length).padStart(4)}  ${f} — ${why}`);
      writeFileSync(out, `# ${folder} · ${new Date().toISOString()}\n${formatReport(vs)}\n\nPENDING (skipped, must shrink):\n${note.join("\n")}\n`);
    }
    if (vs.length) throw new Error(`\n${formatReport(vs)}\n`);
  });

  it.each(Object.entries(PENDING))("PENDING %s is still off-system (else remove it from the list)", (file, reason) => {
    expect(reason.trim(), "every PENDING entry needs a reason").not.toBe("");
    expect(GUARDED.some((g) => file.startsWith(`${g}/`)), `${file} is not inside a GUARDED folder`).toBe(true);
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      throw new Error(`${file} no longer exists: remove it from PENDING`);
    }
    expect(scanSource(text, file).length, `${file} is clean now: remove it from PENDING so it stays guarded`).toBeGreaterThan(0);
  });
});

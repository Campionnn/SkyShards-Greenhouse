import React from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DesignerProvider, GreenhouseDataProvider, InfoModalProvider } from "../../context";
import type { DesignerPlacement } from "../../context";
import { ToastProvider } from "../ui";
import { loadLayouts, restoreLayout, saveLayouts, deleteLayout } from "../../utilities/layoutStorage";
import type { SavedLayout } from "../../types/layout";
import { DesignerActions } from "./DesignerActions";
import { LayoutClearControls, LayoutHistoryControls, LayoutTransformControls } from "./LayoutTools";
import { LayoutSourceBadge } from "./LayoutSourceBadge";
import { LayoutPreview } from "./LoadLayoutModal";

// Server-renders the Designer's actions (the rail, the phone toolbar, the shared tools LayoutWorkspace
// mounts) and checks the saved-layout storage behind Delete → Undo. No browser needed.

const wrap = (node: React.ReactNode) =>
  renderToString(
    <MemoryRouter>
      <ToastProvider>
        <GreenhouseDataProvider>
          <InfoModalProvider>{node}</InfoModalProvider>
        </GreenhouseDataProvider>
      </ToastProvider>
    </MemoryRouter>,
  ).replace(/<!-- -->/g, "");

const p = (id: string, cropId: string, position: [number, number], size = 1, isMutation = false): DesignerPlacement => ({ id, cropId, cropName: cropId, size, position, isMutation });
const LAYOUT = {
  inputs: [p("i1", "cocoa_beans", [0, 0]), p("i2", "pumpkin", [0, 2])],
  targets: [p("t1", "chocoberry", [4, 5], 1, true)],
  groundTiles: [],
};
const EMPTY = { inputs: [], targets: [], groundTiles: [] };
const within = (layout: typeof LAYOUT | typeof EMPTY, node: React.ReactNode) =>
  wrap(
    <DesignerProvider persist={false} initialPlacements={layout}>
      {node}
    </DesignerProvider>,
  );
/** Every button: its opening tag and its name (aria-label, else its text). Buttons don't nest. */
const buttons = (html: string) =>
  [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({
    tag: m[0].slice(0, m[0].indexOf(">") + 1),
    at: m.index ?? 0,
    name: m[1].match(/aria-label="([^"]*)"/)?.[1] ?? m[2].replace(/<[^>]+>/g, "").trim(),
  }));
const button = (html: string, label: string) => buttons(html).find((b) => b.name === label);
const disabled = (html: string, label: string) => /\sdisabled=""/.test(button(html, label)?.tag ?? "");

describe("DesignerActions (rail)", () => {
  const html = within(LAYOUT, <DesignerActions />);

  it("shows the approved labels, top to bottom", () => {
    const order = ["Undo", "Redo", "Save", "Load", "Share", "Simulate", "PNG", "GIF", "Nudge left one cell", "Mirror top to bottom", "Clear"];
    const at = order.map((l) => button(html, l)?.at ?? -1);
    expect(at.every((i) => i >= 0), JSON.stringify(buttons(html).map((b) => b.name))).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(html).not.toMatch(/Share Layout|Export Image|Clear All/);
  });

  it("has one Undo / Redo group and no Save / Load dialog until asked", () => {
    expect(html.match(/aria-label="Undo and redo"/g)?.length).toBe(1);
    expect(html).not.toContain("Save this layout");
    expect(html).not.toContain("Load a layout");
  });

  it("enables the layout actions when there is something to act on", () => {
    for (const l of ["Save", "Load", "Share", "Simulate", "PNG", "GIF"]) expect(disabled(html, l), l).toBe(false);
    expect(disabled(html, "Undo")).toBe(true); // a fresh history
  });

  it("disables everything but Load on an empty layout", () => {
    const empty = within(EMPTY, <DesignerActions />);
    for (const l of ["Save", "Share", "Simulate", "PNG", "GIF", "Rotate 90° clockwise"]) expect(disabled(empty, l), l).toBe(true);
    expect(disabled(empty, "Load")).toBe(false);
    expect(buttons(empty).find((b) => b.tag.includes('aria-haspopup="menu"'))?.tag).toContain('disabled=""'); // Clear ▾
  });

  it("styles on tokens only", () => {
    expect(html).not.toMatch(/#[0-9a-f]{6}\b|rgba\(|slate-|text-xs|text-sm|rounded-lg|rounded-md/i);
  });
});

describe("DesignerActions (phone toolbar)", () => {
  const html = within(LAYOUT, <DesignerActions variant="toolbar" />);

  it("is one row of eight 44px icon buttons, PNG and GIF merged into Export", () => {
    const labels = buttons(html)
      .filter((b) => /class="[^"]*\bsize-11\b/.test(b.tag))
      .map((b) => b.name);
    expect(labels).toEqual(["Undo", "Redo", "Save", "Load", "Share", "Export image", "Clear", "More"]);
    expect(html).not.toContain(">PNG<");
  });
});

describe("LayoutWorkspace's shared tools keep working", () => {
  it("LayoutHistoryControls renders Undo / Redo with or without its keys", () => {
    for (const keys of [true, false]) {
      const html = within(LAYOUT, <LayoutHistoryControls keys={keys} className="mb-2" />);
      expect(html).toContain('aria-label="Undo and redo"');
      expect(html).toContain("mb-2");
    }
  });

  it("LayoutTransformControls is one toolbar of 2 × 4 named segments", () => {
    const html = within(LAYOUT, <LayoutTransformControls />);
    expect(html).toContain('role="toolbar" aria-label="Transform"');
    expect(html.match(/<button[^>]*aria-label="(Nudge|Rotate|Mirror) /g)?.length).toBe(8);
  });

  it("LayoutClearControls is the Clear menu button", () => {
    const html = within(LAYOUT, <LayoutClearControls />);
    expect(html).toMatch(/aria-haspopup="menu"/);
    expect(html).toContain("Clear");
    expect(html).not.toMatch(/>All<|Confirm/);
  });
});

describe("LayoutPreview and LayoutSourceBadge (the Simulator's layout picker)", () => {
  it("draw the preview on tokens and the badge's label", () => {
    const html = wrap(
      <>
        <LayoutPreview layout={{ inputs: [{ cropId: "wheat", position: [0, 0] }], targets: [{ cropId: "choconut", position: [1, 1] }] }} cellSize={8} />
        <LayoutSourceBadge from="calculator">{" · Nov 9"}</LayoutSourceBadge>
      </>,
    );
    expect(html).toContain("From the Calculator · Nov 9");
    expect(html).toContain("var(--color-select)");
    expect(html).not.toMatch(/#1e293b|slate-|text-emerald|text-blue|text-amber/);
  });
});

describe("restoreLayout (Delete → Undo)", () => {
  const store = new Map<string, string>();
  const layout = (id: string, name: string): SavedLayout => ({ id, name, savedAt: 1, modifiedAt: 2, inputs: [], targets: [] });
  beforeEach(() => {
    store.clear();
    (globalThis as { localStorage?: Storage }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    };
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it("puts the same layout back at the same index", () => {
    saveLayouts([layout("a", "A"), layout("b", "B"), layout("c", "C")]);
    const gone = loadLayouts()[1];
    expect(deleteLayout("b")).toBe(true);
    expect(loadLayouts().map((l) => l.id)).toEqual(["a", "c"]);
    expect(restoreLayout(gone, 1)).toBe(true);
    expect(loadLayouts()).toEqual([layout("a", "A"), layout("b", "B"), layout("c", "C")]);
  });

  it("refuses a duplicate id and clamps a stale index to the end", () => {
    saveLayouts([layout("a", "A")]);
    expect(restoreLayout(layout("a", "A"), 0)).toBe(false);
    expect(restoreLayout(layout("z", "Z"), 9)).toBe(true);
    expect(loadLayouts().map((l) => l.id)).toEqual(["a", "z"]);
  });
});

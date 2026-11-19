import { describe, expect, it } from "vitest";
import greenhouseData from "../../public/greenhouse/data.json";
import type { GreenhouseDataJSON } from "../services/greenhouseDataService";
import { buildWikiIndex } from "./slugs";
import { buildUsedInMap } from "./recipes";
import {
  EMBED_ACCENT,
  EMBED_MAX_BYTES,
  EMBED_MAX_COMPONENTS,
  buttons,
  container,
  countComponents,
  escapeMarkdown,
  linkButton,
  serializeComponentEmbed,
  text,
  truncatedList,
  utf8Bytes,
  validateComponentEmbed,
} from "./componentEmbed";
import type { Container } from "./componentEmbed";
import { ROUTE_EMBED_PATHS, routeEmbed, wikiItemEmbed } from "./siteEmbeds";
import { buildHomePage, buildRoutePages, buildWikiStaticPages, setComponentEmbed } from "./staticPages";

const data = greenhouseData as unknown as GreenhouseDataJSON;
const index = buildWikiIndex(data);
const usedIn = buildUsedInMap(data);
const SITE = "https://greenhouse.skyshards.com";

/** Every component of a container, depth first, the container included. */
function walk(component: Container): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [component as unknown as Record<string, unknown>];
  const visit = (node: Record<string, unknown>) => {
    out.push(node);
    for (const child of (node.components as Record<string, unknown>[] | undefined) ?? []) visit(child);
    if (node.accessory) visit(node.accessory as Record<string, unknown>);
  };
  for (const child of component.components) visit(child as unknown as Record<string, unknown>);
  return out;
}

/** The rules from the Discord docs, checked independently of validateComponentEmbed. */
function expectDiscordValid(component: Container, label: string) {
  const json = serializeComponentEmbed(component);
  expect(utf8Bytes(json), `${label}: bytes`).toBeLessThanOrEqual(EMBED_MAX_BYTES);
  expect(json, `${label}: raw <>& in the script`).not.toMatch(/[<>&]/);
  expect(JSON.parse(json)).toEqual({ component: JSON.parse(JSON.stringify(component)) });
  const nodes = walk(component);
  expect(nodes.length, `${label}: components`).toBeLessThanOrEqual(EMBED_MAX_COMPONENTS);
  expect(nodes.filter((n) => n.type === 17), `${label}: one container`).toHaveLength(1);
  for (const node of nodes) {
    expect([1, 2, 9, 10, 11, 12, 14, 17], `${label}: type`).toContain(node.type);
    if (node.type === 2) {
      expect(node.style, `${label}: link button`).toBe(5);
      for (const key of Object.keys(node)) expect(["id", "type", "url", "style", "label", "emoji", "disabled"]).toContain(key);
      expect(String(node.url)).toMatch(/^https:\/\//);
    }
  }
  expect(validateComponentEmbed({ component }), label).toEqual([]);
}

describe("component embed rules", () => {
  it("rejects what Discord rejects", () => {
    const ok = container([text("## Hi"), buttons([linkButton("Open", "https://example.com/")])]);
    expect(validateComponentEmbed({ component: ok })).toEqual([]);
    expect(countComponents(ok)).toBe(4);

    const nested = { component: { type: 17, components: [{ type: 17, components: [] }] } };
    expect(validateComponentEmbed(nested).join()).toMatch(/not allowed/);
    expect(validateComponentEmbed({ component: ok, extra: 1 })).not.toEqual([]);
    expect(validateComponentEmbed({ component: { type: 10, content: "x" } })).not.toEqual([]);

    const primary = container([buttons([{ ...linkButton("Go", "https://example.com/"), style: 1 } as never])]);
    expect(validateComponentEmbed({ component: primary }).join()).toMatch(/style 5/);
    const customId = container([buttons([{ ...linkButton("Go", "https://example.com/"), custom_id: "x" } as never])]);
    expect(validateComponentEmbed({ component: customId }).join()).toMatch(/custom_id/);

    const tooMany = container(Array.from({ length: 40 }, (_, i) => text(`line ${i}`)));
    expect(validateComponentEmbed({ component: tooMany }).join()).toMatch(/41 components/);

    const huge = container([text("x".repeat(2000)), text("<".repeat(200))]);
    expect(validateComponentEmbed({ component: huge }).join()).toMatch(/bytes/);
  });

  it("counts the script escapes at full length", () => {
    const json = serializeComponentEmbed(container([text("a<b>&c")]));
    expect(json).toContain("a\\u003cb\\u003e\\u0026c");
    expect(utf8Bytes(json)).toBe(json.length);
  });

  it("escapes markdown in names and truncates lists", () => {
    expect(escapeMarkdown("All-in Aloe")).toBe("All-in Aloe");
    expect(escapeMarkdown("*bold* [x](y)")).toBe("\\*bold\\* \\[x\\](y)");
    expect(escapeMarkdown("# big")).toBe("\\# big");
    expect(truncatedList(["a", "b", "c"], 2)).toBe("a, b, c");
    expect(truncatedList(["a", "b", "c", "d"], 2)).toBe("a, b + 2 more");
  });
});

describe("wiki item embeds", () => {
  it("is valid and under 3,000 bytes for every crop and mutation", () => {
    const sizes: number[] = [];
    for (const entry of index.entries) {
      const component = wikiItemEmbed(entry, data, usedIn, SITE);
      expectDiscordValid(component, entry.id);
      sizes.push(utf8Bytes(serializeComponentEmbed(component)));
    }
    expect(sizes).toHaveLength(Object.keys(data.crops).length + Object.keys(data.mutations).length);
  });

  it("shows name, meta, icon, requirements with links, effects and buttons", () => {
    const gloomgourd = index.byId.get("gloomgourd")!;
    const component = wikiItemEmbed(gloomgourd, data, usedIn, SITE);
    expect(component.accent_color).toBe(EMBED_ACCENT);
    const json = JSON.stringify(component);
    expect(json).toContain("## Gloomgourd\\n-# Common 1×1 mutation · Farmland");
    expect(json).toContain(`**1×** [Pumpkin](${SITE}/wiki/pumpkin)`);
    expect(json).toContain("**Positive** Bonus Drops, Water Retain");
    expect(json).toContain(`[Soggybud](${SITE}/wiki/soggybud)`);
    expect(json).toContain(`"url":"${SITE}/greenhouse/crops/gloomgourd.png"`);
    const row = component.components.at(-1)!;
    expect(row.type).toBe(1);
    expect(row.type === 1 && row.components.map((b) => b.label)).toEqual(["Open in wiki", "Calculator", "Designer"]);
  });

  it("describes base crops and special spawns", () => {
    const wheat = JSON.stringify(wikiItemEmbed(index.byId.get("wheat")!, data, usedIn, SITE));
    expect(wheat).toContain("-# 1×1 crop · Farmland");
    expect(wheat).not.toContain("Calculator");
    const lonelily = JSON.stringify(wikiItemEmbed(index.byId.get("lonelily")!, data, usedIn, SITE));
    expect(lonelily).toContain("Spawns with no adjacent crops.");
  });

  it("truncates long used-in lists", () => {
    const many = new Map(usedIn);
    many.set("wheat", Object.keys(data.mutations));
    const json = JSON.stringify(wikiItemEmbed(index.byId.get("wheat")!, data, many, SITE));
    expect(json).toMatch(/\+ \d+ more/);
    expectDiscordValid(wikiItemEmbed(index.byId.get("wheat")!, data, many, SITE), "wheat (many)");
  });
});

describe("route embeds", () => {
  it("is valid for every tool page, with and without a screenshot", () => {
    for (const path of ROUTE_EMBED_PATHS) {
      expectDiscordValid(routeEmbed(path, data, { siteUrl: SITE }), path);
      const shot = routeEmbed(path, data, { siteUrl: SITE, screenshotUrl: `${SITE}/screenshots/calculator.png` });
      expectDiscordValid(shot, `${path} + screenshot`);
      expect(shot.components.some((c) => c.type === 12)).toBe(true);
    }
  });

  it("links the main tools, primary first", () => {
    const sim = routeEmbed("/simulator", data, { siteUrl: SITE });
    const row = sim.components.at(-1)!;
    expect(row.type === 1 && row.components.map((b) => [b.label, b.url])).toEqual([
      ["Open simulator", `${SITE}/simulator`],
      ["Leaderboard", `${SITE}/`],
      ["Designer", `${SITE}/designer`],
    ]);
  });
});

describe("static pages carry the embed", () => {
  const template = `<!DOCTYPE html><html><head>
    <title>A</title>
    <meta name="description" content="site" />
    <meta property="og:image" content="https://example.com/shot.png" />
    <link rel="canonical" href="https://example.com/" />
  </head><body><noscript>site</noscript></body></html>`;
  const scriptRe = /<script id="discord:component-embed" type="application\/json">([^<]*)<\/script>/g;

  it("puts exactly one script in <head> of every wiki page", () => {
    for (const page of buildWikiStaticPages(template, data, "https://example.com")) {
      const matches = [...page.html.matchAll(scriptRe)];
      expect(matches, page.file).toHaveLength(1);
      expect(page.html.indexOf(matches[0][0])).toBeLessThan(page.html.indexOf("</head>"));
      const payload = JSON.parse(matches[0][1]);
      expect(validateComponentEmbed(payload), page.file).toEqual([]);
      expect(utf8Bytes(matches[0][1])).toBeLessThanOrEqual(EMBED_MAX_BYTES);
    }
  });

  it("gives tool pages a card and leaves about/contact/privacy on OG", () => {
    const pages = buildRoutePages(template, "https://example.com", { data });
    const withCard = pages.filter((p) => p.html.includes("discord:component-embed")).map((p) => p.file);
    expect(withCard.sort()).toEqual(["calculator.html", "designer.html", "guide.html", "simulator.html"]);
    // Without data (old callers) nothing changes.
    expect(buildRoutePages(template, "https://example.com").some((p) => p.html.includes("discord:component-embed"))).toBe(false);
  });

  it("gives index.html the home card once, even when applied twice", () => {
    const once = buildHomePage(template, data, "https://example.com");
    const twice = buildHomePage(once, data, "https://example.com");
    expect([...twice.matchAll(scriptRe)]).toHaveLength(1);
    expect(setComponentEmbed(twice, null)).not.toContain("discord:component-embed");
  });
});

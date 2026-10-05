import { describe, expect, it } from "vitest";
import greenhouseData from "../../public/greenhouse/data.json";
import type { GreenhouseDataJSON } from "../services/greenhouseDataService";
import {
  RESERVED_TOP_LEVEL_PATHS,
  buildWikiIndex,
  hypixelWikiUrl,
  normalizeKey,
  resolveSlug,
  toSlug,
  wikiPath,
} from "./slugs";
import { buildUsedInMap, collectBaseIngredients, collectExpandablePaths, getRecipeSource, isLeaf } from "./recipes";
import { addToSitemap, buildWikiStaticPages } from "./staticPages";

const data = greenhouseData as unknown as GreenhouseDataJSON;
const index = buildWikiIndex(data);

describe("wiki slugs", () => {
  it("lists every crop and mutation once", () => {
    expect(index.entries).toHaveLength(Object.keys(data.crops).length + Object.keys(data.mutations).length);
  });

  it("gives every item a unique slug and lookup key", () => {
    const slugs = index.entries.map((entry) => entry.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    const keys = index.entries.map((entry) => normalizeKey(entry.id));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("never shadows an app route or a top-level file with a short link", () => {
    for (const entry of index.entries) {
      expect(RESERVED_TOP_LEVEL_PATHS.has(entry.slug), entry.slug).toBe(false);
      expect([...RESERVED_TOP_LEVEL_PATHS].map(normalizeKey)).not.toContain(normalizeKey(entry.name));
    }
  });

  it("uses the hyphenated id as the canonical path", () => {
    expect(toSlug("all_in_aloe")).toBe("all-in-aloe");
    expect(wikiPath("do_not_eat_shroom")).toBe("/wiki/do-not-eat-shroom");
  });

  it.each([
    ["gloomgourd", "gloomgourd"],
    ["Gloomgourd", "gloomgourd"],
    ["all-in-aloe", "all_in_aloe"],
    ["all_in_aloe", "all_in_aloe"],
    ["All-in_Aloe", "all_in_aloe"],
    ["All-in%20Aloe", "all_in_aloe"],
    ["allinaloe", "all_in_aloe"],
    ["Do-not-eat-shroom", "do_not_eat_shroom"],
    ["plantboy-advance", "plantboy_advance"],
    ["PlantBoy%20Advance", "plantboy_advance"],
    ["wheat", "wheat"],
  ])("resolves %s", (raw, id) => {
    expect(resolveSlug(index, raw)?.id).toBe(id);
  });

  it("returns null for unknown or empty segments", () => {
    expect(resolveSlug(index, "not-a-crop")).toBeNull();
    expect(resolveSlug(index, "---")).toBeNull();
    expect(resolveSlug(index, "%E0%A4%A")).toBeNull();
  });

  it("builds Hypixel wiki links from display names", () => {
    expect(hypixelWikiUrl("all_in_aloe", "All-in Aloe")).toBe("https://hypixelskyblock.minecraft.wiki/w/All-in_Aloe");
    expect(hypixelWikiUrl("red_mushroom", "Red Mushroom")).toBe("https://hypixelskyblock.minecraft.wiki/w/Mushroom");
    expect(hypixelWikiUrl("fire", "Fire")).toBeNull();
  });
});

describe("wiki recipes", () => {
  it("only references known items", () => {
    for (const id of Object.keys(data.mutations)) {
      for (const ingredient of getRecipeSource(data, id).ingredients) {
        expect(index.byId.has(ingredient), `${id} -> ${ingredient}`).toBe(true);
      }
    }
  });

  it("gives special-spawn mutations a note and keeps hidden prerequisites", () => {
    expect(getRecipeSource(data, "lonelily")).toMatchObject({ ingredients: [] });
    expect(getRecipeSource(data, "lonelily").note).toBeTruthy();
    expect(getRecipeSource(data, "shellfruit").ingredients).toEqual(["turtlellini", "blastberry"]);
    for (const [id, mutation] of Object.entries(data.mutations)) {
      if (mutation.special) expect(getRecipeSource(data, id).note, id).toBeTruthy();
    }
  });

  it("has no cycles", () => {
    const visit = (id: string, stack: string[]) => {
      expect(stack, `cycle via ${id}`).not.toContain(id);
      for (const child of getRecipeSource(data, id).ingredients) visit(child, [...stack, id]);
    };
    for (const id of Object.keys(data.mutations)) visit(id, []);
  });

  it("bottoms out in base crops or special spawns", () => {
    const leaves = collectBaseIngredients(data, "timestalk");
    expect(leaves.length).toBeGreaterThan(0);
    for (const leaf of leaves) expect(isLeaf(data, leaf)).toBe(true);
    expect(collectBaseIngredients(data, "dustgrain")).toEqual(["wheat"]);
  });

  it("collects every expandable node path for Expand all", () => {
    const paths = collectExpandablePaths(data, "duskbloom");
    // shadevine and dustgrain expand; moonflower and sunflower are base crops.
    expect(paths.sort()).toEqual(["duskbloom/dustgrain", "duskbloom/shadevine"]);
  });

  it("maps what each item is used in", () => {
    const usedIn = buildUsedInMap(data);
    expect(usedIn.get("gloomgourd")).toEqual(expect.arrayContaining(["chocoberry", "soggybud"]));
    expect(usedIn.get("blastberry")).toEqual(expect.arrayContaining(["startlevine", "shellfruit"]));
    expect(usedIn.get("timestalk")).toBeUndefined();
  });
});

describe("wiki static pages", () => {
  const template = `<!DOCTYPE html><html><head>
    <title>A</title>
    <meta name="description" content="site" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:title" content="site" />
    <meta property="og:image" content="https://example.com/shot.png" />
    <link rel="canonical" href="https://example.com/" />
    <title>B</title>
  </head><body><div id="root"></div><noscript>site</noscript><script type="module" src="/assets/app.js"></script></body></html>`;
  const pages = buildWikiStaticPages(template, data, "https://example.com");

  it("writes a page per item plus the wiki home", () => {
    expect(pages).toHaveLength(index.entries.length + 1);
    expect(pages[0].file).toBe("wiki.html");
    expect(pages.map((page) => page.file)).toContain("wiki/all-in-aloe.html");
  });

  it("sets per-item metadata and keeps the app shell", () => {
    const page = pages.find((p) => p.file === "wiki/gloomgourd.html")!;
    expect(page.url).toBe("https://example.com/wiki/gloomgourd");
    expect(page.html.match(/<title>/g)).toHaveLength(1);
    expect(page.html).toContain("<title>Gloomgourd - Greenhouse Wiki | SkyShards</title>");
    expect(page.html).toContain('<meta property="og:title" content="Gloomgourd - Greenhouse Wiki | SkyShards" />');
    expect(page.html).toContain('<meta property="og:image" content="https://example.com/greenhouse/crops/gloomgourd.png" />');
    expect(page.html).toContain('<link rel="canonical" href="https://example.com/wiki/gloomgourd" />');
    expect(page.html).not.toContain("og:image:width");
    expect(page.html).toMatch(
      /<meta name="description" content="Common 1x1 Greenhouse Mutation\n[^"]*Requires:\n• 1x Pumpkin\n• 1x Melon\n\n[^"]*Used in:\n• /,
    );
    expect(page.html).toContain("<h2>Requires</h2><ul><li>1x Pumpkin</li><li>1x Melon</li></ul>");
    expect(page.html).toContain('<script type="module" src="/assets/app.js"></script>');
    expect(page.html).toContain('<a href="https://example.com/wiki/soggybud">Soggybud</a>');
  });

  it("adds missing URLs to the sitemap once", () => {
    const sitemap = `<?xml version="1.0"?>\n<urlset>\n  <url><loc>https://example.com/a</loc></url>\n</urlset>\n`;
    const once = addToSitemap(sitemap, ["https://example.com/a", "https://example.com/b"], "2026-01-01T00:00:00+00:00");
    expect(once.match(/<loc>/g)).toHaveLength(2);
    expect(addToSitemap(once, ["https://example.com/b"], "x")).toBe(once);
  });
});

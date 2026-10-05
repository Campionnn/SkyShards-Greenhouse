// Build-time static pages for the wiki. For every crop and mutation the build
// writes dist/wiki/<slug>.html: the normal app shell with the item's own
// title, description, canonical URL, social preview tags and a plain-text
// summary for crawlers. Hosts serve /wiki/<slug> from it with a 200 (instead
// of the 404.html SPA fallback), and the app takes over once it loads.
//
// Pure string work (no DOM, no fs): vite.config.ts does the file I/O.

import type { GreenhouseDataJSON } from "../services/greenhouseDataService";
import { SITE_URL, WIKI_BASE_PATH, buildWikiIndex, wikiUrl } from "./slugs";
import type { WikiEntry } from "./slugs";
import { buildUsedInMap, getRecipeSource } from "./recipes";

export interface StaticPage {
  /** Path inside dist/, e.g. "wiki/gloomgourd.html". */
  file: string;
  url: string;
  html: string;
}

interface PageMeta {
  title: string;
  description: string;
  url: string;
  image: string;
  imageAlt: string;
  /** Summary card with a small image instead of the large site screenshot. */
  smallImage: boolean;
  bodyHtml: string;
}

export function buildWikiStaticPages(template: string, data: GreenhouseDataJSON, siteUrl: string = SITE_URL): StaticPage[] {
  const index = buildWikiIndex(data);
  const usedIn = buildUsedInMap(data);
  const nameOf = (id: string) => index.byId.get(id)?.name ?? id;

  const pages: StaticPage[] = index.entries.map((entry) => {
    const url = wikiUrl(entry.id, siteUrl);
    const description = describe(entry, data, usedIn, nameOf);
    return {
      file: `wiki/${entry.slug}.html`,
      url,
      html: applyMeta(template, {
        title: `${entry.name} - Greenhouse Wiki | SkyShards`,
        description,
        url,
        image: `${siteUrl}/greenhouse/crops/${entry.id}.png`,
        imageAlt: entry.name,
        smallImage: true,
        bodyHtml: `<h1>${escapeHtml(entry.name)}</h1><p>${escapeHtml(description)}</p>${linkList(
          "Ingredients",
          getRecipeSource(data, entry.id).ingredients,
          nameOf,
          siteUrl,
        )}${linkList("Used in", usedIn.get(entry.id) ?? [], nameOf, siteUrl)}`,
      }),
    };
  });

  const homeUrl = `${siteUrl}${WIKI_BASE_PATH}`;
  const homeDescription =
    "Every Hypixel SkyBlock Greenhouse crop and mutation: requirements, crafting trees, effects, decay, drops and what each one is used in.";
  pages.unshift({
    file: "wiki.html",
    url: homeUrl,
    html: applyMeta(template, {
      title: "Greenhouse Wiki - Every Crop & Mutation | SkyShards",
      description: homeDescription,
      url: homeUrl,
      image: extractMeta(template, "property", "og:image") ?? `${siteUrl}/favicon/favicon.png`,
      imageAlt: "SkyShards Greenhouse Wiki",
      smallImage: false,
      bodyHtml: `<h1>Greenhouse Wiki</h1><p>${escapeHtml(homeDescription)}</p>${linkList(
        "All crops and mutations",
        index.entries.map((entry) => entry.id),
        nameOf,
        siteUrl,
      )}`,
    }),
  });

  return pages;
}

/** Adds <url> entries to a sitemap, skipping URLs already listed. */
export function addToSitemap(sitemap: string, urls: string[], lastmod: string): string {
  const missing = urls.filter((url) => !sitemap.includes(`<loc>${url}</loc>`));
  if (missing.length === 0) return sitemap;
  const entries = missing
    .map(
      (url) =>
        `  <url>\n    <loc>${url}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.6</priority>\n  </url>\n`,
    )
    .join("");
  return sitemap.replace(/<\/urlset>\s*$/, `${entries}</urlset>\n`);
}

function describe(
  entry: WikiEntry,
  data: GreenhouseDataJSON,
  usedIn: Map<string, string[]>,
  nameOf: (id: string) => string,
): string {
  const parts: string[] = [];
  const mutation = data.mutations[entry.id];
  const item = mutation ?? data.crops[entry.id];
  const size = `${item.size}x${item.size}`;

  if (mutation) {
    parts.push(`${humanize(mutation.rarity)} ${size} Greenhouse Mutation.`);
    const source = getRecipeSource(data, entry.id);
    if (mutation.requirements.length > 0) {
      parts.push(`Requires ${mutation.requirements.map((req) => `${req.count}x ${nameOf(req.crop)}`).join(", ")}.`);
    }
    if (source.note) parts.push(source.note);
  } else {
    parts.push(`${size} Greenhouse Crop.`);
  }

  if (item.positive_buffs.length > 0) parts.push(`Positive Effects: ${item.positive_buffs.map(humanize).join(", ")}.`);
  if (item.negative_buffs.length > 0) parts.push(`Negative Effects: ${item.negative_buffs.map(humanize).join(", ")}.`);
  const users = (usedIn.get(entry.id) ?? []).map(nameOf);
  if (users.length > 0) parts.push(`Used in ${joinNames(users)} ${users.length === 1 ? "mutation" : "mutations"}.`);
  return parts.join(" ");
}

/** "A", "A and B", "A, B and C". */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function applyMeta(template: string, meta: PageMeta): string {
  let html = template;
  // The template has more than one <title>; keep a single one.
  html = html.replace(/<title>[\s\S]*?<\/title>\s*/g, "");
  html = html.replace(/<head>/, `<head>\n    <title>${escapeHtml(meta.title)}</title>`);

  html = setMeta(html, "name", "description", meta.description);
  html = setMeta(html, "property", "og:type", "article");
  html = setMeta(html, "property", "og:url", meta.url);
  html = setMeta(html, "property", "og:title", meta.title);
  html = setMeta(html, "property", "og:description", meta.description);
  html = setMeta(html, "property", "og:image", meta.image);
  html = setMeta(html, "property", "og:image:alt", meta.imageAlt);
  html = setMeta(html, "property", "twitter:url", meta.url);
  html = setMeta(html, "property", "twitter:title", meta.title);
  html = setMeta(html, "property", "twitter:description", meta.description);
  html = setMeta(html, "property", "twitter:image", meta.image);
  if (meta.smallImage) {
    html = setMeta(html, "property", "twitter:card", "summary");
    // The site screenshot dimensions don't apply to crop icons.
    html = removeMeta(html, "property", "og:image:width");
    html = removeMeta(html, "property", "og:image:height");
  }
  html = html.replace(/<link rel="canonical" href="[^"]*"\s*\/?>/, `<link rel="canonical" href="${escapeAttr(meta.url)}" />`);
  html = html.replace(/<noscript>[\s\S]*?<\/noscript>/, `<noscript>\n      <div style="padding: 2rem; font-family: Arial, sans-serif">${meta.bodyHtml}</div>\n    </noscript>`);
  return html;
}

function metaPattern(attr: "name" | "property", key: string): RegExp {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`<meta\\s+${attr}="${escapedKey}"\\s+content="[^"]*"\\s*\\/?>`);
}

function setMeta(html: string, attr: "name" | "property", key: string, value: string): string {
  const tag = `<meta ${attr}="${key}" content="${escapeAttr(value)}" />`;
  const pattern = metaPattern(attr, key);
  return pattern.test(html) ? html.replace(pattern, () => tag) : html.replace(/<\/head>/, `  ${tag}\n  </head>`);
}

function removeMeta(html: string, attr: "name" | "property", key: string): string {
  return html.replace(new RegExp(`\\s*${metaPattern(attr, key).source}`), "");
}

function extractMeta(html: string, attr: "name" | "property", key: string): string | null {
  const match = html.match(metaPattern(attr, key));
  return match ? (match[0].match(/content="([^"]*)"/)?.[1] ?? null) : null;
}

function linkList(heading: string, ids: string[], nameOf: (id: string) => string, siteUrl: string): string {
  if (ids.length === 0) return "";
  const items = ids.map((id) => `<li><a href="${escapeAttr(wikiUrl(id, siteUrl))}">${escapeHtml(nameOf(id))}</a></li>`).join("");
  return `<h2>${escapeHtml(heading)}</h2><ul>${items}</ul>`;
}

function humanize(id: string): string {
  return id
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

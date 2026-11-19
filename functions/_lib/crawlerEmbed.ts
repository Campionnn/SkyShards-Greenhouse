// Pure parts of the crawler-embed Pages Function (functions/_middleware.ts):
// which requests get a dynamic Discord card, which API payload they need, and
// what the HTML rewrite changes. No Workers APIs here, so vitest can run it
// (src/seo/crawlerEmbed.test.ts).
//
// Flow, layout and simulator links are one page per flow / layout code, so
// they can't be prerendered like the wiki: for link-preview crawlers the
// function fetches the card the API builds for share links
// (GET {API}/share/flow/{id}/embed.json, /share/layout/{code}/embed.json,
// research/discord-embeds/CONTRACT.md) and inlines it into the static page.

import { serializeComponentEmbed, utf8Bytes, validateComponentEmbed, EMBED_MAX_BYTES } from "../../src/wiki/componentEmbed";
import type { Container } from "../../src/wiki/componentEmbed";

export const DEFAULT_API_ORIGIN = "https://api.skyshards.com";
/** The whole crawl, images included, must finish in 10 s; leave the page most of it. */
export const API_TIMEOUT_MS = 3000;

/** EMBED_TIMEOUT_MS from the environment, clamped to 500-8000 ms; the default when unset or invalid. */
export function timeoutFrom(raw: string | undefined | null): number {
  const value = Number(raw);
  if (!raw || !Number.isFinite(value)) return API_TIMEOUT_MS;
  return Math.min(8000, Math.max(500, Math.round(value)));
}

/** Link-preview crawlers. Only Discord reads the component embed; the rest get the OG override. */
const CRAWLER_UA = /discordbot|twitterbot|slackbot|facebookexternalhit|telegrambot|whatsapp|linkedinbot|embedly|redditbot|mastodon/i;
const DISCORD_UA = /discordbot/i;

export interface Crawler {
  /** Discordbot: inject the component embed as well as the OG tags. */
  discord: boolean;
}

export function crawlerFor(userAgent: string | null | undefined): Crawler | null {
  if (!userAgent || !CRAWLER_UA.test(userAgent)) return null;
  return { discord: DISCORD_UA.test(userAgent) };
}

/** Flow ids are 12 alphanumerics (routes/share.py _visible_flow_entry). */
const FLOW_ID = /^[A-Za-z0-9]{12}$/;
/** Layout codes: URL-safe base64 without padding (routes/share.py _LAYOUT_CODE_RE). */
const LAYOUT_CODE = /^[A-Za-z0-9_-]{1,4096}$/;
/** The flow page's view (?board=&kit=&tier=&every=&tab=), forwarded to the API so the numbers match. */
export const FLOW_VIEW_PARAMS = ["board", "kit", "tier", "every", "tab"] as const;

export interface EmbedPlan {
  kind: "flow" | "layout";
  /** API path + query, e.g. "/share/flow/abc123def456/embed.json?board=ironman". */
  apiPath: string;
  /** The page the crawler asked for: becomes og:url. */
  pageUrl: string;
  /**
   * Pretty path of the static page to rewrite, when it isn't the request's own
   * (/flows/:id is index.html via the _redirects "/flows/* / 200" rule; fetching
   * "/" from the asset server directly gives that file with a 200 for certain).
   */
  assetPath: string | null;
}

/** The layout code in a ?p1= / ?layout= value: a raw code, a designer URL or a share URL. */
export function layoutCodeFrom(raw: string | null): string | null {
  if (!raw) return null;
  let value = raw.trim();
  const fromQuery = value.match(/[?&]layout=([^&#]+)/);
  const fromShare = value.match(/\/share\/([^/?#]+)/);
  if (fromQuery) value = fromQuery[1];
  else if (fromShare) value = fromShare[1];
  return LAYOUT_CODE.test(value) ? value : null;
}

function flowPlan(id: string, url: URL, assetPath: string | null): EmbedPlan {
  const view = new URLSearchParams();
  for (const key of FLOW_VIEW_PARAMS) {
    const value = url.searchParams.get(key);
    if (value !== null && value.length <= 32) view.set(key, value);
  }
  const query = view.toString();
  return {
    kind: "flow",
    apiPath: `/share/flow/${id}/embed.json${query ? `?${query}` : ""}`,
    pageUrl: url.toString(),
    assetPath,
  };
}

function layoutPlan(code: string, url: URL): EmbedPlan {
  return { kind: "layout", apiPath: `/share/layout/${code}/embed.json`, pageUrl: url.toString(), assetPath: null };
}

/**
 * What a crawler's request needs, or null for every page without a dynamic card:
 *   /flows/:id                      -> the flow's card (view params forwarded)
 *   /designer?layout=CODE           -> the layout's card
 *   /simulator?flow=ID              -> the flow's card (board forwarded)
 *   /simulator?p1=CODE              -> the first plot's layout card
 */
export function planFor(input: string | URL): EmbedPlan | null {
  const url = typeof input === "string" ? new URL(input) : input;
  const path = url.pathname.replace(/\/+$/, "") || "/";

  const flow = path.match(/^\/flows\/([^/]+)$/);
  if (flow) {
    let id = flow[1];
    try {
      id = decodeURIComponent(id);
    } catch {
      return null;
    }
    return FLOW_ID.test(id) && id !== "admin" ? flowPlan(id, url, "/") : null;
  }

  if (path === "/designer") {
    const code = layoutCodeFrom(url.searchParams.get("layout"));
    return code ? layoutPlan(code, url) : null;
  }

  if (path === "/simulator") {
    const flowId = url.searchParams.get("flow");
    if (flowId && FLOW_ID.test(flowId)) return flowPlan(flowId, url, null);
    const code = layoutCodeFrom(url.searchParams.get("p1"));
    return code ? layoutPlan(code, url) : null;
  }

  return null;
}

export interface OgOverride {
  title?: string | null;
  description?: string | null;
  image?: string | null;
  url?: string | null;
}

export interface EmbedPayload {
  component: Container;
  og: OgOverride;
}

const isHttpUrl = (value: unknown): value is string => typeof value === "string" && /^https?:\/\/\S+$/.test(value) && value.length <= 2048;
const cleanText = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;

/**
 * The API's embed.json, checked: the component passes every Discord rule
 * (else it is dropped and only OG is applied), OG fields are strings / http URLs.
 * Null when there is nothing usable at all.
 */
export function parsePayload(raw: unknown): { component: Container | null; json: string | null; og: OgOverride } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  let component: Container | null = null;
  let json: string | null = null;
  if (record.component !== undefined) {
    const candidate = record.component as Container;
    const serialized = (() => {
      try {
        return serializeComponentEmbed(candidate);
      } catch {
        return null;
      }
    })();
    if (serialized && utf8Bytes(serialized) <= EMBED_MAX_BYTES && validateComponentEmbed({ component: candidate }, serialized).length === 0) {
      component = candidate;
      json = serialized;
    }
  }
  const ogRaw = typeof record.og === "object" && record.og !== null ? (record.og as Record<string, unknown>) : {};
  const og: OgOverride = {
    title: cleanText(ogRaw.title, 200),
    description: cleanText(ogRaw.description, 1000),
    image: isHttpUrl(ogRaw.image) ? ogRaw.image : null,
    url: isHttpUrl(ogRaw.url) ? ogRaw.url : null,
  };
  if (!component && !og.title && !og.description && !og.image) return null;
  return { component, json, og };
}

/** One change to the page's <head>. */
export type HeadEdit =
  | { op: "setTitle"; text: string }
  | { op: "setMeta"; attr: "name" | "property"; key: string; content: string }
  | { op: "removeMeta"; attr: "name" | "property"; key: string }
  | { op: "removeEmbedScript" }
  | { op: "appendToHead"; html: string };

/**
 * Everything the rewrite does to the static page's <head>:
 *   - title / description / image / url in the <title>, OG and Twitter tags
 *     (og:url: the payload's canonical URL, else the page the crawler asked for),
 *   - the site screenshot's width/height go (they don't describe the new image),
 *   - the static component embed (the page's own card) is removed, and for
 *     Discord the dynamic one appended, so there is exactly one.
 * Fields the payload doesn't have keep their static values.
 */
export function rewritePlan(payload: { json: string | null; og: OgOverride }, pageUrl: string, crawler: Crawler): HeadEdit[] {
  const edits: HeadEdit[] = [];
  const { title, description, image } = payload.og;
  if (title) {
    edits.push({ op: "setTitle", text: title });
    for (const key of ["og:title", "twitter:title"]) edits.push({ op: "setMeta", attr: "property", key, content: title });
    edits.push({ op: "setMeta", attr: "property", key: "og:image:alt", content: title });
  }
  if (description) {
    edits.push({ op: "setMeta", attr: "name", key: "description", content: description });
    for (const key of ["og:description", "twitter:description"]) edits.push({ op: "setMeta", attr: "property", key, content: description });
  }
  if (image) {
    for (const key of ["og:image", "twitter:image"]) edits.push({ op: "setMeta", attr: "property", key, content: image });
    edits.push({ op: "removeMeta", attr: "property", key: "og:image:width" });
    edits.push({ op: "removeMeta", attr: "property", key: "og:image:height" });
  }
  // The API's canonical page URL (view params kept, tracking params dropped), else the requested one.
  const url = payload.og.url ?? pageUrl;
  for (const key of ["og:url", "twitter:url"]) edits.push({ op: "setMeta", attr: "property", key, content: url });
  edits.push({ op: "removeEmbedScript" });
  if (crawler.discord && payload.json) {
    edits.push({ op: "appendToHead", html: `<script id="discord:component-embed" type="application/json">${payload.json}</script>` });
  }
  return edits;
}

/** The same edits applied to an HTML string (tests, and a fallback where HTMLRewriter is missing). */
export function applyEditsToString(html: string, edits: HeadEdit[]): string {
  const attrEscape = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const metaRe = (attr: string, key: string) =>
    new RegExp(`<meta\\s+${attr}="${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s+content="[^"]*"\\s*\\/?>`, "g");
  let out = html;
  for (const edit of edits) {
    switch (edit.op) {
      case "setTitle":
        out = out.replace(/<title>[\s\S]*?<\/title>/g, () => `<title>${attrEscape(edit.text)}</title>`);
        break;
      case "setMeta":
        out = out.replace(metaRe(edit.attr, edit.key), () => `<meta ${edit.attr}="${edit.key}" content="${attrEscape(edit.content)}" />`);
        break;
      case "removeMeta":
        out = out.replace(metaRe(edit.attr, edit.key), "");
        break;
      case "removeEmbedScript":
        out = out.replace(/<script id="discord:component-embed"[^>]*>[\s\S]*?<\/script>/g, "");
        break;
      case "appendToHead":
        out = out.replace(/<\/head>/, () => `${edit.html}</head>`);
        break;
    }
  }
  return out;
}

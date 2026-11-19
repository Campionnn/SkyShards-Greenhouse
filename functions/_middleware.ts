// Cloudflare Pages middleware: dynamic Discord / Open Graph cards for the pages
// that can't be prerendered (one per flow or layout). Only link-preview
// crawlers are touched; everyone else gets `context.next()` untouched, and
// public/_routes.json keeps this function off every other path (assets, wiki,
// tools) so it costs nothing there.
//
//   crawler GET /flows/:id?view        -> index.html + the flow's card
//   crawler GET /designer?layout=CODE  -> designer.html + the layout's card
//   crawler GET /simulator?flow=ID|p1= -> simulator.html + the flow's / layout's card
//
// The card comes from the API (GET {API_ORIGIN}/share/.../embed.json, see
// functions/_lib/crawlerEmbed.ts). Fail open: an unknown flow, an API error, a
// payload that breaks Discord's rules or a 3 s timeout all return the static
// page as it is (with its generic OG tags and home/tool card).
//
// Env (all optional): API_ORIGIN (default https://api.skyshards.com; e.g.
// http://127.0.0.1:8000 for `wrangler pages dev`), EMBED_TIMEOUT_MS (default
// 3000, clamped to 500-8000: Discord gives the whole crawl, images included, 10 s).

import { DEFAULT_API_ORIGIN, timeoutFrom, crawlerFor, parsePayload, planFor, rewritePlan } from "./_lib/crawlerEmbed";
import type { HeadEdit } from "./_lib/crawlerEmbed";

// Minimal Workers types (the project doesn't depend on @cloudflare/workers-types).
interface Element {
  setAttribute(name: string, value: string): void;
  setInnerContent(content: string, options?: { html?: boolean }): void;
  append(content: string, options?: { html?: boolean }): void;
  remove(): void;
}
interface HTMLRewriterInstance {
  on(selector: string, handlers: { element(element: Element): void }): HTMLRewriterInstance;
  transform(response: Response): Response;
}
declare const HTMLRewriter: { new (): HTMLRewriterInstance };

interface Env {
  API_ORIGIN?: string;
  EMBED_TIMEOUT_MS?: string;
  ASSETS: { fetch(input: Request | string | URL): Promise<Response> };
}

interface PagesContext {
  request: Request;
  env: Env;
  next(input?: Request | string, init?: RequestInit): Promise<Response>;
}

async function fetchPayload(apiUrl: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(apiUrl, {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": "SkyShards-Greenhouse-Pages (link preview)" },
    });
    if (!response.ok) return null;
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function selectorFor(attr: "name" | "property", key: string): string {
  return `meta[${attr}="${key}"]`;
}

function applyEdits(response: Response, edits: HeadEdit[]): Response {
  let rewriter = new HTMLRewriter();
  for (const edit of edits) {
    switch (edit.op) {
      case "setTitle":
        rewriter = rewriter.on("title", { element: (el) => el.setInnerContent(edit.text) });
        break;
      case "setMeta":
        rewriter = rewriter.on(selectorFor(edit.attr, edit.key), { element: (el) => el.setAttribute("content", edit.content) });
        break;
      case "removeMeta":
        rewriter = rewriter.on(selectorFor(edit.attr, edit.key), { element: (el) => el.remove() });
        break;
      case "removeEmbedScript":
        rewriter = rewriter.on('script[id="discord:component-embed"]', { element: (el) => el.remove() });
        break;
      case "appendToHead":
        rewriter = rewriter.on("head", { element: (el) => el.append(edit.html, { html: true }) });
        break;
    }
  }
  return rewriter.transform(response);
}

export const onRequest = async (context: PagesContext): Promise<Response> => {
  const { request, env } = context;
  if (request.method !== "GET") return context.next();
  const crawler = crawlerFor(request.headers.get("User-Agent"));
  if (!crawler) return context.next();

  let plan;
  try {
    plan = planFor(request.url);
  } catch {
    plan = null;
  }
  if (!plan) return context.next();

  const origin = (env.API_ORIGIN || DEFAULT_API_ORIGIN).replace(/\/+$/, "");
  // The page and the card in parallel; the page alone if anything goes wrong.
  const pagePromise = plan.assetPath ? env.ASSETS.fetch(new URL(plan.assetPath, request.url)) : context.next();
  const payloadPromise = fetchPayload(`${origin}${plan.apiPath}`, timeoutFrom(env.EMBED_TIMEOUT_MS)).catch(() => null);

  const page = await pagePromise;
  try {
    const type = page.headers.get("Content-Type") ?? "";
    if (page.status !== 200 || !type.includes("text/html")) return page;
    const payload = parsePayload(await payloadPromise);
    if (!payload) return page;
    const rewritten = applyEdits(page, rewritePlan(payload, plan.pageUrl, crawler));
    const headers = new Headers(rewritten.headers);
    // Not the static file any more: no validators, no caching of the crawler variant.
    headers.delete("ETag");
    headers.delete("Last-Modified");
    headers.delete("Content-Length");
    headers.set("Cache-Control", "no-store");
    headers.append("Vary", "User-Agent");
    return new Response(rewritten.body, { status: 200, headers });
  } catch {
    return page;
  }
};

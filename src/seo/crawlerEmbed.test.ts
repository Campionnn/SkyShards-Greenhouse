// Tests for the pure parts of the Cloudflare Pages middleware (functions/_middleware.ts).
import { describe, expect, it } from "vitest";
import {
  applyEditsToString,
  crawlerFor,
  layoutCodeFrom,
  parsePayload,
  planFor,
  rewritePlan,
  timeoutFrom,
} from "../../functions/_lib/crawlerEmbed";
import { buttons, container, linkButton, serializeComponentEmbed, text } from "../wiki/componentEmbed";

const DISCORD_UA = "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)";
const CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const SITE = "https://greenhouse.skyshards.com";

describe("crawler detection", () => {
  it("matches link-preview crawlers only", () => {
    expect(crawlerFor(DISCORD_UA)).toEqual({ discord: true });
    expect(crawlerFor("Discordbot/2.0")).toEqual({ discord: true });
    expect(crawlerFor("Twitterbot/1.0")).toEqual({ discord: false });
    expect(crawlerFor("Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)")).toEqual({ discord: false });
    expect(crawlerFor("facebookexternalhit/1.1")).toEqual({ discord: false });
    expect(crawlerFor(CHROME_UA)).toBeNull();
    expect(crawlerFor("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBeNull();
    expect(crawlerFor("")).toBeNull();
    expect(crawlerFor(null)).toBeNull();
  });
});

describe("timeout", () => {
  it("defaults to 3 s and clamps the env value", () => {
    expect(timeoutFrom(undefined)).toBe(3000);
    expect(timeoutFrom("abc")).toBe(3000);
    expect(timeoutFrom("9000")).toBe(8000);
    expect(timeoutFrom("10")).toBe(500);
    expect(timeoutFrom("2500")).toBe(2500);
  });
});

describe("request plans", () => {
  it("maps flow pages to the flow card and forwards only the view params", () => {
    const plan = planFor(`${SITE}/flows/AbC123dEf456?board=ironman&tier=max&every=2&tab=proof&kit=1&utm_source=x`);
    expect(plan).toEqual({
      kind: "flow",
      apiPath: "/share/flow/AbC123dEf456/embed.json?board=ironman&kit=1&tier=max&every=2&tab=proof",
      pageUrl: `${SITE}/flows/AbC123dEf456?board=ironman&tier=max&every=2&tab=proof&kit=1&utm_source=x`,
      assetPath: "/",
    });
    expect(planFor(`${SITE}/flows/AbC123dEf456/`)?.apiPath).toBe("/share/flow/AbC123dEf456/embed.json");
  });

  it("ignores flow paths that can't be flow ids", () => {
    expect(planFor(`${SITE}/flows/admin`)).toBeNull();
    expect(planFor(`${SITE}/flows/short`)).toBeNull();
    expect(planFor(`${SITE}/flows/AbC123dEf456/extra`)).toBeNull();
    expect(planFor(`${SITE}/flows/..%2F..%2Fetc12`)).toBeNull();
    expect(planFor(`${SITE}/flows`)).toBeNull();
  });

  it("maps designer and simulator links to the layout or flow card", () => {
    expect(planFor(`${SITE}/designer?layout=eJx_abc-12`)).toMatchObject({
      kind: "layout",
      apiPath: "/share/layout/eJx_abc-12/embed.json",
      assetPath: null,
    });
    expect(planFor(`${SITE}/designer`)).toBeNull();
    expect(planFor(`${SITE}/designer?layout=bad%20code`)).toBeNull();
    expect(planFor(`${SITE}/simulator?p1=eJxabc&p2=zzz`)?.apiPath).toBe("/share/layout/eJxabc/embed.json");
    expect(planFor(`${SITE}/simulator?flow=AbC123dEf456&board=normal`)).toMatchObject({
      kind: "flow",
      apiPath: "/share/flow/AbC123dEf456/embed.json?board=normal",
      assetPath: null,
    });
    expect(planFor(`${SITE}/simulator`)).toBeNull();
    expect(planFor(`${SITE}/wiki/gloomgourd`)).toBeNull();
    expect(planFor(`${SITE}/`)).toBeNull();
  });

  it("extracts layout codes like the simulator does", () => {
    expect(layoutCodeFrom("abc_DEF-9")).toBe("abc_DEF-9");
    expect(layoutCodeFrom(`${SITE}/designer?layout=abc123`)).toBe("abc123");
    expect(layoutCodeFrom("https://api.skyshards.com/share/abc123")).toBe("abc123");
    expect(layoutCodeFrom("<script>")).toBeNull();
    expect(layoutCodeFrom("")).toBeNull();
    expect(layoutCodeFrom(null)).toBeNull();
  });
});

describe("payload and rewrite", () => {
  const component = container([text("## My flow\n-# by Ke5o · 3 plots"), buttons([linkButton("Open", `${SITE}/flows/x`)])]);
  const og = {
    title: "My flow",
    description: "by Ke5o\n3 plots",
    image: "https://api.skyshards.com/share/flow/AbC123dEf456/plots.png",
    url: `${SITE}/flows/AbC123dEf456`,
  };

  it("accepts a valid payload and drops an invalid component but keeps OG", () => {
    const parsed = parsePayload({ component, og });
    expect(parsed?.component).toEqual(component);
    expect(parsed?.json).toBe(serializeComponentEmbed(component));

    const bad = parsePayload({ component: { type: 17, components: [{ type: 2, style: 1, label: "x", custom_id: "y" }] }, og });
    expect(bad?.component).toBeNull();
    expect(bad?.og.title).toBe("My flow");

    const huge = parsePayload({ component: container([text("x".repeat(3100))]), og: {} });
    expect(huge).toBeNull();
    expect(parsePayload(null)).toBeNull();
    expect(parsePayload("nope")).toBeNull();
    expect(parsePayload({ og: { image: "javascript:alert(1)" } })).toBeNull();
  });

  const page = `<html><head>
<title>Home</title>
<meta name="description" content="site" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:url" content="${SITE}/" />
<meta property="og:title" content="Home" />
<meta property="og:description" content="site" />
<meta property="og:image" content="${SITE}/shot.png" />
<meta property="twitter:url" content="${SITE}/" />
<meta property="twitter:title" content="Home" />
<meta property="twitter:description" content="site" />
<meta property="twitter:image" content="${SITE}/shot.png" />
<script id="discord:component-embed" type="application/json">{"component":{"type":17,"components":[{"type":10,"content":"home"}]}}</script>
</head><body></body></html>`;

  it("overrides OG, swaps the static card for the dynamic one for Discord", () => {
    const pageUrl = `${SITE}/flows/AbC123dEf456?board=ironman`;
    const parsed = parsePayload({ component, og })!;
    const html = applyEditsToString(page, rewritePlan(parsed, pageUrl, { discord: true }));
    expect(html).toContain("<title>My flow</title>");
    expect(html).toContain('<meta property="og:title" content="My flow" />');
    expect(html).toContain('<meta property="og:description" content="by Ke5o\n3 plots" />');
    expect(html).toContain(`<meta property="og:image" content="${og.image}" />`);
    // The payload's canonical URL wins over the requested one.
    expect(html).toContain(`<meta property="og:url" content="${SITE}/flows/AbC123dEf456" />`);
    expect(html).not.toContain("og:image:width");
    expect(html).not.toContain('"content":"home"');
    const scripts = html.match(/<script id="discord:component-embed"[^>]*>[^<]*<\/script>/g) ?? [];
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toContain(serializeComponentEmbed(component));
  });

  it("only overrides OG for other crawlers and keeps fields the payload lacks", () => {
    const parsed = parsePayload({ component, og: { title: "Only title" } })!;
    const html = applyEditsToString(page, rewritePlan(parsed, `${SITE}/designer?layout=abc`, { discord: false }));
    expect(html).toContain('<meta property="og:title" content="Only title" />');
    expect(html).toContain(`<meta property="og:image" content="${SITE}/shot.png" />`);
    expect(html).toContain('<meta property="og:image:width" content="1200" />');
    expect(html).toContain(`<meta property="og:url" content="${SITE}/designer?layout=abc" />`);
    expect(html).not.toContain("discord:component-embed");
  });

  it("escapes attribute values", () => {
    const parsed = parsePayload({ og: { title: 'A "flow" <b>&' } })!;
    const html = applyEditsToString(page, rewritePlan(parsed, `${SITE}/flows/AbC123dEf456`, { discord: true }));
    expect(html).toContain('content="A &quot;flow&quot; &lt;b&gt;&amp;"');
  });
});

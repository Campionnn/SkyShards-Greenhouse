// The Discord component embeds of the build-time pages (src/wiki/staticPages.ts):
// one card per wiki item and a small branded card for the main tool pages.
// Layout follows research/discord-embeds/CONTRACT.md: `## Title` + `-# meta`
// subtext, one fact per line, separators between blocks, at most three link
// buttons with the primary one first, go-emerald accent.
//
// Pure (no DOM, no fs): vite.config.ts and the tests import it.

import type { GreenhouseDataJSON } from "../services/greenhouseDataService";
import { SITE_URL, WIKI_BASE_PATH, wikiUrl } from "./slugs";
import type { WikiEntry } from "./slugs";
import { getRecipeSource } from "./recipes";
import {
  buttons,
  container,
  escapeMarkdown,
  gallery,
  linkButton,
  mdLink,
  section,
  separator,
  text,
  thumbnail,
  truncatedList,
  validateComponentEmbed,
} from "./componentEmbed";
import type { Container, ContainerChild } from "./componentEmbed";

/** Brand mark used as the thumbnail of the tool cards when there is no screenshot. */
export const BRAND_ICON_PATH = "/brand/aloe-aqua.png";

const titleCase = (id: string) =>
  id
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

const sentenceCase = (id: string) => {
  const words = id.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** Detail levels tried in order until the payload fits Discord's limits. */
interface ItemDetail {
  /** Item names in "Requires" / "Used in" link to their wiki pages. */
  links: boolean;
  /** How many "Used in" items are listed before "+ N more". */
  usedIn: number;
}

const ITEM_DETAIL_LEVELS: ItemDetail[] = [
  { links: true, usedIn: 8 },
  { links: true, usedIn: 4 },
  { links: false, usedIn: 8 },
  { links: false, usedIn: 3 },
  { links: false, usedIn: 0 },
];

/**
 * The card of one wiki item: name + rarity/size/ground with its icon, what it
 * needs, its effects, what it is used in, and buttons into the wiki and tools.
 * Returns the richest variant that passes validateComponentEmbed.
 */
export function wikiItemEmbed(
  entry: WikiEntry,
  data: GreenhouseDataJSON,
  usedIn: Map<string, string[]>,
  siteUrl: string = SITE_URL,
): Container {
  let last: Container | null = null;
  for (const detail of ITEM_DETAIL_LEVELS) {
    last = buildItemCard(entry, data, usedIn, siteUrl, detail);
    if (validateComponentEmbed({ component: last }).length === 0) return last;
  }
  return last!;
}

function buildItemCard(
  entry: WikiEntry,
  data: GreenhouseDataJSON,
  usedIn: Map<string, string[]>,
  siteUrl: string,
  detail: ItemDetail,
): Container {
  const mutation = data.mutations[entry.id];
  const item = mutation ?? data.crops[entry.id];
  const nameOf = (id: string) => data.mutations[id]?.name ?? data.crops[id]?.name ?? id;
  const ref = (id: string) => (detail.links ? mdLink(nameOf(id), wikiUrl(id, siteUrl)) : escapeMarkdown(nameOf(id)));
  const effectName = (id: string) => escapeMarkdown(data.effects[id]?.name ?? titleCase(id));

  const size = `${item.size}×${item.size}`;
  const kind = mutation ? `${sentenceCase(mutation.rarity)} ${size} mutation` : `${size} crop`;
  const meta = [kind, item.ground ? sentenceCase(item.ground) : null].filter(Boolean).join(" · ");
  const header = [`## ${escapeMarkdown(entry.name)}`, `-# ${meta}`].join("\n");

  const headerTexts = [header];
  if (mutation) {
    const source = getRecipeSource(data, entry.id);
    const lines = mutation.requirements.map((req) => `**${req.count}×** ${ref(req.crop)}`);
    if (source.note) lines.push(escapeMarkdown(source.note));
    if (lines.length > 0) headerTexts.push(`**Requires**\n${lines.join("\n")}`);
  }

  const children: ContainerChild[] = [section(headerTexts, thumbnail(`${siteUrl}/greenhouse/crops/${entry.id}.png`, entry.name))];

  const effectLines: string[] = [];
  if (item.positive_buffs.length > 0) effectLines.push(`**Positive** ${item.positive_buffs.map(effectName).join(", ")}`);
  if (item.negative_buffs.length > 0) effectLines.push(`**Negative** ${item.negative_buffs.map(effectName).join(", ")}`);
  const users = usedIn.get(entry.id) ?? [];
  const body: string[] = [];
  if (effectLines.length > 0) body.push(effectLines.join("\n"));
  if (users.length > 0) {
    body.push(
      detail.usedIn > 0
        ? `**Used in** ${truncatedList(users.map(ref), detail.usedIn)}`
        : `**Used in** ${users.length} ${users.length === 1 ? "mutation" : "mutations"}`,
    );
  }
  if (body.length > 0) children.push(separator(), text(body.join("\n")));

  const row = [linkButton("Open in wiki", wikiUrl(entry.id, siteUrl))];
  if (mutation) row.push(linkButton("Calculator", `${siteUrl}/calculator`));
  row.push(linkButton("Designer", `${siteUrl}/designer`));
  children.push(separator(), buttons(row));

  return container(children);
}

/** The tool pages that get a branded card; the rest (about, contact, privacy) keep only OG. */
export const ROUTE_EMBED_PATHS = ["/", "/simulator", "/calculator", "/designer", "/guide", WIKI_BASE_PATH] as const;
export type RouteEmbedPath = (typeof ROUTE_EMBED_PATHS)[number];

interface RouteCard {
  title: string;
  meta: string;
  /** [label, path]; the first is the page itself. */
  buttons: [string, string][];
}

function routeCards(data: GreenhouseDataJSON): Record<RouteEmbedPath, RouteCard> {
  const crops = Object.keys(data.crops).length;
  const mutations = Object.keys(data.mutations).length;
  return {
    "/": {
      title: "SkyShards Greenhouse",
      meta: "Layouts simulated by the server · ranked by coins per day",
      buttons: [
        ["Leaderboard", "/"],
        ["Simulator", "/simulator"],
        ["Designer", "/designer"],
      ],
    },
    "/simulator": {
      title: "Greenhouse simulator",
      meta: "Cycle by cycle · up to 3 plots · scriptable",
      buttons: [
        ["Open simulator", "/simulator"],
        ["Leaderboard", "/"],
        ["Designer", "/designer"],
      ],
    },
    "/calculator": {
      title: "Mutation calculator",
      meta: `${mutations} mutations · auto-solves the best placement`,
      buttons: [
        ["Open calculator", "/calculator"],
        ["Designer", "/designer"],
        ["Wiki", WIKI_BASE_PATH],
      ],
    },
    "/designer": {
      title: "Layout designer",
      meta: "Checks which mutations a layout satisfies · share it with a link",
      buttons: [
        ["Open designer", "/designer"],
        ["Calculator", "/calculator"],
        ["Simulator", "/simulator"],
      ],
    },
    "/guide": {
      title: "Rose Dragon guide",
      meta: "Plot by plot · based on what you own",
      buttons: [
        ["Open guide", "/guide"],
        ["Simulator", "/simulator"],
        ["Leaderboard", "/"],
      ],
    },
    [WIKI_BASE_PATH]: {
      title: "Greenhouse wiki",
      meta: `${crops} crops · ${mutations} mutations · requirements, effects and drops`,
      buttons: [
        ["Open wiki", WIKI_BASE_PATH],
        ["Calculator", "/calculator"],
        ["Designer", "/designer"],
      ],
    },
  };
}

export function isRouteEmbedPath(path: string): path is RouteEmbedPath {
  return (ROUTE_EMBED_PATHS as readonly string[]).includes(path);
}

/**
 * A tool page's card: title and one data line, the site screenshot in a gallery
 * when there is one (else the brand mark as a thumbnail), and links to the tools.
 */
export function routeEmbed(
  path: RouteEmbedPath,
  data: GreenhouseDataJSON,
  options: { siteUrl?: string; screenshotUrl?: string | null } = {},
): Container {
  const siteUrl = options.siteUrl ?? SITE_URL;
  const card = routeCards(data)[path];
  const header = `## ${escapeMarkdown(card.title)}\n-# ${escapeMarkdown(card.meta)}`;
  const top: ContainerChild[] = options.screenshotUrl
    ? [text(header), gallery([{ url: options.screenshotUrl, description: card.title }])]
    : [section(header, thumbnail(`${siteUrl}${BRAND_ICON_PATH}`, "SkyShards"))];
  return container([
    ...top,
    separator(),
    buttons(card.buttons.map(([label, target]) => linkButton(label, `${siteUrl}${target === "/" ? "/" : target}`))),
  ]);
}

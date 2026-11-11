import React, { useEffect, useLayoutEffect, useRef } from "react";
import { Link, Navigate, useLocation, useNavigationType, useParams } from "react-router-dom";
import { ArrowRight, ExternalLink, Link2, LoaderCircle, RotateCw } from "lucide-react";
import { useToast } from "../components/ui";
import { ButtonLink, IconButton, KitButton } from "../components/ui/kit";
import { KitTooltip } from "../components/ui/Hint";
import { InfoHint } from "../components/ui/InfoHint";
import { cn } from "../components/ui/cn";
import { ItemDetails, ItemHeader } from "../components/wiki/ItemDetails";
import { ItemIcon } from "../components/wiki/ItemIcon";
import { BrowseButton } from "../components/wiki/Browse";
import { Breadcrumbs } from "../components/wiki/Breadcrumbs";
import { IndexGroupItems } from "../components/wiki/IndexCards";
import { Navbox } from "../components/wiki/Navbox";
import { WikiSearch } from "../components/wiki/WikiSearch";
import { groupKeyOf, groupTitleOf } from "../components/wiki/articleModel";
import { groupAnchorId, groupsOf, suggestionsFor, usePhone, useWikiPageData } from "../components/wiki/navModel";
import type { WikiData } from "../components/wiki/useWikiData";
import { hypixelWikiUrl, resolveSlug, wikiPath, wikiUrl, type WikiEntry } from "../wiki/slugs";

// The Greenhouse Wiki (research/wiki-v2, the approved G3 mockup: direction C + the judge's steals):
// - /wiki: the index (search, the group chips, base crops as chips, every mutation as its recipe card);
// - /wiki/<slug>: the article frame (breadcrumbs, search + Browse, the title row, ItemDetails' facts → recipe
//   band → details, the all-items navbox at the foot);
// - an unknown slug: Not found with close suggestions only (no redirect, W05);
// - loading and a load error with Retry.
// SEO contract unchanged (W01–W11): the slugs and the Navigate for other spellings, and today's tab titles.

const SITE_TITLE = "Greenhouse";
/** The reading width: wide enough for the band and two detail columns; left-aligned with the site, like the other pages. */
const MAX_W = "max-w-[76rem]";

export const WikiPage: React.FC = () => {
  const { slug } = useParams<{ slug?: string }>();
  const { wiki, error, retry } = useWikiPageData();
  const phone = usePhone();

  if (error) return <PageError message={error} onRetry={retry} phone={phone} />;
  if (!wiki) return <PageLoading />;

  const entry = slug ? resolveSlug(wiki.index, slug) : null;
  // Any accepted spelling redirects to the one canonical URL (W04).
  if (entry && slug !== entry.slug) return <Navigate to={wikiPath(entry.id)} replace />;

  if (entry) return <WikiArticle key={entry.id} entry={entry} wiki={wiki} phone={phone} />;
  if (slug) return <NotFound key={slug} slug={slug} wiki={wiki} phone={phone} />;
  return <WikiHome wiki={wiki} phone={phone} />;
};

// ---- Shared ----------------------------------------------------------------------------------------------------

/** Sets the tab title while mounted (usePageTitle skips /wiki*). The strings are today's, unchanged (W07). */
function useDocumentMeta(title: string) {
  useEffect(() => {
    document.title = title;
  }, [title]);
}

/**
 * After an in-page navigation (search Enter, a Browse pick, a band / tree / navbox / breadcrumb link: every
 * router link and navigate() in the wiki is a PUSH), focus the new view's heading so a keyboard or
 * screen-reader user starts there, and scroll to the top. With a #group (/wiki#rare) the group's heading takes
 * the focus and WikiHome scrolls to it. Not on a first load from Google, a reload or Back/Forward (POP: the
 * browser keeps its own focus and scroll), nor on a REPLACE (the canonical-spelling redirect, the group chips).
 */
function useArrivalFocus(heading: React.RefObject<HTMLHeadingElement | null>) {
  const type = useNavigationType();
  const { key, hash } = useLocation();
  useLayoutEffect(() => {
    if (type !== "PUSH") return;
    const group = hash ? document.getElementById(`${groupAnchorId(decodeURIComponent(hash.slice(1)))}-title`) : null;
    if (!group) window.scrollTo({ top: 0 });
    (group ?? heading.current)?.focus({ preventScroll: true });
    // Once per location.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

/** Search + Browse: beside the breadcrumbs on desktop; on a phone the sticky bar at the top (full width). */
const FindBar: React.FC<{ wiki: WikiData; current: string | null; phone: boolean; className?: string }> = ({ wiki, current, phone, className }) => (
  <div className={cn("flex min-w-0 items-center gap-2", phone && "sticky top-0 z-(--z-sticky) -mx-3 border-b border-line bg-surface-page px-3 py-2", className)}>
    <WikiSearch wiki={wiki} className={phone ? "flex-1" : "w-72"} />
    <BrowseButton wiki={wiki} current={current} />
  </div>
);

// ---- The article ------------------------------------------------------------------------------------------------

const WikiArticle: React.FC<{ entry: WikiEntry; wiki: WikiData; phone: boolean }> = ({ entry, wiki, phone }) => {
  const { toast } = useToast();
  const h1 = useRef<HTMLHeadingElement>(null);
  useDocumentMeta(`${entry.name} · ${SITE_TITLE} Wiki`);
  useArrivalFocus(h1);
  const hypixel = hypixelWikiUrl(entry.id, entry.name);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(wikiUrl(entry.id, window.location.origin));
      toast({ title: "Link copied", variant: "success", duration: 2000 });
    } catch {
      toast({ title: "Couldn't copy the link", variant: "error" });
    }
  };

  const actions = (
    <>
      <KitTooltip label="Copy link" hint="This page's address">
        <IconButton size="md" aria-label="Copy link" title="" onClick={copyLink} className="pointer-coarse:size-11">
          <Link2 />
        </IconButton>
      </KitTooltip>
      {hypixel && (
        <ButtonLink
          href={hypixel}
          newTab
          size="md"
          variant="ghost"
          aria-label={`${entry.name} on the Hypixel SkyBlock Wiki`}
          title="Hypixel SkyBlock Wiki"
          className="px-2 pointer-coarse:h-11"
        >
          <span className="max-sm:hidden">Hypixel Wiki</span> <ExternalLink />
        </ButtonLink>
      )}
    </>
  );

  return (
    <article className={cn("min-w-0 pt-3 pb-6", MAX_W, phone && "px-3")}>
      {phone ? (
        <>
          <FindBar wiki={wiki} current={entry.id} phone />
          <div className="mt-1 mb-2">
            <Breadcrumbs wiki={wiki} id={entry.id} />
          </div>
        </>
      ) : (
        <div className="mb-3 flex min-w-0 items-center gap-3">
          <div className="min-w-0 flex-1">
            <Breadcrumbs wiki={wiki} id={entry.id} />
          </div>
          <FindBar wiki={wiki} current={entry.id} phone={false} className="shrink-0" />
        </div>
      )}

      <ItemHeader id={entry.id} data={wiki.data} variant="page" headingRef={h1} actions={actions} />
      <div className="mt-3">
        <ItemDetails id={entry.id} data={wiki.data} usedIn={wiki.usedIn} variant="page" />
      </div>
      <div className="mt-10">
        <Navbox wiki={wiki} current={entry.id} />
      </div>
    </article>
  );
};

// ---- The index ----------------------------------------------------------------------------------------------------

const WikiHome: React.FC<{ wiki: WikiData; phone: boolean }> = ({ wiki, phone }) => {
  useDocumentMeta(`${SITE_TITLE} · Wiki`);
  const h1 = useRef<HTMLHeadingElement>(null);
  const { hash, key: locationKey } = useLocation();
  const navType = useNavigationType();
  useArrivalFocus(h1);
  const groups = groupsOf(wiki.index.entries);
  const mutations = wiki.index.entries.filter((e) => e.type === "mutation").length;

  // /wiki#rare (a group chip, a breadcrumb, the navbox, a shared link): scroll that group into view; smoothly
  // for a chip on this page, at once on arrival (and under reduced motion).
  useEffect(() => {
    const key = decodeURIComponent(hash.slice(1));
    if (!key || !groups.some((g) => g.key === key)) return;
    const smooth = navType === "REPLACE" && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const raf = requestAnimationFrame(() => document.getElementById(groupAnchorId(key))?.scrollIntoView({ block: "start", behavior: smooth ? "smooth" : "auto" }));
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationKey]);

  return (
    <div className={cn("min-w-0 pt-3 pb-6", MAX_W, phone && "px-3")}>
      <header className="mb-5 space-y-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <h1 ref={h1} tabIndex={-1} className="text-hero text-fg outline-none">
            Greenhouse Wiki
          </h1>
          <InfoHint title="Greenhouse Wiki" width={300}>
            Every crop and mutation: what it needs, how to grow and harvest it, its effects, drops and crafting tree, and what it's used in.
          </InfoHint>
          <span className="text-secondary tabular-nums text-fg-meta">
            {wiki.index.entries.length - mutations} crops · {mutations} mutations
          </span>
        </div>
        <WikiSearch wiki={wiki} className={phone ? "w-full" : "max-w-xl"} />
        {/* The group counts live here (once), not again in the headings. */}
        <nav aria-label="Groups" className="flex flex-wrap gap-1">
          {groups.map((g) => (
            <Link
              key={g.key}
              to={{ hash: `#${g.key}` }}
              replace
              className="focus-ring inline-flex h-7 shrink-0 items-center gap-1.5 rounded-control border border-line px-2 text-secondary text-fg-body transition-colors duration-(--duration-hover) hover:bg-surface-hover hover:text-fg pointer-coarse:h-11"
            >
              {g.title}
              <span className="tabular-nums text-fg-meta">{g.entries.length}</span>
            </Link>
          ))}
        </nav>
      </header>

      <div className="space-y-6">
        {groups.map((g) => (
          <section key={g.key} id={groupAnchorId(g.key)} aria-labelledby={`${groupAnchorId(g.key)}-title`} className="scroll-mt-4">
            <h2 id={`${groupAnchorId(g.key)}-title`} tabIndex={-1} className="mb-2 border-b border-line pb-1.5 text-body font-semibold text-fg outline-none">
              {g.title}
            </h2>
            <IndexGroupItems wiki={wiki} groupKey={g.key} entries={g.entries} />
          </section>
        ))}
      </div>
    </div>
  );
};

// ---- Not found, loading, error --------------------------------------------------------------------------------------

/**
 * An unknown slug (W05: no redirect): what was asked for, "Did you mean" with close names only (a typo, or
 * part of a name), the search, and the way to everything. Nothing close ("xyz"): says so, no random items.
 */
const NotFound: React.FC<{ slug: string; wiki: WikiData; phone: boolean }> = ({ slug, wiki, phone }) => {
  useDocumentMeta(`Not found · ${SITE_TITLE} Wiki`);
  const h1 = useRef<HTMLHeadingElement>(null);
  useArrivalFocus(h1);
  const near = suggestionsFor(wiki.index.entries, slug);
  let shown = slug;
  try {
    shown = decodeURIComponent(slug);
  } catch {
    // keep the raw text
  }
  return (
    <div className={cn("mx-auto max-w-xl min-w-0 pt-10 pb-12", phone && "px-3")}>
      <h1 ref={h1} tabIndex={-1} className="text-hero text-fg outline-none">
        Not found
      </h1>
      <p className="mt-1 text-body break-words text-fg-muted">No crop or mutation called “{shown}”.</p>
      <div className="mt-5">
        <h2 className="mb-1.5 text-label uppercase text-fg-meta">{near.length ? "Did you mean" : "No close matches"}</h2>
        {near.length > 0 && (
          <ul className="space-y-px">
            {near.map((e) => (
              <li key={e.id}>
                <Link
                  to={wikiPath(e.id)}
                  className="focus-ring flex h-10 min-w-0 items-center gap-2.5 rounded-control px-2 transition-colors duration-(--duration-hover) hover:bg-surface-hover pointer-coarse:h-11"
                >
                  <ItemIcon id={e.id} name={e.name} size={24} />
                  <span className="min-w-0 flex-1 truncate text-body text-fg">{e.name}</span>
                  <span className="shrink-0 text-meta text-fg-meta">{groupTitleOf(groupKeyOf(e))}</span>
                  <ArrowRight aria-hidden className="size-3.5 shrink-0 text-fg-meta" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <WikiSearch wiki={wiki} className="mt-5" />
      <p className="mt-3 text-secondary text-fg-muted">
        Or{" "}
        <Link to="/wiki" className="hit-area focus-ring rounded-inner text-fg-body underline decoration-fg-meta underline-offset-[3px] transition-colors duration-(--duration-hover) hover:text-fg">
          browse all {wiki.index.entries.length} crops &amp; mutations
        </Link>
        .
      </p>
    </div>
  );
};

/** While data.json loads (only the very first visit: later mounts read it synchronously). */
const PageLoading: React.FC = () => (
  <div className="grid place-items-center py-16" role="status" aria-live="polite">
    <LoaderCircle aria-hidden className="size-6 animate-spin text-fg-muted motion-reduce:animate-pulse" />
    <span className="sr-only">Loading the wiki…</span>
  </div>
);

/** data.json failed: what happened, in the problem role, and Retry. */
const PageError: React.FC<{ message: string; onRetry: () => void; phone: boolean }> = ({ message, onRetry, phone }) => (
  <div className={cn("mx-auto max-w-xl min-w-0 pt-10 pb-12", phone && "px-3")} role="alert">
    <h1 className="text-hero text-fg">Couldn't load the wiki</h1>
    <p className="mt-1 text-body break-words text-problem">{message}</p>
    <p className="mt-1 text-secondary text-fg-muted">Check your connection and try again.</p>
    <KitButton className="mt-4" onClick={onRetry}>
      <RotateCw /> Retry
    </KitButton>
  </div>
);

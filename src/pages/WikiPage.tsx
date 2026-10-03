import React, { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { BookOpen, ExternalLink, Link2, Loader2 } from "lucide-react";
import { CropImage, CropSearchInput } from "../components/shared";
import { useToast } from "../components/ui";
import { ItemDetails, ItemHeader, formatRarity, getRarityColor, useWikiData } from "../components/wiki";
import type { WikiData } from "../components/wiki";
import { RARITY_ORDER, hypixelWikiUrl, normalizeKey, resolveSlug, wikiPath, wikiUrl } from "../wiki/slugs";
import type { WikiEntry } from "../wiki/slugs";

const SITE_TITLE = "Greenhouse";

export const WikiPage: React.FC = () => {
  const { slug } = useParams<{ slug?: string }>();
  const { wiki, error } = useWikiData();

  if (error) {
    return <p className="py-12 text-center text-rose-400">{error}</p>;
  }
  if (!wiki) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
      </div>
    );
  }

  const entry = slug ? resolveSlug(wiki.index, slug) : null;
  // Any accepted spelling redirects to the one canonical URL.
  if (entry && slug !== entry.slug) {
    return <Navigate to={wikiPath(entry.id)} replace />;
  }

  return (
    <div className="flex flex-col md:flex-row gap-4 md:gap-6">
      <WikiSidebar wiki={wiki} activeId={entry?.id ?? null} />
      <div className="flex-1 min-w-0">
        {entry ? (
          <WikiArticle key={entry.id} entry={entry} wiki={wiki} />
        ) : slug ? (
          <NotFound slug={slug} />
        ) : (
          <WikiHome wiki={wiki} />
        )}
      </div>
    </div>
  );
};

const WikiArticle: React.FC<{ entry: WikiEntry; wiki: WikiData }> = ({ entry, wiki }) => {
  const { toast } = useToast();
  const externalUrl = hypixelWikiUrl(entry.id, entry.name);

  useDocumentMeta(`${entry.name} · ${SITE_TITLE} Wiki`);
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [entry.id]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(wikiUrl(entry.id, window.location.origin));
      toast({ title: "Link copied", variant: "success", duration: 2000 });
    } catch {
      toast({ title: "Couldn't copy the link", variant: "error" });
    }
  };

  return (
    <article className="space-y-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl px-4 sm:px-6 py-4">
        <ItemHeader
          id={entry.id}
          data={wiki.data}
          variant="page"
          actions={
            <>
              <button
                type="button"
                onClick={copyLink}
                className="p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
                title="Copy link"
                aria-label="Copy link"
              >
                <Link2 className="w-4 h-4" />
              </button>
              {externalUrl && (
                <a
                  href={externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-600/50"
                >
                  <span className="hidden sm:inline">Hypixel Wiki</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </>
          }
        />
      </div>
      <ItemDetails id={entry.id} data={wiki.data} usedIn={wiki.usedIn} variant="page" />
    </article>
  );
};

const WikiHome: React.FC<{ wiki: WikiData }> = ({ wiki }) => {
  useDocumentMeta(`${SITE_TITLE} · Wiki`);
  const groups = useMemo(() => groupEntries(wiki.index.entries), [wiki]);

  return (
    <div className="space-y-6">
      <div className="bg-slate-900 border border-slate-700 rounded-xl px-4 sm:px-6 py-5">
        <div className="flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-teal-400" />
          <h1 className="text-xl font-bold text-slate-100">Greenhouse Wiki</h1>
        </div>
        <p className="mt-2 text-sm text-slate-400">
          Every crop and mutation: how it spawns, its effects, decay, drops, crafting tree and what it is used in.
        </p>
      </div>

      {groups.map(({ label, rarity, entries }) => (
        <section key={label}>
          <h2 className={`mb-2 text-sm font-semibold ${getRarityColor(rarity)}`}>
            {label} <span className="text-slate-500 font-normal">({entries.length})</span>
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
            {entries.map((entry) => (
              <Link
                key={entry.id}
                to={wikiPath(entry.id)}
                className="flex items-center gap-2 min-w-0 px-2 py-2 rounded-lg bg-slate-800/40 border border-slate-600/30 hover:border-slate-500/60 hover:bg-slate-800/70 transition-colors"
              >
                <CropImage cropId={entry.id} cropName={entry.name} size="sm" showFallback={false} />
                <span className={`text-sm truncate ${getRarityColor(entry.rarity)}`}>{entry.name}</span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
};

const NotFound: React.FC<{ slug: string }> = ({ slug }) => {
  useDocumentMeta(`Not found · ${SITE_TITLE} Wiki`);
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl px-6 py-10 text-center">
      <p className="text-slate-200 font-medium">No crop or mutation called &quot;{slug}&quot;.</p>
      <Link to="/wiki" className="mt-3 inline-block text-sm text-teal-400 hover:text-teal-300">
        Browse the wiki
      </Link>
    </div>
  );
};

const WikiSidebar: React.FC<{ wiki: WikiData; activeId: string | null }> = ({ wiki, activeId }) => {
  const [query, setQuery] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);

  const groups = useMemo(() => {
    const key = normalizeKey(query);
    const entries = key ? wiki.index.entries.filter((entry) => normalizeKey(entry.name).includes(key)) : wiki.index.entries;
    return groupEntries(entries);
  }, [wiki, query]);

  // Close the mobile list after picking an item.
  useEffect(() => {
    setMobileOpen(false);
  }, [activeId]);

  const list = (
    <nav aria-label="Wiki items" className="space-y-3">
      {groups.length === 0 && <p className="px-2 text-sm text-slate-500">No matches.</p>}
      {groups.map(({ label, rarity, entries }) => (
        <div key={label}>
          <h2 className={`px-2 mb-1 text-[11px] font-semibold uppercase tracking-wide ${getRarityColor(rarity)} opacity-80`}>
            {label}
          </h2>
          <ul className="space-y-px">
            {entries.map((entry) => {
              const active = entry.id === activeId;
              return (
                <li key={entry.id}>
                  <Link
                    to={wikiPath(entry.id)}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center gap-2 px-2 py-1 rounded-md text-sm transition-colors ${
                      active ? "bg-teal-500/15 ring-1 ring-teal-500/30" : "hover:bg-slate-800"
                    }`}
                  >
                    <CropImage cropId={entry.id} cropName={entry.name} width={20} height={20} showFallback={false} />
                    <span className={`truncate ${getRarityColor(entry.rarity)}`}>{entry.name}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <aside className="md:w-60 flex-shrink-0">
      <div className="md:sticky md:top-4 bg-slate-900 border border-slate-700 rounded-xl p-3 space-y-3">
        <CropSearchInput value={query} onChange={setQuery} placeholder="Search crops & mutations..." />
        <button
          type="button"
          onClick={() => setMobileOpen((open) => !open)}
          className="md:hidden w-full text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
        >
          {mobileOpen || query ? "Hide list" : "Show all items"}
        </button>
        <div className={`${mobileOpen || query ? "block" : "hidden"} md:block max-h-[60vh] md:max-h-[calc(100vh-10rem)] overflow-y-auto -mx-1 px-1`}>
          {list}
        </div>
      </div>
    </aside>
  );
};

interface EntryGroup {
  label: string;
  rarity: string | null;
  entries: WikiEntry[];
}

function groupEntries(entries: WikiEntry[]): EntryGroup[] {
  const groups: EntryGroup[] = [];
  const base = entries.filter((entry) => entry.type === "crop");
  if (base.length) groups.push({ label: "Base Crops", rarity: null, entries: base });
  for (const rarity of RARITY_ORDER) {
    const matching = entries.filter((entry) => entry.type === "mutation" && entry.rarity?.toLowerCase() === rarity);
    if (matching.length) groups.push({ label: formatRarity(rarity), rarity, entries: matching });
  }
  const other = entries.filter(
    (entry) => entry.type === "mutation" && !(RARITY_ORDER as readonly string[]).includes(entry.rarity?.toLowerCase() ?? ""),
  );
  if (other.length) groups.push({ label: "Other", rarity: null, entries: other });
  return groups;
}

/** Sets the tab title while mounted (usePageTitle handles every other route). */
function useDocumentMeta(title: string) {
  useEffect(() => {
    document.title = title;
  }, [title]);
}

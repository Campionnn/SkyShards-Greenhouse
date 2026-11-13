import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ExternalLink, Menu, X } from "lucide-react";
import { cn } from "../ui/cn";
import { useSlidingIndicator } from "../ui/useSlidingIndicator";
import { DiscordIcon } from "../ui/DiscordIcon";
import { DISCORD_PATH } from "../../seo/routes";

// Site header (docs/design-system/foundations.md "Site chrome"). Neutral links; the current page has
// the select-colour underline, like the kit's Tabs. One brand mark: the aqua All-in Aloe frame.
// Below 1024px the links move into a full-width menu sheet.

const NAV_ITEMS = [
  { path: "/", label: "Calculator" },
  { path: "/designer", label: "Designer" },
  { path: "/simulator", label: "Simulator" },
  { path: "/flows", label: "Flows" },
  { path: "/guide", label: "Guide" },
  { path: "/wiki", label: "Wiki" },
] as const;

const SECONDARY = [
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
  { href: "/privacy-policy", label: "Privacy policy" },
] as const;

const SKYSHARDS_URL = "https://skyshards.com";

export const Navigation: React.FC = () => {
  const location = useLocation();
  const [open, setOpen] = useState(false);

  // Sections with sub-pages (/wiki/<slug>) stay current on them.
  const isCurrent = (path: string) => (path === "/" ? location.pathname === "/" : location.pathname === path || location.pathname.startsWith(`${path}/`));
  const currentPath = NAV_ITEMS.find((i) => isCurrent(i.path))?.path ?? null;
  // The underline slides from the old page to the new one (same as the kit's Tabs: transform only,
  // interruptible, no motion under reduced motion). Pages outside the nav (about, contact) have none.
  const { box, bar, style } = useSlidingIndicator<HTMLElement>('[aria-current="page"]', 10, [currentPath]);

  // Close the menu on navigation and on Escape.
  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // The header is not sticky: if it is partly scrolled away, opening the menu brings it (and its
  // close button) back into view, so the sheet sits right under it. The page behind the sheet
  // doesn't scroll while it is open.
  const headerRef = useRef<HTMLElement>(null);
  const [sheetTop, setSheetTop] = useState(52);
  useLayoutEffect(() => {
    if (!open) return;
    const header = headerRef.current;
    if (header && header.getBoundingClientRect().top < 0) window.scrollTo({ top: window.scrollY + header.getBoundingClientRect().top, behavior: "instant" });
    setSheetTop(Math.max(0, header?.getBoundingClientRect().bottom ?? 52));
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => void (document.body.style.overflow = prev);
  }, [open]);

  return (
    // Not sticky: tool pages (simulator, flow editor) have their own sticky command bars at top 0.
    // Open, the header (and its menu sheet) rises to the drawer layer: above those sticky bars and
    // the phone's fixed bottom bars, which share --z-bar with it and come later in the page.
    <header ref={headerRef} className={cn("relative border-b border-line bg-surface-page", open ? "z-(--z-drawer)" : "z-(--z-bar)")}>
      {/* Same frame as the page (Layout.tsx <main> + .pn-page grid + max-w-screen-2xl), so the logo
          sits on the content's left edge at every width, with or without the ad rails. */}
      <div className="px-1 sm:px-2 lg:px-4">
      <div className="pn-header">
      <div className="pn-content">
      <div className="mx-auto flex h-[52px] w-full max-w-screen-2xl items-center gap-6">
        <Link to="/" className="focus-ring flex shrink-0 items-center gap-2.5 rounded-control" aria-label="Greenhouse by SkyShards, home">
          <img src="/brand/aloe-aqua-64.png" alt="" width={22} height={23} className="h-[23px] w-[22px] object-contain" />
          <span className="text-title font-bold tracking-[-0.01em] text-fg">Greenhouse</span>
          <span className="hidden text-secondary font-medium text-fg-meta sm:inline">by SkyShards</span>
        </Link>

        <nav ref={box} aria-label="Main" className="relative hidden h-full items-stretch gap-0.5 lg:flex">
          {NAV_ITEMS.map(({ path, label }) => {
            const current = isCurrent(path);
            return (
              <Link
                key={path}
                to={path}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "focus-ring-inset relative flex items-center rounded-control px-2.5 text-body font-medium transition-colors duration-(--duration-hover)",
                  current ? "text-fg" : "text-fg-muted hover:text-fg",
                )}
              >
                {label}
              </Link>
            );
          })}
          {style && currentPath && (
            <span ref={bar} aria-hidden className="absolute -bottom-px left-0 h-0.5 rounded-full bg-select forced-colors:bg-[Highlight]" style={style} />
          )}
        </nav>

        <span className="flex-1" />

        {/* The Discord invite: the short link (/discord) resolves to the invite in production.
            Phones get it inside the menu sheet, like the SkyShards link, so the header keeps one
            right-hand control (the menu button). */}
        <a
          href={DISCORD_PATH}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Join the SkyShards Discord (opens in a new tab)"
          title="Join the SkyShards Discord"
          className="focus-ring hidden h-[30px] shrink-0 items-center gap-1.5 rounded-control border border-line px-2.5 text-body font-medium text-fg-muted transition-colors duration-(--duration-hover) hover:bg-surface-hover hover:text-fg lg:inline-flex"
        >
          <DiscordIcon className="size-3.5" />
          Discord
        </a>

        <a
          href={SKYSHARDS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="focus-ring hidden h-[30px] shrink-0 items-center gap-1.5 rounded-control border border-line px-2.5 text-body font-medium text-fg-muted transition-colors duration-(--duration-hover) hover:bg-surface-hover hover:text-fg lg:inline-flex"
        >
          SkyShards
          <ExternalLink aria-hidden className="size-3.5" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="site-menu"
          aria-label={open ? "Close menu" : "Open menu"}
          className="focus-ring grid size-11 shrink-0 cursor-pointer place-items-center rounded-control text-fg-muted transition-colors duration-(--duration-hover) hover:text-fg lg:hidden"
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>
      </div>
      </div>
      </div>

      {open && (
        // Scrolls inside; its last links scroll clear of Mediavine's adhesion ad (`--ad-bottom`).
        <div id="site-menu" style={{ top: sheetTop, paddingBottom: "calc(0.5rem + var(--ad-bottom, 0px))" }} className="kit-fade-in fixed inset-x-0 bottom-0 overflow-y-auto overscroll-contain bg-surface-page px-3 pt-2 lg:hidden">
          <nav aria-label="Main" className="flex flex-col">
            {NAV_ITEMS.map(({ path, label }) => {
              const current = isCurrent(path);
              return (
                <Link
                  key={path}
                  to={path}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "focus-ring-inset relative flex h-12 items-center rounded-control px-3 text-title font-medium",
                    current ? "bg-surface-hover text-fg" : "text-fg-body",
                  )}
                >
                  {current && <span aria-hidden className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-select" />}
                  {label}
                </Link>
              );
            })}
          </nav>
          <div className="my-2 border-t border-line" />
          <div className="flex flex-col">
            <a href={SKYSHARDS_URL} target="_blank" rel="noopener noreferrer" className="focus-ring-inset flex h-11 items-center gap-1.5 rounded-control px-3 text-body text-fg-muted">
              SkyShards calculator <ExternalLink aria-hidden className="size-3.5" />
            </a>
            <a href={DISCORD_PATH} target="_blank" rel="noopener noreferrer" className="focus-ring-inset flex h-11 items-center gap-1.5 rounded-control px-3 text-body text-fg-muted">
              <DiscordIcon className="size-3.5" /> Discord <span className="sr-only">(opens in a new tab)</span>
            </a>
            {SECONDARY.map(({ href, label }) => (
              <Link key={href} to={href} className="focus-ring-inset flex h-11 items-center rounded-control px-3 text-body text-fg-muted">
                {label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </header>
  );
};

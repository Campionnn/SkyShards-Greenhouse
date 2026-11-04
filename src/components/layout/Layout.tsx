import React from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Navigation } from "./Navigation";
import { ErrorBoundary } from "./ErrorBoundary";
import { useBottomAdInset } from "../../hooks/useBottomAdInset";
import { DISCORD_PATH } from "../../seo/routes";

export const Layout: React.FC = () => {
  const location = useLocation();
  // `--ad-bottom`: fixed bottom UI docks above Mediavine's adhesion ad instead of under it.
  useBottomAdInset();
  // Remount per top-level section, not per path, so moving between wiki
  // entries keeps the wiki sidebar (search text, scroll) mounted.
  const sectionKey = location.pathname.split("/")[1] ?? "";
  return (
    <div className="min-h-screen bg-surface-page">
      <Navigation />
      {/* Same frame as skyshards.com: thin side padding, content up to max-w-screen-2xl. */}
      <main className="px-1 sm:px-2 lg:px-4 py-3">
        {/* Reserved ad slots (Mediavine targets the pn-* classes). Ad-blocker users are
            handled in index.html, which sets `html.ads-blocked`; CSS then collapses these
            slots (see src/index.css) on first paint, without a React re-render. */}
        <div className="pn-page">
          <div className="pn-left" aria-hidden />
          <div className="pn-content">
            <div className="max-w-screen-2xl mx-auto w-full">
              <div className="pn-leaderboard" />
              <ErrorBoundary>
                <Outlet key={sectionKey} />
              </ErrorBoundary>
            </div>
          </div>
          <aside className="pn-sidebar" aria-label="Advertisement" />
        </div>
      </main>

      {/* One-line footer: credit on the left, links on the right (wraps on phones). */}
      {/* Same frame as the page and header, so it lines up with the content column. */}
      <footer className="mt-10 border-t border-line px-1 sm:px-2 lg:px-4">
        <div className="pn-header">
        <div className="pn-content">
        <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center gap-x-5 gap-y-1.5 py-4 text-secondary text-fg-meta">
          <span className="mr-auto">Made by Campion · a SkyShards project · thanks to MegaMew14</span>
          {[
            { href: "https://skyshards.com", label: "SkyShards", external: true },
            { href: DISCORD_PATH, label: "Discord", external: true },
            { href: "/about", label: "About" },
            { href: "/contact", label: "Contact" },
            { href: "/privacy-policy", label: "Privacy policy" },
          ].map(({ href, label, external }) => (
            <a
              key={href}
              href={href}
              {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              className="focus-ring rounded-inner text-fg-muted transition-colors duration-(--duration-hover) hover:text-fg"
            >
              {label}
            </a>
          ))}
          <span>© {new Date().getFullYear()} SkyShards</span>
        </div>
        </div>
        </div>
      </footer>
    </div>
  );
};

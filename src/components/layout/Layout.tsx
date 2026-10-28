import React from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Navigation } from "./Navigation";
import { ErrorBoundary } from "./ErrorBoundary";

export const Layout: React.FC = () => {
  const location = useLocation();
  // Remount per top-level section, not per path, so moving between wiki
  // entries keeps the wiki sidebar (search text, scroll) mounted.
  const sectionKey = location.pathname.split("/")[1] ?? "";
  return (
    <div className="min-h-screen bg-slate-950">
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

      <footer className="text-center py-6 text-slate-400 text-sm border-t border-slate-800/50">
        <div className="max-w-screen-2xl mx-auto">
          <p className="font-medium">Made by Campion</p>
          <p className="mt-1 text-slate-500">A SkyShards Project. Big thanks to MegaMew14 for the help!</p>
          <div className="h-px w-1/2 bg-slate-800/50 mx-auto my-3"></div>
          <div className="flex flex-wrap justify-center items-center gap-x-4 gap-y-1 px-4">
            <a
              href="https://skyshards.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-500 hover:text-emerald-400 transition-colors duration-200 text-xs font-medium"
            >
              SkyShards
            </a>
            <span className="text-slate-600">•</span>
            <a href="/about" className="text-slate-500 hover:text-emerald-400 transition-colors duration-200 text-xs font-medium">
              About
            </a>
            <span className="text-slate-600">•</span>
            <a href="/contact" className="text-slate-500 hover:text-emerald-400 transition-colors duration-200 text-xs font-medium">
              Contact
            </a>
            <span className="text-slate-600">•</span>
            <a href="/privacy-policy" className="text-slate-500 hover:text-emerald-400 transition-colors duration-200 text-xs font-medium">
              Privacy Policy
            </a>
            <span className="text-slate-600">•</span>
            <span className="text-slate-600 text-xs">© {new Date().getFullYear()} SkyShards</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

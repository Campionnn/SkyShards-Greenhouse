import React, { useEffect } from "react";
import { DISCORD_INVITE_URL } from "../seo/routes";

/**
 * /discord: sends the browser to the SkyShards Discord invite. Production answers /discord with a
 * real 301 (buildRedirects in src/seo/routes.ts), so this page only runs where the host serves the
 * SPA instead (vite dev/preview, the GitHub Pages deploy); its link is also the no-JS fallback.
 */
export const DiscordRedirect: React.FC = () => {
  useEffect(() => {
    window.location.replace(DISCORD_INVITE_URL);
  }, []);

  return (
    <div className="mx-auto flex min-h-[40vh] max-w-xl flex-col items-center justify-center gap-2 px-4 text-center">
      <p className="text-title text-fg">Taking you to Discord…</p>
      <a
        href={DISCORD_INVITE_URL}
        className="focus-ring rounded-inner text-body text-fg-muted underline decoration-fg-meta underline-offset-4 transition-colors duration-(--duration-hover) hover:text-fg"
      >
        Open the SkyShards Discord invite
      </a>
    </div>
  );
};

import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs";
import {
  buildWikiStaticPages,
  buildRoutePages,
  buildNotFoundPage,
  buildSitemap,
  buildHomePage,
  templateImage,
} from "./src/wiki/staticPages";
import { buildWikiIndex, SITE_URL } from "./src/wiki/slugs";
import { SITE_ROUTES, buildRedirects } from "./src/seo/routes";
import type { GreenhouseDataJSON } from "./src/services/greenhouseDataService";
import { greenhouseImagesPlugin } from "./vite.greenhouseImages";
import { publicJsonPlugin } from "./vite.publicJson";

const isProd = process.env.NODE_ENV === "production";
const isGitHubPages = process.env.GITHUB_PAGES === "true";

// Cloudflare Pages serves /x from dist/x.html with a 200 and falls back to
// dist/404.html (with a 404 status) for anything else. So every real page gets
// its own HTML file; otherwise Search Console sees 404s and Analytics and link
// previews see the home page's title and canonical URL. This writes:
//   - dist/<route>.html for each app route (src/seo/routes.ts),
//   - dist/wiki.html and dist/wiki/<slug>.html (per-item metadata),
//   - dist/404.html: the app shell marked noindex, for short links and typos,
//   - dist/_redirects: old URLs, short links and the /flows/:id fallback,
//   - dist/sitemap.xml: every indexable URL on this domain.
const staticPagesPlugin = () => ({
  name: "static-pages",
  apply: "build" as const,
  // writeBundle (not closeBundle): runs only after a successful write, so a failed build
  // reports its own error instead of a missing dist/index.html.
  writeBundle() {
    const distPath = resolve(__dirname, "dist");
    const template = readFileSync(resolve(distPath, "index.html"), "utf-8");
    const data = JSON.parse(readFileSync(resolve(__dirname, "public/greenhouse/data.json"), "utf-8")) as GreenhouseDataJSON;

    // Discord cards show the site screenshot only when it is actually deployed
    // (a missing image would leave an empty gallery tile); else the brand mark.
    const shot = templateImage(template);
    const shotFile = shot?.startsWith(`${SITE_URL}/`) ? resolve(distPath, shot.slice(SITE_URL.length + 1)) : null;
    const screenshotUrl = shotFile && existsSync(shotFile) ? shot : null;

    const routePages = buildRoutePages(template, SITE_URL, { data, screenshotUrl });
    const wikiPages = buildWikiStaticPages(template, data, SITE_URL, screenshotUrl);
    mkdirSync(resolve(distPath, "wiki"), { recursive: true });
    for (const page of [...routePages, ...wikiPages]) writeFileSync(resolve(distPath, page.file), page.html);
    // index.html is the home page and the /flows/:id shell: give it the home card.
    writeFileSync(resolve(distPath, "index.html"), buildHomePage(template, data, SITE_URL, screenshotUrl));

    writeFileSync(resolve(distPath, "404.html"), buildNotFoundPage(template));
    writeFileSync(resolve(distPath, "_redirects"), buildRedirects(buildWikiIndex(data).entries));

    const lastmod = new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
    const urls = [
      ...SITE_ROUTES.filter((route) => route.indexed).map((route) => `${SITE_URL}${route.path}`),
      ...wikiPages.map((page) => page.url),
    ];
    writeFileSync(resolve(distPath, "sitemap.xml"), buildSitemap(urls, lastmod));

    console.log(`static-pages: wrote ${routePages.length} route pages, ${wikiPages.length} wiki pages, ${urls.length} sitemap URLs`);
  },
});

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = env.VITE_API_TARGET || "https://api.skyshards.com";

  return {
    plugins: [publicJsonPlugin(), react(), tailwindcss(), greenhouseImagesPlugin(), staticPagesPlugin()],
    base: isProd && isGitHubPages ? "/SkyShards/" : "/",
    server: {
      proxy: {
        // Proxy API requests in development to avoid CORS issues.
        // Target is controlled by VITE_API_TARGET in .env.local:
        "/api": {
          target: apiTarget,
          changeOrigin: true,
          secure: apiTarget.startsWith("https"),
          rewrite: (path) => path.replace(/^\/api/, ""),
        },
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ["react", "react-dom", "react-router-dom"],
            forms: ["react-hook-form", "@hookform/resolvers", "zod"],
            icons: ["lucide-react"],
          },
        },
      },
      target: "es2015",
      sourcemap: false,
      cssCodeSplit: true,
      chunkSizeWarningLimit: 1000,
    },
    optimizeDeps: {
      include: ["react", "react-dom", "react-router-dom"],
    },
  };
});

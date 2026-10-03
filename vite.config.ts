import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs";
import { buildWikiStaticPages, addToSitemap } from "./src/wiki/staticPages";
import type { GreenhouseDataJSON } from "./src/services/greenhouseDataService";

const isProd = process.env.NODE_ENV === "production";
const isGitHubPages = process.env.GITHUB_PAGES === "true";

// Writes dist/wiki.html and dist/wiki/<slug>.html (per-item title, description and
// preview tags, served with a 200) and adds them to dist/sitemap.xml.
const wikiPagesPlugin = () => ({
  name: "wiki-static-pages",
  apply: "build" as const,
  closeBundle() {
    const distPath = resolve(__dirname, "dist");
    const template = readFileSync(resolve(distPath, "index.html"), "utf-8");
    const data = JSON.parse(readFileSync(resolve(__dirname, "public/greenhouse/data.json"), "utf-8")) as GreenhouseDataJSON;
    const pages = buildWikiStaticPages(template, data);

    mkdirSync(resolve(distPath, "wiki"), { recursive: true });
    for (const page of pages) writeFileSync(resolve(distPath, page.file), page.html);

    const sitemapPath = resolve(distPath, "sitemap.xml");
    if (existsSync(sitemapPath)) {
      const lastmod = new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
      writeFileSync(sitemapPath, addToSitemap(readFileSync(sitemapPath, "utf-8"), pages.map((page) => page.url), lastmod));
    }
    console.log(`wiki-static-pages: wrote ${pages.length} pages`);
  },
});

// Plugin to copy index.html to 404.html for SPA routing on Cloudflare Pages
const copy404Plugin = () => ({
  name: "copy-404",
  closeBundle() {
    const distPath = resolve(__dirname, "dist");
    const indexPath = resolve(distPath, "index.html");
    const notFoundPath = resolve(distPath, "404.html");
    
    try {
      const indexContent = readFileSync(indexPath, "utf-8");
      writeFileSync(notFoundPath, indexContent);
    } catch (err) {
      console.warn("Could not copy 404.html:", err);
    }
  },
});

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = env.VITE_API_TARGET || "https://api.skyshards.com";

  return {
    plugins: [react(), tailwindcss(), copy404Plugin(), wikiPagesPlugin()],
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

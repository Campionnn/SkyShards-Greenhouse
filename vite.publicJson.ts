import { readFileSync } from "fs";
import { dirname, isAbsolute, relative, resolve } from "path";

const PREFIX = "\0public-json:";

/**
 * Lets source files import JSON that lives in public/ (e.g. public/greenhouse/data.json)
 * without Vite's "Assets in public directory cannot be imported from JavaScript" warning.
 *
 * The file stays in public/ (still served at /greenhouse/... and copied to dist), but the
 * import is resolved to a virtual module id, so the dev server never requests it through
 * /public/... . Vite's JSON plugin still turns it into a module, and edits still trigger HMR.
 */
export const publicJsonPlugin = () => {
  let publicDir = resolve(__dirname, "public");
  return {
    name: "public-json",
    enforce: "pre" as const,
    configResolved(config: { publicDir: string }) {
      if (config.publicDir) publicDir = config.publicDir;
    },
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith(".json") || source.includes("?") || source.startsWith("\0")) return null;
      if (!importer || importer.startsWith("\0")) return null;
      const file = isAbsolute(source) ? source : resolve(dirname(importer.split("?")[0]), source);
      const rel = relative(publicDir, file);
      if (rel.startsWith("..") || isAbsolute(rel)) return null;
      return PREFIX + file;
    },
    load(this: { addWatchFile(file: string): void }, id: string) {
      if (!id.startsWith(PREFIX)) return null;
      const file = id.slice(PREFIX.length);
      this.addWatchFile(file);
      // Returned as raw JSON: the id ends in .json, so vite:json converts it to a module.
      return readFileSync(file, "utf-8");
    },
  };
};

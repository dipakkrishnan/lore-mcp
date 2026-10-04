// The desktop app previews a piece page before anything is published, using
// the store's own renderer: this bundles src/storefront.ts into the app.
// `--check` fails when the app's copy no longer matches the source.
import { buildSync } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const target = fileURLToPath(new URL("../../../app/desktop/src/storefront.mjs", import.meta.url));
const [bundle] = buildSync({
  entryPoints: [fileURLToPath(new URL("../src/storefront.ts", import.meta.url))],
  bundle: true,
  format: "esm",
  platform: "neutral",
  write: false,
  banner: { js: "// @ts-nocheck\n// Generated from lore/node/src/storefront.ts by `npm run preview` in lore/node. Do not edit." }
}).outputFiles;

if (!process.argv.includes("--check")) writeFileSync(target, bundle.text);
else if (readFileSync(target, "utf8") !== bundle.text) {
  console.error("app/desktop/src/storefront.mjs is out of date: run `npm run preview` in lore/node.");
  process.exit(1);
}

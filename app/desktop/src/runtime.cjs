const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { app } = require("electron");
const { stream } = require("./state.cjs");

const root = resolve(__dirname, "../../..");
const resources = app.isPackaged ? process.resourcesPath : root;
const skillsDir = join(resources, app.isPackaged ? "skills" : "plugins/lore/skills");
const dictateBin = join(resources, app.isPackaged ? "dictate" : "app/desktop/packaging/out/dictate");

/** @param {(event: AgentEvent) => void} emit @returns {Promise<{bin: string, binDir: string} | null>} */
async function provision(emit) {
  if (!app.isPackaged) return null;
  // Finder launches with launchd's bare PATH; deploys run npm and wrangler on the bundled Node.
  process.env.PATH = [join(resources, "node/bin"), process.env.PATH].filter(Boolean).join(":");
  const home = join(app.getPath("userData"), "runtime");
  const binDir = join(home, "bin");
  const runtime = { bin: join(binDir, "lore"), binDir };
  const manifest = readFileSync(join(resources, "runtime.json"), "utf8");
  const stamp = join(home, "runtime.json");
  if (existsSync(runtime.bin) && existsSync(stamp) && readFileSync(stamp, "utf8") === manifest) return runtime;
  emit({ type: "progress", text: "Setting Lore up on this Mac…" });
  mkdirSync(home, { recursive: true });
  await stream(
    join(resources, "uv"),
    [
      "tool", "install", "lore-mcp", "--force", "--reinstall",
      "--no-index", "--find-links", join(resources, "wheels"),
      "--overrides", join(resources, "overrides.txt"),
      "--python", /** @type {{python: string}} */ (JSON.parse(manifest)).python, "--managed-python"
    ],
    {
      UV_TOOL_DIR: join(home, "tools"),
      UV_TOOL_BIN_DIR: binDir,
      UV_PYTHON_INSTALL_DIR: join(home, "python"),
      UV_CACHE_DIR: join(home, "cache")
    },
    (text) => console.error(`uv: ${text}`)
  );
  writeFileSync(stamp, manifest);
  return runtime;
}

module.exports = { skillsDir, dictateBin, provision };

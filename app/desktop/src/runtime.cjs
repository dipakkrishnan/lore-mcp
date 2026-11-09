const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { stream } = require("./state.cjs");

const root = resolve(__dirname, "../../..");

// Electron's app is read when asked, never at load (APP-267): under plain node `require("electron")` is the binary's
// path, so there is no app, and the checkout stands in for the bundle's resources.
/** @returns {import("electron").App | undefined} */
const electron = () => /** @type {{app?: import("electron").App}} */ (/** @type {unknown} */ (require("electron"))).app;
const packaged = () => Boolean(electron()?.isPackaged);
const resources = () => (packaged() ? process.resourcesPath : root);
const skillsDir = () => join(resources(), packaged() ? "skills" : "plugins/lore/skills");
const whisper = () => {
  const whisperDir = join(resources(), packaged() ? "whisper" : "app/desktop/packaging/out/whisper");
  return { bin: join(whisperDir, "whisper-cli"), model: join(whisperDir, "ggml-base.en.bin") };
};

/** @param {(event: AgentEvent) => void} emit @returns {Promise<{bin: string, binDir: string} | null>} */
async function provision(emit) {
  const app = electron();
  if (!app?.isPackaged) return null;
  // Finder launches with launchd's bare PATH; deploys run npm and wrangler on the bundled Node.
  process.env.PATH = [join(resources(), "node/bin"), process.env.PATH].filter(Boolean).join(":");
  const home = join(app.getPath("userData"), "runtime");
  const binDir = join(home, "bin");
  const runtime = { bin: join(binDir, "lore"), binDir };
  const manifest = readFileSync(join(resources(), "runtime.json"), "utf8");
  const stamp = join(home, "runtime.json");
  if (existsSync(runtime.bin) && existsSync(stamp) && readFileSync(stamp, "utf8") === manifest) return runtime;
  emit({ type: "progress", text: "Setting Lore up on this Mac…" });
  mkdirSync(home, { recursive: true });
  await stream(
    join(resources(), "uv"),
    [
      "tool", "install", "lore-mcp", "--force", "--reinstall",
      "--no-index", "--find-links", join(resources(), "wheels"),
      // Relative, from the resources folder: uv cuts an overrides path at its first space, as in "Lore 2.app".
      "--overrides", "overrides.txt",
      "--python", /** @type {{python: string}} */ (JSON.parse(manifest)).python, "--managed-python"
    ],
    {
      UV_TOOL_DIR: join(home, "tools"),
      UV_TOOL_BIN_DIR: binDir,
      UV_PYTHON_INSTALL_DIR: join(home, "python"),
      UV_CACHE_DIR: join(home, "cache")
    },
    (text) => console.error(`uv: ${text}`),
    resources()
  );
  writeFileSync(stamp, manifest);
  return runtime;
}

module.exports = {
  /** Where the agent's skills are: the bundle's, or the checkout's plugin folder. */
  get skillsDir() {
    return skillsDir();
  },
  /** The bundled whisper binary and model. */
  get whisper() {
    return whisper();
  },
  provision
};

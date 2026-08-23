const { spawn } = require("node:child_process");
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { createInterface } = require("node:readline");
const { app } = require("electron");

const root = resolve(__dirname, "../../..");
const resources = app.isPackaged ? process.resourcesPath : root;
const skillsDir = join(resources, app.isPackaged ? "skills" : "plugins/lore/skills");

/** @param {string} file @param {string[]} args @param {Record<string, string>} env @param {(line: string) => void} onLine */
function stream(file, args, env, onLine) {
  return new Promise((done, fail) => {
    const child = spawn(file, args, { env: { ...process.env, ...env } });
    for (const output of [child.stdout, child.stderr]) {
      if (output) createInterface({ input: output }).on("line", (line) => line.trim() && onLine(line.trim()));
    }
    child.on("error", fail);
    child.on("close", (code) => (code === 0 ? done(undefined) : fail(new Error(`uv exited with ${code}`))));
  });
}

/** @param {(event: AgentEvent) => void} emit @returns {Promise<{bin: string, binDir: string} | null>} */
async function provision(emit) {
  if (!app.isPackaged) return null;
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
    (text) => emit({ type: "progress", text })
  );
  writeFileSync(stamp, manifest);
  return runtime;
}

module.exports = { skillsDir, provision };

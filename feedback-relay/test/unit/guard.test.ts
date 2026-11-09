// XC-099: the node project runs in plain node, where the `cloudflare:` modules do not exist. A
// test under test/unit/ that reaches `cloudflare:workers` or `cloudflare:test`, directly or
// through a helper or a src module, belongs in the workerd project (vitest.workerd.config.ts).
// This names the file and the path it got there by, instead of a resolver error mid-run.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const UNIT = import.meta.dirname;
const FORBIDDEN = new Set(["cloudflare:workers", "cloudflare:test"]);

/** Every module specifier a file imports, re-exports or `import()`s. */
export function specifiers(source: string): string[] {
  return [...source.matchAll(/\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map(([, spec]) => spec);
}

/** Where a relative specifier lands on disk, or null when it is not a TypeScript module of ours. */
function resolveLocal(from: string, spec: string): string | null {
  if (!spec.startsWith("./") && !spec.startsWith("../")) return null;
  const base = resolve(dirname(from), spec);
  for (const candidate of [base, `${base}.ts`, base.replace(/\.js$/, ".ts"), join(base, "index.ts")]) {
    if (candidate.endsWith(".ts") && existsSync(candidate)) return candidate;
  }
  return null;
}

/** `[file, specifier]` pairs where a forbidden module is reached, walking relative imports from `entry`. */
export function cloudflareImports(entry: string, seen = new Set<string>()): [string, string][] {
  if (seen.has(entry)) return [];
  seen.add(entry);
  const found: [string, string][] = [];
  for (const spec of specifiers(readFileSync(entry, "utf8"))) {
    if (FORBIDDEN.has(spec)) found.push([relative(UNIT, entry), spec]);
    const next = resolveLocal(entry, spec);
    if (next) found.push(...cloudflareImports(next, seen));
  }
  return found;
}

function testFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? testFiles(path) : name.endsWith(".test.ts") ? [path] : [];
  });
}

describe("the node project", () => {
  it("has no test that reaches cloudflare:workers or cloudflare:test, even through a helper", () => {
    const reached = Object.fromEntries(
      testFiles(UNIT)
        .map((file) => [relative(UNIT, file), cloudflareImports(file).map(([via, spec]) => `${via} imports ${spec}`)] as const)
        .filter(([, imports]) => imports.length > 0)
    );
    expect(reached).toEqual({});
  });

  it("would notice: the scan reads static, side-effect, dynamic and re-export imports", () => {
    // Spelled apart, so this file's own text is not a forbidden import.
    const workers = ["cloudflare", "workers"].join(":");
    const source = [
      `import { env } from "${workers}";`,
      `import "${workers}";`,
      `const t = await import("${workers}");`,
      `export { WorkerEntrypoint } from "${workers}";`,
      `import { parseReport } from "../src/report";`
    ].join("\n");
    expect(specifiers(source)).toEqual([workers, workers, workers, workers, "../src/report"]);
    expect(cloudflareImports(resolve(UNIT, "../quota-reset.ts")).map(([, spec]) => spec)).toContain(workers);
  });
});

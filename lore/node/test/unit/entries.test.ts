// XC-100: each Worker's entry module exports its fetch handler and the Durable Object class its wrangler config
// binds, and nothing else; a rule worth testing lives in a leaf module instead. Read from the source, since
// importing an entry module needs the Workers runtime.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(import.meta.dirname, "../../src");

/** The runtime names a module exports: `default`, or what an `export` statement declares. Types are erased. */
export function runtimeExports(source: string): string[] {
  const names: string[] = [];
  for (const [, rest] of source.matchAll(/^export\s+(.*)$/gm)) {
    if (/^(type|interface|declare)\b/.test(rest)) continue;
    if (/^default\b/.test(rest)) names.push("default");
    else if (rest.startsWith("{") || rest.startsWith("*")) names.push(rest.split(/\s+from\s+/)[0]);
    else names.push(rest.match(/^(?:async\s+)?(?:abstract\s+)?(?:class|function\*?|const|let|var|enum)\s+(\w+)/)?.[1] ?? rest);
  }
  return names.sort();
}

describe("entry modules", () => {
  it.each([
    ["index.ts", ["LorePaidMCP", "default"]],
    ["hosted/index.ts", ["HostedStore", "default"]]
  ])("%s exports only its handler and its Durable Object", (file, names) => {
    expect(runtimeExports(readFileSync(resolve(SRC, file), "utf8"))).toEqual(names);
  });

  it("would notice: the scan reads every kind of runtime export, and skips types", () => {
    const source = [
      "export default {};",
      "export class A {}",
      "export const B = 1;",
      "export async function C() {}",
      "export { D } from './d.js';",
      "export type E = string;",
      "export interface F {}",
      "  export const indented = 1;"
    ].join("\n");
    expect(runtimeExports(source)).toEqual(["A", "B", "C", "default", "{ D }"]);
  });
});

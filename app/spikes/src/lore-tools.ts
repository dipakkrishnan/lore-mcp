import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { ask } from "./interaction.js";

const run = promisify(execFile);

/**
 * The exact three-seam tool surface from APP-004. This file is the reference
 * implementation the Electron main process will lift: same allowlist, same
 * scoping, different ask_user transport (IPC instead of readline).
 */

// First token → allowed second tokens (null = any/none). Approval and serve
// subcommands are deliberately absent: approvals stay app-invoked.
const ALLOWED: Record<string, readonly string[] | null> = {
  status: null,
  setup: null,
  sync: null,
  search: null,
  help: null,
  price: null,
  profile: null,
  capture: ["apply"],
  blueprint: ["apply", "show"],
  publication: ["list"],
  push: null,
  node: ["deploy"]
};

export function allowedArgv(argv: readonly string[]): string | undefined {
  if (!argv.length) return "empty command";
  const allowed = ALLOWED[argv[0]];
  if (allowed === undefined) return `'lore ${argv[0]}' is not on the desktop allowlist`;
  if (allowed && !allowed.includes(argv[1] ?? "")) {
    return `'lore ${argv.slice(0, 2).join(" ")}' is not on the desktop allowlist`;
  }
  return undefined;
}

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }], details: {} };
}

export function createLoreTools(loreHome: string): AgentTool<any>[] {
  const cliParameters = Type.Object(
    { argv: Type.Array(Type.String(), { minItems: 1 }) },
    { additionalProperties: false }
  );
  const loreCli: AgentTool<typeof cliParameters> = {
    name: "lore_cli",
    label: "Run lore",
    description:
      "Run the lore CLI with an argv array (no shell). Allowed: status, setup, sync, " +
      "search, help, price, profile, capture apply, blueprint apply/show, publication list, " +
      "push, node deploy. Approval commands are owner-only and unavailable.",
    parameters: cliParameters,
    async execute(_callId, { argv }) {
      const rejection = allowedArgv(argv);
      if (rejection) return text(`refused: ${rejection}`);
      try {
        const { stdout, stderr } = await run("lore", argv, {
          env: { ...process.env, LORE_HOME: loreHome, NO_COLOR: "1" },
          timeout: 120_000,
          maxBuffer: 4 * 1024 * 1024
        });
        return text((stdout + (stderr ? `\n${stderr}` : "")).trim() || "(no output)");
      } catch (error: any) {
        return text(`lore exited ${error.code ?? "?"}: ${String(error.stderr || error.message).slice(0, 2000)}`);
      }
    }
  };

  const scopedRoots = [
    resolve(homedir(), ".claude"),
    resolve(homedir(), ".codex"),
    resolve(homedir(), ".agents"),
    resolve(loreHome)
  ];
  const readParameters = Type.Object(
    { path: Type.String() },
    { additionalProperties: false }
  );
  const readContextFile: AgentTool<typeof readParameters> = {
    name: "read_context_file",
    label: "Read context file",
    description:
      "Read one file from the owner's agent-history directories (~/.claude, ~/.codex, " +
      "~/.agents) or the Lore home. Other paths are refused.",
    parameters: readParameters,
    async execute(_callId, { path }) {
      let real: string;
      try {
        real = realpathSync(resolve(path.replace(/^~/, homedir())));
      } catch {
        return text(`refused: cannot resolve ${path}`);
      }
      if (!scopedRoots.some((root) => real === root || real.startsWith(root + "/"))) {
        return text(`refused: ${path} is outside the scoped roots`);
      }
      try {
        const body = readFileSync(real, "utf8");
        return text(body.length > 100_000 ? body.slice(0, 100_000) + "\n…(truncated)" : body);
      } catch (error) {
        return text(`read failed: ${String(error).slice(0, 300)}`);
      }
    }
  };

  // Terminal implementation of the APP-003 ask_user contract; the app swaps
  // the execute body for an IPC round-trip to the renderer.
  const askParameters = Type.Object(
    {
      questions: Type.Array(
        Type.Object(
          {
            question: Type.String(),
            header: Type.String(),
            options: Type.Array(
              Type.Object(
                { label: Type.String(), description: Type.String() },
                { additionalProperties: false }
              )
            ),
            multiSelect: Type.Boolean()
          },
          { additionalProperties: false }
        ),
        { minItems: 1, maxItems: 4 }
      )
    },
    { additionalProperties: false }
  );
  const askUser: AgentTool<typeof askParameters> = {
    name: "ask_user",
    label: "Ask the owner",
    description:
      "Ask the owner up to 4 structured questions. Each returns the selected option " +
      "label(s) or free text. Use for decisions, not for confirmation of every step.",
    parameters: askParameters,
    async execute(_callId, { questions }) {
      const answers: Record<string, string> = {};
      for (const q of questions) {
        console.log(`\n[${q.header}] ${q.question}`);
        q.options.forEach((option, index) =>
          console.log(`  ${index + 1}. ${option.label} — ${option.description}`)
        );
        const raw = await ask(
          q.multiSelect ? "Choose numbers (comma-separated) or type an answer: " : "Choose a number or type an answer: "
        );
        const picks = raw
          .split(",")
          .map((part) => q.options[Number(part.trim()) - 1]?.label)
          .filter(Boolean);
        answers[q.question] = picks.length ? picks.join(", ") : raw.trim();
      }
      return text(JSON.stringify({ answers }));
    }
  };

  return [loreCli, readContextFile, askUser];
}

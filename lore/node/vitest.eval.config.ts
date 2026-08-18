import { readFileSync } from "node:fs";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineProject } from "vitest/config";

const inputPath = process.env.LORE_EVAL_INPUT;
const question = process.env.LORE_EVAL_QUESTION;
const model = process.env.LORE_ANSWER_MODEL || "claude-sonnet-5";
const fake = process.env.LORE_TEST_FAKE === "1";

if (!inputPath || !question) throw new Error("lore-test.sh must supply eval input and a question");
if (!fake && model === "claude-sonnet-5" && !process.env.ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY is required for claude-sonnet-5");
}
if (!fake && model === "gpt-5.6-luna" && !process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is required for gpt-5.6-luna");
}

export default defineProject({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: "2026-06-11",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["LORE_DB"],
        bindings: {
          LORE_EVAL_INPUT: readFileSync(inputPath, "utf8"),
          LORE_EVAL_QUESTION: question,
          LORE_ANSWER_MODEL: model,
          ...(fake
            ? { ANTHROPIC_API_KEY: "test-key", LORE_TEST_FAKE: "1" }
            : {
                ...(process.env.ANTHROPIC_API_KEY
                  ? { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY }
                  : {}),
                ...(process.env.OPENAI_API_KEY ? { OPENAI_API_KEY: process.env.OPENAI_API_KEY } : {})
              })
        }
      }
    })
  ],
  test: {
    include: ["eval/**/*.test.ts"],
    testTimeout: 200_000
  }
});

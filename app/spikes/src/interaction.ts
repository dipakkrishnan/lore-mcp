import { createInterface } from "node:readline/promises";
import { spawn } from "node:child_process";
import type { AuthInteraction } from "@earendil-works/pi-ai";

export function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return rl.question(question).finally(() => rl.close());
}

/**
 * Terminal AuthInteraction: prints flow events, opens the browser for
 * auth_url, and prompts on stdin. The desktop app implements the same
 * interface with IPC to the renderer.
 */
export function terminalInteraction(): AuthInteraction {
  return {
    async prompt(prompt) {
      const answer = await ask(`${prompt.message} `);
      return answer.trim();
    },
    notify(event) {
      if (event.type === "auth_url") {
        console.log(`\nOpening browser: ${event.url}`);
        if (event.instructions) console.log(event.instructions);
        if (process.platform === "darwin") spawn("open", [event.url], { stdio: "ignore" });
      } else if (event.type === "device_code") {
        console.log(`\nGo to ${event.verificationUri} and enter code: ${event.userCode}`);
      } else if (event.type === "info") {
        console.log(event.message);
      } else if (event.type === "progress") {
        console.log(`  … ${event.message}`);
      }
    }
  };
}

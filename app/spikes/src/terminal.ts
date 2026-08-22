import { createInterface } from "node:readline/promises";
import { spawn } from "node:child_process";
import type { AuthInteraction, AuthPrompt, AuthEvent } from "@earendil-works/pi-ai";
import type { OwnerChannel, OwnerQuestion } from "./kernel.js";

export class Terminal implements AuthInteraction, OwnerChannel {
  async read(question: string): Promise<string> {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    return rl.question(question).finally(() => rl.close());
  }

  async prompt(prompt: AuthPrompt): Promise<string> {
    return (await this.read(`${prompt.message} `)).trim();
  }

  notify(event: AuthEvent): void {
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

  async ask(questions: OwnerQuestion[]): Promise<Record<string, string>> {
    const answers: Record<string, string> = {};
    for (const q of questions) {
      console.log(`\n[${q.header}] ${q.question}`);
      q.options.forEach((option, index) => console.log(`  ${index + 1}. ${option.label} — ${option.description}`));
      const raw = await this.read(
        q.multiSelect ? "Choose numbers (comma-separated) or type an answer: " : "Choose a number or type an answer: "
      );
      const picks = raw
        .split(",")
        .map((part) => q.options[Number(part.trim()) - 1]?.label)
        .filter(Boolean);
      answers[q.question] = picks.length ? picks.join(", ") : raw.trim();
    }
    return answers;
  }
}

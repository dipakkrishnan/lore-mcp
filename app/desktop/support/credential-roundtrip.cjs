const assert = require("node:assert/strict");
const { join } = require("node:path");
const { app, safeStorage } = require("electron");

const [mode, directory] = process.argv.slice(-2);
app.setPath("userData", directory);

app.whenReady().then(async () => {
  const { CredentialStore } = await import("../src/credentials.mjs");
  const store = new CredentialStore(join(directory, "credentials.bin"), safeStorage);
  if (mode === "write") {
    await store.modify("anthropic", async () => ({ type: "api_key", key: "test-secret" }));
  } else {
    assert.deepEqual(await store.read("anthropic"), { type: "api_key", key: "test-secret" });
  }
  app.quit();
});

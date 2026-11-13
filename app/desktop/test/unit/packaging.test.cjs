// XC-126: packaging reads Electron's zip from the download cache and checks it
// against the checksums the electron package ships, so a cached build asks
// GitHub for nothing, not even SHASUMS256.txt.
const test = require("node:test");
const assert = require("node:assert/strict");

const config = require("../../forge.config.js");
const { version } = require("electron/package.json");

test("packaging checks Electron's zip against the shipped checksums, not a download", () => {
  const { checksums } = config.packagerConfig.download;
  assert.deepEqual(checksums, require("electron/checksums.json"));
  assert.match(checksums[`electron-v${version}-darwin-arm64.zip`], /^[0-9a-f]{64}$/);
});

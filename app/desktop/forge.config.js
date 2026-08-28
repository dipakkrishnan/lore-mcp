const { execFileSync } = require("node:child_process");
const { join } = require("node:path");

const out = join(__dirname, "packaging/out");

module.exports = {
  packagerConfig: {
    name: "Lore",
    appBundleId: "com.lore.desktop",
    appCategoryType: "public.app-category.productivity",
    icon: join(out, "icon"),
    extendInfo: {
      NSMicrophoneUsageDescription: "Lore listens while you dictate a memory.",
      NSSpeechRecognitionUsageDescription: "Lore turns your dictation into text on this Mac."
    },
    ignore: [/^\/(packaging|out|test|support)($|\/)/, /^\/(test-capture\.sh|tsconfig\.json|forge\.config\.js)$/],
    extraResource: [
      join(out, "uv"),
      join(out, "node"),
      join(out, "dictate"),
      join(out, "wheels"),
      join(out, "overrides.txt"),
      join(out, "runtime.json"),
      join(__dirname, "../../plugins/lore/skills")
    ],
    ...(process.env.LORE_SIGN_IDENTITY ? { osxSign: { identity: process.env.LORE_SIGN_IDENTITY } } : {}),
    ...(process.env.APPLE_API_KEY
      ? {
          osxNotarize: {
            appleApiKey: process.env.APPLE_API_KEY,
            appleApiKeyId: process.env.APPLE_API_KEY_ID,
            appleApiIssuer: process.env.APPLE_API_ISSUER
          }
        }
      : {})
  },
  hooks: {
    generateAssets: () => {
      for (const script of ["icon.sh", "wheelhouse.sh", "node.sh", "dictate.sh"]) execFileSync(join(__dirname, "packaging", script), { stdio: "inherit" });
    }
  },
  makers: [{ name: "@electron-forge/maker-zip", platforms: ["darwin"] }]
};

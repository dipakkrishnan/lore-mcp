const { execFileSync } = require("node:child_process");
const { join } = require("node:path");

const out = join(__dirname, "packaging/out");

module.exports = {
  packagerConfig: {
    name: "Lore",
    appBundleId: "com.lore.desktop",
    appCategoryType: "public.app-category.productivity",
    ignore: [/^\/(packaging|out|test|support)($|\/)/, /^\/(test-capture\.sh|tsconfig\.json|forge\.config\.js)$/],
    extraResource: [
      join(out, "uv"),
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
    generateAssets: () => execFileSync(join(__dirname, "packaging/wheelhouse.sh"), { stdio: "inherit" })
  },
  makers: [{ name: "@electron-forge/maker-zip", platforms: ["darwin"] }]
};

import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      // Wrangler generates this declaration with its own blanket suppression.
      "env.d.ts"
    ]
  },
  eslint.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      // The mocked global fetch() must return Promise<Response> even when a
      // canned reply needs no await, mirroring lore/node/eslint.config.js's
      // McpAgent.init rationale for the same rule.
      "@typescript-eslint/require-await": "off"
    }
  }
);

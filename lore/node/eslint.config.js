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
      // McpAgent requires `init` to return a Promise even when registration is synchronous.
      "@typescript-eslint/require-await": "off"
    }
  }
);

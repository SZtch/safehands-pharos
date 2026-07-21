import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "node_modules/",
      "dist/",
      "dist-anvita/",
      "artifacts/",
      "cache/",
      "typechain-types/",
      "public/",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      // ~100 pre-existing `any`s (mostly viem/RPC boundaries). Typing them is
      // tracked debt — enable once the boundary types are cleaned up.
      "@typescript-eslint/no-explicit-any": "off",
      // Empty catch is the deliberate fail-soft pattern for optional lookups.
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        fetch: "readonly",
        URL: "readonly",
        AbortController: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        module: "writable",
        require: "readonly",
        __dirname: "readonly",
      },
    },
  },
  {
    // The landing page ships to a browser, not to Node, so it gets browser
    // globals instead. Keeping it linted is the point: it is how the missing
    // action line in the specimen inspector was caught.
    files: ["site/**/*.js"],
    languageOptions: {
      globals: {
        document: "readonly",
        window: "readonly",
        matchMedia: "readonly",
        getComputedStyle: "readonly",
        performance: "readonly",
        requestAnimationFrame: "readonly",
        cancelAnimationFrame: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
      },
    },
  },
);

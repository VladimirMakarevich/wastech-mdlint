import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "coverage/**", ".vitest/**", "packages/**/dist/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.node,
    },
  },
  {
    // A product module past this many lines of code has stopped being one purpose: the viewer's
    // server reached 2200 lines as one closure, every feature a handler added inside it, because
    // nothing said stop. A warning, not an error, so a long file is flagged in every run without
    // failing the gate before the ones already over it are split. Tests are left out: a suite is
    // long because its cases are, and splitting one by count scatters the fixtures they share.
    files: ["packages/*/src/**/*.ts"],
    rules: {
      "max-lines": [
        "warn",
        { max: 800, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  {
    // The viewer's page script runs in a browser, where Node's globals do not exist.
    files: ["packages/viewer/src/client/**/*.ts"],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.node,
    },
  },
);

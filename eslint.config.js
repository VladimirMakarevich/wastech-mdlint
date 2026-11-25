import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

// Errors are rules the code already keeps, so a new violation fails the gate. Warnings are the
// structural limits several existing modules are still over: they are flagged in every run without
// failing it, until those modules are split.

export default tseslint.config(
  {
    ignores: ["dist/**", "coverage/**", ".vitest/**", "packages/**/dist/**"],
  },
  js.configs.recommended,
  {
    // Every TypeScript file, tests included. Tests belong to no tsconfig - each package's `include`
    // is its emit contract - so the rules that need type information cannot run on them; the strict
    // and stylistic sets without types can.
    files: ["**/*.ts"],
    extends: [...tseslint.configs.strict, ...tseslint.configs.stylistic],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.node,
    },
    rules: {
      // Every index and key lookup has `noUncheckedIndexedAccess` behind it, so a `!` states a bound
      // the code has proven, as `lines[index]!` inside a loop over `lines` does. Banning it would
      // turn each into a branch that can never run.
      "@typescript-eslint/no-non-null-assertion": "off",
      // Object shapes are `type` aliases throughout: one way to write them, and an alias cannot be
      // reopened by a second declaration of the same name elsewhere.
      "@typescript-eslint/consistent-type-definitions": ["error", "type"],
      // An empty arrow is the no-op a stop function or a swallowed rejection is meant to be.
      "@typescript-eslint/no-empty-function": [
        "error",
        { allow: ["arrowFunctions"] },
      ],
      eqeqeq: "error",
      curly: ["error", "all"],
      "no-param-reassign": "error",
      // Output goes through the stream a command was given, which tests replace; `console` would
      // write past them to the real terminal.
      "no-console": "error",
      "no-implicit-coercion": "error",
      "object-shorthand": "error",
      "prefer-template": "error",
      "no-else-return": "error",
      "default-case-last": "error",
      "no-lonely-if": "error",
      "no-unneeded-ternary": "error",
      "prefer-arrow-callback": "error",
    },
  },
  {
    // Product code, with type information: the strict set's checks on promises, `any` and
    // conditions the types already decide.
    files: ["packages/*/src/**/*.ts"],
    extends: [
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // The strict set turns these off again; the reasons above hold here too.
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/consistent-type-definitions": ["error", "type"],
      "@typescript-eslint/no-empty-function": [
        "error",
        { allow: ["arrowFunctions"] },
      ],
      // A number reads the same in every locale when interpolated; an object or `undefined` does
      // not read at all, which is what this rule is for.
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true },
      ],
      // A `default` branch is a decision about every other case, written down; a switch without one
      // must name every member of the union, so a member added later fails here, not at runtime.
      "@typescript-eslint/switch-exhaustiveness-check": [
        "error",
        { considerDefaultExhaustiveForUnions: true },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/prefer-readonly": "error",
      "@typescript-eslint/strict-boolean-expressions": "error",
      // Output is sorted with the shared code-point comparator; a bare `sort()` on anything but
      // strings sorts numbers as text.
      "@typescript-eslint/require-array-sort-compare": [
        "error",
        { ignoreStringArrays: true },
      ],
      "no-shadow": "off",
      "@typescript-eslint/no-shadow": "error",

      // A product module or function past these limits has stopped being one purpose: the viewer's
      // server reached 2200 lines as one closure, every feature a handler added inside it, because
      // nothing said stop. Tests are left out: a suite is long because its cases are, and splitting
      // one by count scatters the fixtures they share.
      "max-lines": [
        "warn",
        { max: 800, skipBlankLines: true, skipComments: true },
      ],
      "max-lines-per-function": [
        "warn",
        { max: 80, skipBlankLines: true, skipComments: true },
      ],
      complexity: ["warn", 15],
      "max-statements": ["warn", 40],
      "max-depth": ["warn", 4],
      "max-params": ["warn", 4],
      "no-nested-ternary": "warn",
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

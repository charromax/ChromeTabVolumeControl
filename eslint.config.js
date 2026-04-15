import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        ...globals.browser,
        ...globals.webextensions,
      },
    },
    rules: {
      "no-unused-vars": "warn",
      "no-console": "warn",
      "no-undef": "error",
      "eqeqeq": ["error", "always"],
      "no-var": "error",
      "prefer-const": "warn",
    },
  },
];

import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["node_modules/"] },
  js.configs.recommended,
  {
    files: ["frontend/**/*.js"],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        ...globals.node,
        performance: "readonly",
      },
    },
  },
];

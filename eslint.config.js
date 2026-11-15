import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/coverage/**"] },
  js.configs.recommended,
  {
    files: ["apps/web/sw.template.js"],
    languageOptions: {
      globals: {
        self: "readonly",
        caches: "readonly",
        URL: "readonly",
        fetch: "readonly",
      },
    },
  },
  ...tseslint.configs.recommended,
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
);

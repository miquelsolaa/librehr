import js from "@eslint/js";
import tseslint from "typescript-eslint";
import { boundaryConfigs } from "./boundaries.js";
import { designSystemConfigs } from "./design-system.js";

export const baseConfig = tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  {
    files: ["**/*.cjs"],
    languageOptions: {
      globals: {
        module: "readonly",
        require: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
      },
    },
  },
  // Import boundaries (AGENTS.md section 2); see boundaries.js.
  ...boundaryConfigs,
  // Type scale and other DESIGN.md rules for UI code; see design-system.js.
  ...designSystemConfigs,
);

export default baseConfig;

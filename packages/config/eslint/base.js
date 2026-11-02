import js from "@eslint/js";
import tseslint from "typescript-eslint";

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
  {
    // Packages/core boundary: core imports nothing internal, and no I/O
    files: ["packages/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "@librehr/db", message: "core must never import db" },
            { name: "@librehr/api", message: "core must never import api" },
            { name: "@librehr/web", message: "core must never import web" },
            {
              name: "@librehr/contracts",
              message: "core must never import contracts",
            },
            { name: "@librehr/ui", message: "core must never import ui" },
            {
              name: "@librehr/emails",
              message: "core must never import emails",
            },
            {
              name: "@librehr/worker",
              message: "core must never import worker",
            },
            { name: "fs", message: "core must be pure domain without I/O" },
            {
              name: "node:fs",
              message: "core must be pure domain without I/O",
            },
            { name: "path", message: "core must be pure domain without I/O" },
            {
              name: "node:path",
              message: "core must be pure domain without I/O",
            },
          ],
        },
      ],
    },
  },
  {
    // Web boundaries: web cannot import db, api, or worker
    files: ["apps/web/**/*.ts", "apps/web/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "@librehr/db", message: "web cannot import db" },
            { name: "@librehr/api", message: "web cannot import api" },
            { name: "@librehr/worker", message: "web cannot import worker" },
          ],
        },
      ],
    },
  },
  {
    // API boundaries: api cannot import web or ui
    files: ["apps/api/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "@librehr/web", message: "api cannot import web" },
            { name: "@librehr/ui", message: "api cannot import ui" },
          ],
        },
      ],
    },
  },
  {
    // Worker boundaries: worker cannot import web, api, ui
    files: ["apps/worker/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "@librehr/web", message: "worker cannot import web" },
            { name: "@librehr/api", message: "worker cannot import api" },
            { name: "@librehr/ui", message: "worker cannot import ui" },
          ],
        },
      ],
    },
  },
);

export default baseConfig;

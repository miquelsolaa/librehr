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
            { name: "@openhr/db", message: "core must never import db" },
            { name: "@openhr/api", message: "core must never import api" },
            { name: "@openhr/web", message: "core must never import web" },
            {
              name: "@openhr/contracts",
              message: "core must never import contracts",
            },
            { name: "@openhr/ui", message: "core must never import ui" },
            {
              name: "@openhr/emails",
              message: "core must never import emails",
            },
            {
              name: "@openhr/worker",
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
            { name: "@openhr/db", message: "web cannot import db" },
            { name: "@openhr/api", message: "web cannot import api" },
            { name: "@openhr/worker", message: "web cannot import worker" },
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
            { name: "@openhr/web", message: "api cannot import web" },
            { name: "@openhr/ui", message: "api cannot import ui" },
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
            { name: "@openhr/web", message: "worker cannot import web" },
            { name: "@openhr/api", message: "worker cannot import api" },
            { name: "@openhr/ui", message: "worker cannot import ui" },
          ],
        },
      ],
    },
  },
);

export default baseConfig;

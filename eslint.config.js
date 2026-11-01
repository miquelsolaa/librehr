import baseConfig from "@openhr/config/eslint/base";

export default [
  ...baseConfig,
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/storybook-static/**",
      "**/*.tsbuildinfo",
      "packages/contracts/generated/**",
      "packages/db/migrations/meta/**",
    ],
  },
];

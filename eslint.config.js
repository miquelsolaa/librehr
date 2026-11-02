import baseConfig from "@librehr/config/eslint/base";

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
      "scripts/**",
    ],
  },
];

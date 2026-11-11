import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: ["../stories/**/*.stories.@(js|jsx|mjs|ts|tsx)"],
  // Storybook 9+ folds actions, controls, backgrounds, viewport etc. into core;
  // only docs (autodocs via the "autodocs" story tag) remains a separate addon.
  addons: ["@storybook/addon-docs", "@storybook/addon-a11y"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  core: {
    // AGENTS.md: no telemetry or outbound calls from our tooling.
    disableTelemetry: true,
  },
};

export default config;

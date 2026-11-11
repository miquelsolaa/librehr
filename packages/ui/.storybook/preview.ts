import type { Preview } from "@storybook/react-vite";
import "../src/tokens.css";

const preview: Preview = {
  parameters: {
    actions: { argTypesRegex: "^on[A-Z].*" },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      context: "#storybook-root",
      config: {},
      options: {},
    },
  },
  initialGlobals: {
    a11y: { manual: false },
  },
};

export default preview;

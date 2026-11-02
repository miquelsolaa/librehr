import type { Config } from "tailwindcss";
import { librehrTailwindPreset } from "@librehr/config/tailwind";

const config: Config = {
  presets: [librehrTailwindPreset as unknown as Config],
  content: ["./src/**/*.{ts,tsx}", "../../packages/ui/src/**/*.{ts,tsx}"],
  plugins: [],
};

export default config;

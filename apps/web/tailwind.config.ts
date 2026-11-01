import type { Config } from "tailwindcss";
import { openhrTailwindPreset } from "@openhr/config/tailwind";

const config: Config = {
  presets: [openhrTailwindPreset as unknown as Config],
  content: ["./src/**/*.{ts,tsx}", "../../packages/ui/src/**/*.{ts,tsx}"],
  plugins: [],
};

export default config;

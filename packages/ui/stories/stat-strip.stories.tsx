import type { Meta, StoryObj } from "@storybook/react-vite";
import { StatStrip } from "../src/components/stat-strip.js";

const meta: Meta<typeof StatStrip> = {
  title: "Domain/StatStrip",
  component: StatStrip,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof StatStrip>;

export const Month: Story = {
  args: {
    items: [
      { label: "Worked", value: "142h 30m", hint: "Expected: 160h" },
      { label: "Breaks", value: "11h 05m" },
      { label: "Balance", value: "−17h 30m" },
    ],
  },
};

export const WithAName: Story = {
  args: {
    items: [
      { label: "Shifts assigned", value: 48 },
      { label: "Night hours", value: "64h", hint: "8 night shifts" },
      { label: "Rotation", value: "Four on, two off", text: true },
    ],
  },
};

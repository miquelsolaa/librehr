import type { Meta, StoryObj } from "@storybook/react-vite";
import { DayRing } from "../src/components/day-ring.js";

const meta: Meta<typeof DayRing> = {
  title: "Domain/DayRing",
  component: DayRing,
  tags: ["autodocs"],
  args: { size: 96 },
};

export default meta;
type Story = StoryObj<typeof DayRing>;

export const NotClockedIn: Story = { args: { tone: "idle" } };

/** Working since 9:00, three hours in. */
export const Working: Story = {
  args: { tone: "working", from: 0.75, span: 0.25 },
};

/** On a break since 13:30, twenty minutes in. */
export const OnBreak: Story = {
  args: { tone: "break", from: 1.5 / 12, span: 20 / 720 },
};

/** Back from lunch: the morning stays on the dial. */
export const DaySoFar: Story = {
  args: {
    tone: "working",
    from: 3 / 12,
    span: 1 / 12,
    earlier: [{ from: 0.75, span: 5 / 12 }],
  },
};

export const JustStarted: Story = {
  args: { tone: "working", from: 8 / 12, span: 0 },
};

/** The size used next to the status in the top bar. */
export const Compact: Story = {
  args: { tone: "working", from: 0.75, span: 0.25, size: 18 },
};

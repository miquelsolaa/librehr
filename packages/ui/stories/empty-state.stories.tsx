import type { Meta, StoryObj } from "@storybook/react-vite";
import { EmptyState } from "../src/components/empty-state.js";

const meta: Meta<typeof EmptyState> = {
  title: "Components/EmptyState",
  component: EmptyState,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof EmptyState>;

export const Default: Story = {
  args: {
    title: "No time off requests",
    description:
      "You haven't requested any time off yet. Click below to submit your first request.",
    actionLabel: "Request time off",
    onAction: () => alert("Clicked"),
  },
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import { SecretField } from "../src/components/secret-field.js";

const meta: Meta<typeof SecretField> = {
  title: "Components/SecretField",
  component: SecretField,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof SecretField>;

export const Default: Story = {
  args: {
    label: "National Identity Number (DNI/NIE)",
    value: "12345678Z",
    onReveal: () => {},
  },
};

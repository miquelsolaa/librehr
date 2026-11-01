import { describe, it, expect } from "vitest";
import { render } from "@react-email/render";
import { InviteEmail } from "../src/templates/invite.js";
import { PasswordResetEmail } from "../src/templates/password-reset.js";

describe("React Email templates", () => {
  it("renders InviteEmail template", async () => {
    const html = await render(
      <InviteEmail
        orgName="Acme Corp"
        inviteUrl="http://localhost:3000/invite/123"
      />,
    );
    expect(html).toContain("Acme Corp");
    expect(html).toContain("http://localhost:3000/invite/123");
  });

  it("renders PasswordResetEmail template", async () => {
    const html = await render(
      <PasswordResetEmail resetUrl="http://localhost:3000/reset-password/abc" />,
    );
    expect(html).toContain("http://localhost:3000/reset-password/abc");
  });
});

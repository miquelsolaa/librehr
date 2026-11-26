import { describe, expect, it } from "vitest";
import { invitationEmail } from "../src/lib/invitation-email.js";

// AUTH-005: invitation emails carry an absolute link that opens from a mail client.
describe("invitationEmail", () => {
  it("builds an absolute link in the organization's locale", () => {
    const email = invitationEmail(
      "https://hr.example.invalid/",
      "es",
      "Acme",
      "abc123",
    );
    expect(email.html).toContain(
      'href="https://hr.example.invalid/es/invite/abc123"',
    );
    expect(email.text).toContain("https://hr.example.invalid/es/invite/abc123");
    expect(email.subject).toBe("Invitación a Acme en LibreHR");
  });

  it("falls back to Catalan for an unknown locale", () => {
    const email = invitationEmail(
      "https://hr.example.invalid",
      "fr",
      "Acme",
      "t",
    );
    expect(email.html).toContain("/ca/invite/t");
  });

  it("escapes the organization name in the HTML", () => {
    const email = invitationEmail(
      "https://hr.example.invalid",
      "en",
      '<script>alert("x")</script>',
      "t",
    );
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
  });
});

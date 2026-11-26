import { describe, expect, it } from "vitest";
import { emailVerificationEmail } from "../src/lib/email-verification.js";

// AUTH-001: the verification email carries an absolute link with the token
// in the URL fragment, in the requested locale.
describe("emailVerificationEmail", () => {
  it.each([
    ["ca", "Confirma la teva adreça electrònica a LibreHR", "24 hores"],
    ["es", "Confirma tu dirección de correo en LibreHR", "24 horas"],
    ["en", "Confirm your email address on LibreHR", "24 hours"],
  ])(
    "builds the %s email with an absolute fragment link",
    (locale, subject, ttl) => {
      const email = emailVerificationEmail(
        "https://hr.example.invalid/",
        locale,
        "abc_123-x",
      );
      const url = `https://hr.example.invalid/${locale}/verify-email#token=abc_123-x`;
      expect(email.subject).toBe(subject);
      expect(email.html).toContain(`href="${url}"`);
      expect(email.text).toContain(url);
      expect(email.text).toContain(ttl);
    },
  );

  it("falls back to Catalan for an unsupported or missing locale", () => {
    expect(
      emailVerificationEmail("https://hr.example.invalid", "fr", "t").html,
    ).toContain("/ca/verify-email#token=t");
    expect(
      emailVerificationEmail("https://hr.example.invalid", undefined, "t")
        .subject,
    ).toBe("Confirma la teva adreça electrònica a LibreHR");
  });

  it("announces the configured lifetime in whole hours", () => {
    const email = emailVerificationEmail(
      "https://hr.example.invalid",
      "en",
      "t",
      90 * 60 * 1000,
    );
    expect(email.text).toContain("expires in 2 hours");
    expect(
      emailVerificationEmail("https://hr.example.invalid", "en", "t", 1000)
        .text,
    ).toContain("expires in 1 hour ");
  });

  it("escapes the link in the HTML", () => {
    const email = emailVerificationEmail(
      'https://hr.example.invalid/"><script>',
      "en",
      "t",
    );
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&quot;&gt;&lt;script&gt;");
  });
});

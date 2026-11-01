import { describe, it, expect } from "vitest";
import { validateIban, normalizeIban } from "../src/identity/iban.js";

describe("IBAN Validation (ISO 13616)", () => {
  it("normalizes IBAN strings", () => {
    expect(normalizeIban("ES91 2100 0418 4502 0005 1332")).toBe(
      "ES9121000418450200051332",
    );
  });

  it("validates valid Spanish IBANs", () => {
    // Real valid test IBAN format for Spain (24 chars)
    expect(validateIban("ES9121000418450200051332").valid).toBe(true);
    expect(validateIban("ES91 2100 0418 4502 0005 1332").valid).toBe(true);
  });

  it("validates valid international IBANs", () => {
    // France (27 chars)
    expect(validateIban("FR1420041010050500013M02606").valid).toBe(true);
    // Germany (22 chars)
    expect(validateIban("DE89370400440532013000").valid).toBe(true);
  });

  it("rejects invalid IBANs", () => {
    // Tampered check digits
    expect(validateIban("ES0021000418450200051332").valid).toBe(false);
    // Invalid length for Spain (23 chars instead of 24)
    expect(validateIban("ES912100041845020005133").valid).toBe(false);
    // Empty
    expect(validateIban("").valid).toBe(false);
    // Not an IBAN
    expect(validateIban("123456").valid).toBe(false);
  });
});

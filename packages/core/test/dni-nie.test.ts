import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  validateDni,
  validateNie,
  validateCif,
  validateSpanishId,
  normalizeSpanishId,
} from "../src/identity/dni-nie.js";

const DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";

describe("Spanish ID Validation (DNI, NIE, CIF)", () => {
  it("normalizes input correctly", () => {
    expect(normalizeSpanishId(" 12.345.678 - z ")).toBe("12345678Z");
    expect(normalizeSpanishId("x-1234567_l")).toBe("X1234567L");
  });

  it("validates standard valid DNIs", () => {
    // 12345678 % 23 = 14 -> Z
    expect(validateDni("12345678Z")).toBe(true);
    // 00000000 % 23 = 0 -> T
    expect(validateDni("00000000T")).toBe(true);
    // 00000001 % 23 = 1 -> R
    expect(validateDni("00000001R")).toBe(true);
  });

  it("rejects DNI with invalid control letter or invalid format", () => {
    expect(validateDni("12345678A")).toBe(false);
    expect(validateDni("1234567Z")).toBe(false);
    expect(validateDni("123456789Z")).toBe(false);
    expect(validateDni("123456789")).toBe(false);
  });

  it("validates standard valid NIEs", () => {
    // X0000001 -> 00000001 % 23 = 1 -> R
    expect(validateNie("X0000001R")).toBe(true);
    // Y0000000 -> 10000000 % 23 = 14 -> Z
    expect(validateNie("Y0000000Z")).toBe(true);
    // Z0000000 -> 20000000 % 23 = 5 -> M
    expect(validateNie("Z0000000M")).toBe(true);
  });

  it("validates Spanish CIFs for companies", () => {
    // Standard CIF format
    expect(validateCif("A58818501")).toBe(true);
    expect(validateCif("B12345678")).toBe(false); // wrong control
  });

  it("dispatches validateSpanishId accurately", () => {
    const resDni = validateSpanishId("12345678Z");
    expect(resDni.valid).toBe(true);
    expect(resDni.type).toBe("dni");

    const resNie = validateSpanishId("X0000001R");
    expect(resNie.valid).toBe(true);
    expect(resNie.type).toBe("nie");

    const resInvalid = validateSpanishId("invalid-format");
    expect(resInvalid.valid).toBe(false);
  });

  it("property test: DNI check letter invariant", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 99999999 }), (num) => {
        const numStr = String(num).padStart(8, "0");
        const correctLetter = DNI_LETTERS.charAt(num % 23);
        const validDni = `${numStr}${correctLetter}`;

        expect(validateDni(validDni)).toBe(true);

        // Pick a wrong letter
        const wrongLetter = DNI_LETTERS.charAt((num + 1) % 23);
        const invalidDni = `${numStr}${wrongLetter}`;
        expect(validateDni(invalidDni)).toBe(false);
      }),
      { numRuns: 200 },
    );
  });
});

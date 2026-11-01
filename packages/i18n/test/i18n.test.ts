import { describe, it, expect } from "vitest";
import { checkI18nKeys } from "../src/check.js";
import { locales, defaultLocale } from "../src/config.js";

describe("i18n catalogs", () => {
  it("should have matching keys across all supported locales", () => {
    const result = checkI18nKeys();
    expect(result.errors).toEqual([]);
    expect(result.success).toBe(true);
  });

  it("should have 'ca' as the default locale", () => {
    expect(defaultLocale).toBe("ca");
    expect(locales).toContain("ca");
    expect(locales).toContain("es");
    expect(locales).toContain("en");
  });
});

import { describe, it, expect } from "vitest";
import { trimTrailing } from "../src/identity/trim-trailing.js";
import { extractTemplateVariables } from "../src/documents/merge-templates.js";

describe("trimTrailing", () => {
  it("removes only the trailing run of the character", () => {
    expect(trimTrailing("a//b//", "/")).toBe("a//b");
    expect(trimTrailing("abc", "/")).toBe("abc");
    expect(trimTrailing("", "/")).toBe("");
    expect(trimTrailing("////", "/")).toBe("");
  });
});

describe("extractTemplateVariables without regex trims", () => {
  it("returns unique names and ignores placeholders with spaces", () => {
    expect(extractTemplateVariables("{{a.b}} {{a.b}} {{c}} {{ d }}")).toEqual([
      "a.b",
      "c",
    ]);
    expect(extractTemplateVariables("")).toEqual([]);
  });
});

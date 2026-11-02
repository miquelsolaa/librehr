import { describe, it, expect } from "vitest";
import { cn } from "../src/lib/cn.js";
import { Button } from "../src/components/button.js";
import { StatusPill } from "../src/components/status-pill.js";

describe("@librehr/ui components", () => {
  it("should merge class names correctly using cn", () => {
    expect(cn("px-2 py-1", "bg-primary", { hidden: false })).toBe(
      "px-2 py-1 bg-primary",
    );
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("should define Button component", () => {
    expect(Button).toBeDefined();
  });

  it("should define StatusPill component", () => {
    expect(StatusPill).toBeDefined();
  });
});

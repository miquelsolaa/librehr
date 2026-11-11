import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { StatStrip } from "../src/components/stat-strip.js";

describe("StatStrip", () => {
  const html = renderToStaticMarkup(
    <StatStrip
      items={[
        { label: "Worked", value: "142h 30m", hint: "Expected: 160h" },
        { label: "Breaks", value: "11h 05m" },
        { label: "Rotation", value: "Four on, two off", text: true },
      ]}
    />,
  );

  it("is a description list: every figure has its label", () => {
    expect(html.startsWith("<dl")).toBe(true);
    expect(html.match(/<dt/g)).toHaveLength(3);
    expect(html).toContain("Expected: 160h");
  });

  it("sets only the first figure as the lead", () => {
    expect(html.match(/text-4xl/g)).toHaveLength(1);
    expect(html.match(/bg-accent/g)).toHaveLength(1);
    expect(html.indexOf("text-4xl")).toBeLessThan(html.indexOf("Breaks"));
  });

  it("sets a name in text size, not as a figure", () => {
    expect(html).toMatch(/truncate text-base[^>]*>Four on, two off/);
  });
});

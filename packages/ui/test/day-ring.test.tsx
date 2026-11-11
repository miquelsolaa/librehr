import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { DayRing } from "../src/components/day-ring.js";

const CIRCUMFERENCE = 2 * Math.PI * 22;

/** The dash length of the arc, or `null` when no arc is drawn. */
function arcLength(html: string): number | null {
  const match = html.match(/stroke-dasharray="([\d.]+) /);
  return match?.[1] ? Number(match[1]) : null;
}

describe("DayRing", () => {
  it("is hidden from assistive technology: text carries the state", () => {
    const html = renderToStaticMarkup(<DayRing />);
    expect(html).toContain('aria-hidden="true"');
  });

  it("draws no arc when nothing is running", () => {
    expect(arcLength(renderToStaticMarkup(<DayRing />))).toBeNull();
    expect(
      arcLength(renderToStaticMarkup(<DayRing tone="idle" from={0.5} />)),
    ).toBeNull();
  });

  it("draws the arc from the start position, clockwise from 12 o'clock", () => {
    const html = renderToStaticMarkup(
      <DayRing tone="working" from={0.75} span={0.25} />,
    );
    expect(arcLength(html)).toBeCloseTo(CIRCUMFERENCE / 4, 3);
    // 0.75 of the dial is 9 o'clock: 270° from 12, minus SVG's 90° offset.
    expect(html).toContain('transform="rotate(180 32 32)"');
  });

  it("keeps a stretch that has just begun visible", () => {
    const html = renderToStaticMarkup(
      <DayRing tone="working" from={0} span={0} />,
    );
    expect(arcLength(html)).toBeGreaterThan(0);
  });

  it("never draws more than the full dial", () => {
    const html = renderToStaticMarkup(
      <DayRing tone="break" from={0.1} span={3} />,
    );
    expect(arcLength(html)).toBeCloseTo(CIRCUMFERENCE, 3);
  });

  it("draws stretches worked earlier under the current arc", () => {
    const html = renderToStaticMarkup(
      <DayRing
        tone="break"
        from={0.1}
        span={0.05}
        earlier={[
          { from: 0.75, span: 0.25 },
          { from: 0, span: 0.05 },
        ]}
      />,
    );
    expect(html.match(/opacity-40/g)).toHaveLength(2);
    // The earlier arcs come first, so the current one paints over them.
    expect(html.indexOf("opacity-40")).toBeLessThan(
      html.indexOf("stroke-linecap"),
    );
  });

  it("shows the day so far even when nothing is running", () => {
    const html = renderToStaticMarkup(
      <DayRing earlier={[{ from: 0.75, span: 0.25 }]} />,
    );
    expect(html.match(/opacity-40/g)).toHaveLength(1);
    expect(html).not.toContain("stroke-linecap");
  });

  it("takes a track colour for coloured surfaces", () => {
    expect(
      renderToStaticMarkup(<DayRing trackClassName="stroke-surface" />),
    ).toContain("stroke-surface");
  });

  it("uses the ochre accent for a break and pine for work", () => {
    expect(
      renderToStaticMarkup(<DayRing tone="break" from={0} span={0.1} />),
    ).toContain("text-brand-accent");
    expect(
      renderToStaticMarkup(<DayRing tone="working" from={0} span={0.1} />),
    ).toContain("text-primary");
  });
});

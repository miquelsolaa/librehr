import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BottomNav } from "../src/components/bottom-nav.js";
import { Sidebar, type NavItem } from "../src/components/sidebar.js";

const item = (href: string, label: string, badge?: number): NavItem => ({
  href,
  label,
  icon: <span />,
  ...(badge === undefined ? {} : { badge, badgeLabel: `${badge} pending` }),
});

describe("navigation badges", () => {
  it("names a bottom-bar item's count in words after the label", () => {
    const html = renderToStaticMarkup(
      <BottomNav
        items={[
          item("/en/home", "Home"),
          item("/en/approvals", "Approvals", 3),
        ]}
      />,
    );
    expect(html).toMatch(/Approvals<\/span><span class="sr-only">, 3 pending/);
    // The visual number is decoration; the words above carry it.
    expect(html).toMatch(/aria-hidden="true"[^>]*>3</);
    expect(html).not.toMatch(/<a[^>]*aria-label=/);
  });

  it("names the count on More when an overflow item has one", () => {
    const html = renderToStaticMarkup(
      <BottomNav
        items={[item("/en/home", "Home")]}
        overflowItems={[item("/en/approvals", "Approvals", 2)]}
        moreLabel="More"
        moreBadgeLabel={(n) => `${n} pending`}
      />,
    );
    expect(html).toMatch(/More<\/span><span class="sr-only">, 2 pending/);
  });

  it("adds nothing when no item has a count", () => {
    const html = renderToStaticMarkup(
      <BottomNav
        items={[item("/en/home", "Home")]}
        overflowItems={[item("/en/people", "People")]}
        moreLabel="More"
      />,
    );
    expect(html).not.toContain("sr-only");
    expect(html).not.toMatch(/rounded-full bg-primary/);
  });

  it("names a sidebar item's count in words", () => {
    const html = renderToStaticMarkup(
      <Sidebar items={[item("/en/approvals", "Approvals", 4)]} />,
    );
    expect(html).toMatch(
      /<span class="sr-only">, (<!-- -->)?4 pending<\/span>/,
    );
  });
});

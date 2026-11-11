import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { Sidebar, type NavItem } from "../src/components/sidebar.js";

const item = (href: string, label: string): NavItem => ({
  href,
  label,
  icon: <span />,
});

const me = [item("/en/home", "Home"), item("/en/time-off", "Time off")];
const org = [item("/en/people", "People"), item("/en/settings", "Settings")];

/** The class attribute of the link whose text is `label`. */
function linkClass(html: string, label: string): string {
  const match = new RegExp(
    `<a\\s[^>]*class="([^"]*)"[^>]*>(?:(?!</a>).)*${label}`,
  ).exec(html);
  if (!match?.[1]) throw new Error(`no link for ${label}`);
  return match[1];
}

describe("Sidebar", () => {
  it("does not render a filler workspace label", () => {
    const html = renderToStaticMarkup(
      <Sidebar items={me} orgName="Acme" currentPath="/en/home" />,
    );
    expect(html).toContain("Acme");
    expect(html).not.toContain("Workspace");
  });

  it("labels each group when there is more than one", () => {
    const html = renderToStaticMarkup(
      <Sidebar
        groups={[
          { label: "Me", items: me },
          { label: "Organization", items: org },
        ]}
      />,
    );
    expect(html).toMatch(/<ul[^>]*aria-labelledby="[^"]+"/);
    expect(html).toContain(">Me<");
    expect(html).toContain(">Organization<");
    expect(html.indexOf(">Me<")).toBeLessThan(html.indexOf("Home"));
    expect(html.indexOf(">Organization<")).toBeLessThan(html.indexOf("People"));
  });

  it("omits the label when there is only one group", () => {
    const html = renderToStaticMarkup(
      <Sidebar groups={[{ label: "Me", items: me }]} />,
    );
    expect(html).not.toContain(">Me<");
    expect(html).toContain("Time off");
  });

  it("marks the active item without changing its font weight", () => {
    const html = renderToStaticMarkup(
      <Sidebar items={me} currentPath="/en/time-off/request" />,
    );
    expect(html).toMatch(
      /<a[^>]*aria-current="page"[^>]*>(?:(?!<\/a>).)*Time off/,
    );
    const active = linkClass(html, "Time off");
    const inactive = linkClass(html, "Home");
    const weight = (cls: string) => cls.match(/\bfont-\w+/g) ?? [];
    expect(weight(active)).toEqual(weight(inactive));
  });
});

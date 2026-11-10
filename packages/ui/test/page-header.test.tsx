import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { PageHeader } from "../src/components/page-header.js";

describe("PageHeader", () => {
  it("renders the title as the page's h1", () => {
    const html = renderToStaticMarkup(<PageHeader title="Time off" />);
    expect(html).toContain("<header");
    expect(html).toMatch(/<h1[^>]*>Time off<\/h1>/);
  });

  it("omits description, actions and breadcrumb when not given", () => {
    const html = renderToStaticMarkup(<PageHeader title="Time off" />);
    expect(html).not.toContain("<p");
    expect(html).not.toContain("<nav");
  });

  it("renders the description, the actions and the breadcrumb before the title", () => {
    const html = renderToStaticMarkup(
      <PageHeader
        title="Security"
        description="Two-factor authentication"
        breadcrumb={<a href="/settings">Settings</a>}
        actions={<button type="button">Save</button>}
      />,
    );
    expect(html).toContain("Two-factor authentication");
    expect(html).toContain("<button");
    expect(html.indexOf("Settings")).toBeLessThan(html.indexOf("<h1"));
  });
});

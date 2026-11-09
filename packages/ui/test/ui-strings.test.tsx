import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { Toast } from "../src/components/toast.js";
import { Topbar } from "../src/components/topbar.js";
import {
  UiStringsProvider,
  defaultUiStrings,
  type UiStrings,
} from "../src/components/ui-strings.js";

const catalan: UiStrings = {
  ...defaultUiStrings,
  dismiss: "Descartar",
  breadcrumb: "Ruta de navegació",
};

function render(node: React.ReactElement, strings?: UiStrings): string {
  return renderToStaticMarkup(
    strings ? (
      <UiStringsProvider strings={strings}>{node}</UiStringsProvider>
    ) : (
      node
    ),
  );
}

describe("UiStringsProvider", () => {
  it("renders the translated labels it is given", () => {
    const toast = render(<Toast title="x" onDismiss={() => {}} />, catalan);
    const topbar = render(<Topbar breadcrumbs="x" />, catalan);

    expect(toast).toContain('aria-label="Descartar"');
    expect(topbar).toContain('aria-label="Ruta de navegació"');
  });

  it("falls back to English outside a provider (Storybook, tests)", () => {
    const toast = render(<Toast title="x" onDismiss={() => {}} />);

    expect(toast).toContain('aria-label="Dismiss"');
  });
});

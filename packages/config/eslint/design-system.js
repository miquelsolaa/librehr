// Design-system rules for UI code (DESIGN.md section 2).
//
// Tailwind accepts any arbitrary value, so nothing stops `text-[11px]` from
// slipping below the type scale's 12 px floor. Catch it in class strings and
// template literals instead.

const message =
  "Use the type scale (text-xs … text-4xl), not arbitrary font sizes (DESIGN.md §2.3).";

/** Arbitrary font size: `text-[` followed by a number (`11px`, `0.7rem`). */
const arbitraryFontSize = "/text-\\[\\d/";

export const designSystemConfigs = [
  {
    files: [
      "apps/web/src/**/*.{ts,tsx,js,jsx}",
      "packages/ui/src/**/*.{ts,tsx,js,jsx}",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: `Literal[value=${arbitraryFontSize}]`, message },
        {
          selector: `TemplateElement[value.raw=${arbitraryFontSize}]`,
          message,
        },
      ],
    },
  },
];

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { librehrTailwindPreset } from "../tailwind/preset";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const scanRoots = ["apps/web/src", "packages/ui/src"];

// shadcn-style token names that are easy to paste in but that our preset
// does not define. Tailwind drops unknown classes silently, so a typo here
// renders as unstyled UI instead of failing the build.
const suspectNames = [
  "card",
  "muted",
  "destructive",
  "input",
  "ring",
  "popover",
  "secondary",
];
const utilityPrefixes = [
  "bg",
  "text",
  "border",
  "ring",
  "outline",
  "fill",
  "stroke",
];

function definedColorNames(): Set<string> {
  return new Set(Object.keys(librehrTailwindPreset.theme.extend.colors));
}

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (/\.(tsx?|css)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function findOffenders(
  pattern: RegExp,
  isOffender: (match: RegExpMatchArray) => boolean = () => true,
): string[] {
  const offenders: string[] = [];
  for (const root of scanRoots) {
    for (const file of listSourceFiles(path.join(repoRoot, root))) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        for (const match of line.matchAll(pattern)) {
          if (isOffender(match)) {
            offenders.push(
              `${path.relative(repoRoot, file)}:${index + 1} ${match[0]}`,
            );
          }
        }
      });
    }
  }
  return offenders;
}

// Tailwind v3 built-in radius scale; anything else must come from the preset.
const builtInRadii = ["none", "sm", "md", "lg", "xl", "2xl", "3xl", "full"];

describe("tailwind semantic tokens", () => {
  it("source only uses color tokens the preset defines", () => {
    const defined = definedColorNames();
    const undefinedNames = suspectNames.filter((name) => !defined.has(name));
    const pattern = new RegExp(
      `(?<![\\w-])(?:${utilityPrefixes.join("|")})-(${undefinedNames.join("|")})(?![\\w-])`,
      "g",
    );

    expect(findOffenders(pattern)).toEqual([]);
  });

  it("source uses semantic colors, never raw Tailwind palette steps", () => {
    // DESIGN.md §2.2: `text-emerald-600` bypasses theming and dark mode.
    const pattern =
      /(?<![w-])(?:bg|text|border|ring|outline|fill|stroke|divide|from|via|to)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-d{2,3}(?![w-])/g;

    expect(findOffenders(pattern)).toEqual([]);
  });

  it("source only uses radius tokens the preset or Tailwind defines", () => {
    const allowed = new Set([
      ...builtInRadii,
      ...Object.keys(librehrTailwindPreset.theme.extend.borderRadius),
    ]);
    const pattern = /(?<![\w-])rounded-([a-z0-9]+)(?![\w-])/g;

    // Side/corner variants (rounded-t-lg) are skipped by the lookahead.
    expect(
      findOffenders(pattern, (match) => !allowed.has(match[1] ?? "")),
    ).toEqual([]);
  });
});

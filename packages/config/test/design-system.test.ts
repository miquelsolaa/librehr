import { beforeAll, describe, it, expect } from "vitest";
import { ESLint } from "eslint";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const eslint = new ESLint({
  overrideConfigFile: path.resolve(__dirname, "../eslint/base.js"),
});

const WEB = "apps/web/src/app/page.tsx";
const UI = "packages/ui/src/components/thing.tsx";
const API = "apps/api/src/routes/thing.ts";

async function typeScaleMessages(
  code: string,
  filePath: string,
): Promise<string[]> {
  const results = await eslint.lintText(code, { filePath });
  return (results[0]?.messages ?? [])
    .map((m) => m.message)
    .filter((m) => m.includes("type scale"));
}

describe("design-system lint rules", () => {
  // Loading the flat config and typescript-eslint takes seconds under a
  // parallel `pnpm verify`; pay it once here, not inside the first test.
  beforeAll(async () => {
    await eslint.lintText("export {};", {
      filePath: "apps/web/src/warm-up.ts",
    });
  }, 30_000);

  it.each([
    [WEB, `export const c = "mt-1 text-[11px] text-muted-foreground";\n`],
    [WEB, "export const c = (x: string) => `text-[10px] ${x}`;\n"],
    [UI, `export const c = "text-[0.7rem]";\n`],
  ])("flags arbitrary font sizes in %s", async (filePath, code) => {
    expect(await typeScaleMessages(code, filePath)).toHaveLength(1);
  });

  it.each([
    `export const c = "text-xs text-muted-foreground";\n`,
    // Arbitrary values for other utilities are not font sizes.
    `export const c = "max-w-[1280px] min-h-[44px]";\n`,
  ])("allows %s", async (code) => {
    expect(await typeScaleMessages(code, WEB)).toEqual([]);
  });

  it("does not apply outside the UI packages", async () => {
    expect(
      await typeScaleMessages(`export const c = "text-[11px]";\n`, API),
    ).toEqual([]);
  });
});

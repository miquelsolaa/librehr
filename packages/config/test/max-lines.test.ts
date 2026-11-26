import { beforeAll, describe, it, expect } from "vitest";
import { ESLint } from "eslint";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_LINES, MAX_LINES_ALLOWLIST } from "../eslint/max-lines.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

const eslint = new ESLint({
  overrideConfigFile: path.resolve(__dirname, "../eslint/base.js"),
});

/** `lines` statements, each on its own line, plus blanks and comments. */
function source(lines: number): string {
  const body = Array.from(
    { length: lines },
    (_, i) => `export const v${i} = ${i};`,
  );
  return `// header comment\n\n${body.join("\n\n")}\n`;
}

async function maxLinesErrors(code: string, filePath: string) {
  const results = await eslint.lintText(code, { filePath });
  return (results[0]?.messages ?? []).filter((m) => m.ruleId === "max-lines");
}

describe("max-lines ratchet", () => {
  // See design-system.test.ts: load the config once, outside the first test.
  beforeAll(async () => {
    await eslint.lintText("export {};", { filePath: "apps/api/src/warm.ts" });
  }, 30_000);

  it("allows a source file at the limit, not counting blanks and comments", async () => {
    expect(
      await maxLinesErrors(source(MAX_LINES), "apps/api/src/routes/new.ts"),
    ).toEqual([]);
  });

  it.each([
    "apps/api/src/routes/new.ts",
    "apps/web/src/app/[locale]/(app)/new/page.tsx",
    "packages/core/src/new.ts",
    "ee/src/new.ts",
  ])("fails a new source file over the limit: %s", async (filePath) => {
    const errors = await maxLinesErrors(source(MAX_LINES + 1), filePath);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.severity).toBe(2);
  });

  it.each([
    "apps/api/test/leave.int.test.ts",
    "packages/core/src/accrual.test.ts",
    "apps/web/e2e/people.spec.ts",
    "packages/db/seeds/demo.ts",
  ])("does not apply to tests, specs and seeds: %s", async (filePath) => {
    expect(await maxLinesErrors(source(MAX_LINES + 1), filePath)).toEqual([]);
  });

  it("exempts allowlisted files, including Next.js segment paths", async () => {
    for (const filePath of [
      "apps/api/src/routes/leave.ts",
      "apps/web/src/app/[locale]/(app)/people/[id]/page.tsx",
    ]) {
      expect(MAX_LINES_ALLOWLIST).toContain(filePath);
      expect(await maxLinesErrors(source(MAX_LINES + 1), filePath)).toEqual([]);
    }
  });

  // The allowlist only shrinks. Lower this ceiling in the same PR that
  // removes an entry; never raise it.
  const ALLOWLIST_CEILING = 35;

  it("never grows", () => {
    expect(MAX_LINES_ALLOWLIST.length).toBeLessThanOrEqual(ALLOWLIST_CEILING);
    expect(new Set(MAX_LINES_ALLOWLIST).size).toBe(MAX_LINES_ALLOWLIST.length);
  });

  // An entry whose file was deleted or split under the limit must be removed
  // in the same PR.
  it.each(MAX_LINES_ALLOWLIST)(
    "allowlisted %s still exists and is still over the limit",
    async (entry) => {
      const absolute = path.join(REPO_ROOT, entry);
      expect(existsSync(absolute)).toBe(true);
      const ext = path.extname(entry);
      const errors = await maxLinesErrors(
        readFileSync(absolute, "utf8"),
        `ratchet-probe/file${ext}`,
      );
      expect(errors).toHaveLength(1);
    },
    30_000,
  );
});

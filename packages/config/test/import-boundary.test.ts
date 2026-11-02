import { describe, it, expect } from "vitest";
import { ESLint } from "eslint";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("Import boundary rules", () => {
  it("fails when packages/core imports @librehr/db", async () => {
    const eslint = new ESLint({
      overrideConfigFile: path.resolve(__dirname, "../eslint/base.js"),
    });

    const results = await eslint.lintText(
      `import { db } from '@librehr/db';\nexport const x = db;\n`,
      { filePath: "packages/core/src/domain.ts" },
    );

    expect(results[0]?.errorCount).toBeGreaterThan(0);
    const messages = results[0]?.messages.map((m) => m.message) ?? [];
    expect(
      messages.some((msg) => msg.includes("core must never import db")),
    ).toBe(true);
  });

  it("fails when apps/web imports @librehr/db", async () => {
    const eslint = new ESLint({
      overrideConfigFile: path.resolve(__dirname, "../eslint/base.js"),
    });

    const results = await eslint.lintText(
      `import { db } from '@librehr/db';\nexport const x = db;\n`,
      { filePath: "apps/web/src/page.tsx" },
    );

    expect(results[0]?.errorCount).toBeGreaterThan(0);
    const messages = results[0]?.messages.map((m) => m.message) ?? [];
    expect(messages.some((msg) => msg.includes("web cannot import db"))).toBe(
      true,
    );
  });
});

import { describe, it, expect } from "vitest";
import { ESLint } from "eslint";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const eslint = new ESLint({
  overrideConfigFile: path.resolve(__dirname, "../eslint/base.js"),
});

async function restrictedImportMessages(
  specifier: string,
  filePath: string,
): Promise<string[]> {
  const results = await eslint.lintText(
    `import * as mod from '${specifier}';\nexport const x = mod;\n`,
    { filePath },
  );
  return (results[0]?.messages ?? [])
    .filter((m) => m.ruleId === "no-restricted-imports")
    .map((m) => m.message);
}

const CORE = "packages/core/src/domain.ts";
const WEB = "apps/web/src/app/page.tsx";
const API = "apps/api/src/routes/example.ts";
const WORKER = "apps/worker/src/jobs/example.ts";

describe("Import boundary rules (AGENTS.md section 2)", () => {
  it("fails when packages/core imports @librehr/db", async () => {
    const messages = await restrictedImportMessages("@librehr/db", CORE);
    expect(messages.some((m) => m.includes("core must not import db"))).toBe(
      true,
    );
  });

  it("fails when apps/web imports @librehr/db", async () => {
    const messages = await restrictedImportMessages("@librehr/db", WEB);
    expect(messages.some((m) => m.includes("web must not import db"))).toBe(
      true,
    );
  });

  describe("forbidden layer imports, including subpaths", () => {
    it.each([
      // core -> nothing internal
      [CORE, "@librehr/db/schema"],
      [CORE, "@librehr/contracts"],
      [CORE, "@librehr/contracts/leave"],
      [CORE, "@librehr/i18n"],
      [CORE, "../../../packages/db/src/schema"],
      // web -> contracts, ui, i18n only
      [WEB, "@librehr/db/repositories"],
      [WEB, "@librehr/core"],
      [WEB, "@librehr/core/leave/accrual"],
      [WEB, "@librehr/emails"],
      [WEB, "@librehr/api/app"],
      [WEB, "@librehr/worker"],
      [WEB, "../../../../packages/db/src/index"],
      // api -> core, db, contracts only
      [API, "@librehr/emails"],
      [API, "@librehr/emails/templates/invite"],
      [API, "@librehr/worker"],
      [API, "@librehr/web"],
      [API, "@librehr/ui/button"],
      // worker -> core, db, emails only
      [WORKER, "@librehr/contracts"],
      [WORKER, "@librehr/contracts/schemas"],
      [WORKER, "@librehr/web"],
      [WORKER, "@librehr/api"],
      [WORKER, "@librehr/ui"],
    ])("%s cannot import %s", async (file, specifier) => {
      const messages = await restrictedImportMessages(specifier, file);
      expect(messages.length).toBeGreaterThan(0);
    });
  });

  describe("allowed layer imports", () => {
    it.each([
      [WEB, "@librehr/contracts"],
      [WEB, "@librehr/ui/button"],
      [WEB, "@librehr/i18n"],
      [API, "@librehr/core/leave"],
      [API, "@librehr/db/schema"],
      [API, "@librehr/contracts"],
      [WORKER, "@librehr/core"],
      [WORKER, "@librehr/db"],
      [WORKER, "@librehr/emails/render"],
      [CORE, "./leave/accrual"],
    ])("%s may import %s", async (file, specifier) => {
      expect(await restrictedImportMessages(specifier, file)).toEqual([]);
    });
  });

  describe("core stays free of I/O", () => {
    it.each([
      "fs",
      "node:fs",
      "node:fs/promises",
      "path",
      "node:path",
      "node:http",
      "https",
      "node:net",
      "node:child_process",
      "node:worker_threads",
      "pg",
      "postgres",
      "drizzle-orm",
      "drizzle-orm/pg-core",
      "pino",
      "pg-boss",
      "nodemailer",
      "undici",
      "@aws-sdk/client-s3",
    ])("core cannot import %s", async (specifier) => {
      const messages = await restrictedImportMessages(specifier, CORE);
      expect(messages.some((m) => m.includes("without I/O"))).toBe(true);
    });

    it("core may import node:crypto (pure hashing/HMAC)", async () => {
      expect(await restrictedImportMessages("node:crypto", CORE)).toEqual([]);
    });

    it("I/O libraries stay allowed outside core", async () => {
      expect(await restrictedImportMessages("drizzle-orm", API)).toEqual([]);
      expect(await restrictedImportMessages("node:fs", WORKER)).toEqual([]);
    });
  });
});

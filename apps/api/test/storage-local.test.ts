import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalStorageAdapter } from "../src/adapters/storage-local.js";

describe("LocalStorageAdapter (DOC-001, STORAGE_LOCAL_DIR)", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "librehr-storage-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("creates the configured directory and keeps files inside it", async () => {
    const dir = path.join(root, "volume");
    const adapter = new LocalStorageAdapter(dir);
    expect(fs.existsSync(dir)).toBe(true);

    const key = "orgs/org-1/docs/doc-1-contract.pdf";
    const written = await adapter.put(
      key,
      Buffer.from("file body"),
      "application/pdf",
    );

    expect(written).toBe(path.join(dir, key));
    expect(fs.readFileSync(path.join(dir, key), "utf-8")).toBe("file body");
    expect((await adapter.get(key))?.toString("utf-8")).toBe("file body");

    await adapter.delete(key);
    expect(fs.existsSync(path.join(dir, key))).toBe(false);
    expect(await adapter.get(key)).toBeNull();
  });
});

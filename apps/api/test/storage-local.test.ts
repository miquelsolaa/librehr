import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LocalStorageAdapter,
  assertStorageWritable,
} from "../src/adapters/storage-local.js";

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

  it.each(["../x", "a/../../x", "/etc/x", "orgs/../../x", ""])(
    "refuses the key %j instead of leaving the storage directory",
    async (key) => {
      const dir = path.join(root, "volume");
      const adapter = new LocalStorageAdapter(dir);

      await expect(
        adapter.put(key, Buffer.from("x"), "text/plain"),
      ).rejects.toThrow("Invalid storage key");
      await expect(adapter.get(key)).rejects.toThrow("Invalid storage key");
      await expect(adapter.delete(key)).rejects.toThrow("Invalid storage key");
      expect(fs.existsSync(path.join(root, "x"))).toBe(false);
    },
  );

  it("does not delete a file outside the storage directory", async () => {
    const outside = path.join(root, "x");
    fs.writeFileSync(outside, "keep");
    const adapter = new LocalStorageAdapter(path.join(root, "volume"));

    await expect(adapter.delete("../x")).rejects.toThrow();
    expect(fs.readFileSync(outside, "utf-8")).toBe("keep");
  });

  it("still accepts keys that only look like traversal inside the directory", async () => {
    const dir = path.join(root, "volume");
    const adapter = new LocalStorageAdapter(dir);
    await adapter.put("a/../b..pdf", Buffer.from("ok"), "application/pdf");
    expect(fs.readFileSync(path.join(dir, "b..pdf"), "utf-8")).toBe("ok");
  });

  it("assertStorageWritable passes for a writable directory", () => {
    expect(() => assertStorageWritable(root)).not.toThrow();
  });

  it.skipIf(process.getuid?.() === 0)(
    "assertStorageWritable fails fast with EACCES on a read-only directory",
    () => {
      const dir = path.join(root, "read-only");
      fs.mkdirSync(dir, { mode: 0o500 });
      try {
        expect(() => assertStorageWritable(dir)).toThrow(
          expect.objectContaining({ code: "EACCES" }),
        );
      } finally {
        fs.chmodSync(dir, 0o700);
      }
    },
  );
});

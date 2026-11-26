import { readFile } from "node:fs/promises";
import path from "node:path";

/** Same rule as the `time_exports_storage_key_check` constraint (0045). */
const STORAGE_KEY = /^[A-Za-z0-9][A-Za-z0-9/_.-]*$/;

/** Reads the files the worker wrote for background exports (TIM-006). */
export interface ExportFileReader {
  /** The file's bytes, or null when it does not exist (deleted at expiry). */
  get(key: string): Promise<Uint8Array<ArrayBuffer> | null>;
}

/**
 * Files on the local disk under `rootDir`: STORAGE_LOCAL_DIR, the volume the
 * worker writes the exports into. Keys come from the database, which already
 * refuses traversal; the same check runs here so a row can never point the
 * download outside the root.
 */
export function createLocalExportFileReader(rootDir: string): ExportFileReader {
  const root = path.resolve(rootDir);
  return {
    async get(key) {
      const file = path.resolve(root, key);
      if (
        !STORAGE_KEY.test(key) ||
        key.includes("..") ||
        !file.startsWith(root + path.sep)
      ) {
        throw new Error("invalid export storage key");
      }
      try {
        return new Uint8Array(await readFile(file));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }
    },
  };
}

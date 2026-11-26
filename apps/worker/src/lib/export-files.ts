import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/** Same rule as the `time_exports_storage_key_check` constraint (0045). */
const STORAGE_KEY = /^[A-Za-z0-9][A-Za-z0-9/_.-]*$/;

/** Where background export files are written (TIM-006). */
export interface ExportFileStore {
  put(key: string, bytes: Uint8Array): Promise<void>;
  /** Removes the file; a missing file is not an error. */
  delete(key: string): Promise<void>;
}

/**
 * Files on the local disk under `rootDir`, the directory the API's local
 * storage adapter reads (STORAGE_LOCAL_DIR, a volume shared by both
 * containers). Keys are relative paths; anything that could leave the root
 * is refused. Files are written to a temporary name and renamed, so a reader
 * never sees half a file, and are readable by their owner only (the API and
 * worker images run as the same uid).
 */
export function createLocalExportFileStore(rootDir: string): ExportFileStore {
  const root = path.resolve(rootDir);
  const fileFor = (key: string) => {
    const file = path.resolve(root, key);
    if (
      !STORAGE_KEY.test(key) ||
      key.includes("..") ||
      !file.startsWith(root + path.sep)
    ) {
      throw new Error("invalid export storage key");
    }
    return file;
  };
  return {
    async put(key, bytes) {
      const file = fileFor(key);
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      const temporary = `${file}.${process.pid}.tmp`;
      try {
        await writeFile(temporary, bytes, { mode: 0o600 });
        await rename(temporary, file);
      } catch (err) {
        await rm(temporary, { force: true });
        throw err;
      }
    },
    async delete(key) {
      await rm(fileFor(key), { force: true });
    },
  };
}

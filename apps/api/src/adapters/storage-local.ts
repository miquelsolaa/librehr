import fs from "node:fs";
import path from "node:path";
import type { StoragePort } from "../ports/storage.js";

export class LocalStorageAdapter implements StoragePort {
  private baseDir: string;

  constructor(baseDir: string = "./data/storage") {
    this.baseDir = path.resolve(baseDir);
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  /**
   * Maps a storage key to a file under the base directory. Keys embed
   * request data (filenames), so a key that is absolute or that climbs out
   * of the base directory is refused before any file is touched.
   */
  private resolveKey(key: string): string {
    if (key === "" || key.includes("\0") || path.isAbsolute(key)) {
      throw new Error("Invalid storage key");
    }
    const filePath = path.resolve(this.baseDir, key);
    if (!filePath.startsWith(this.baseDir + path.sep)) {
      throw new Error("Invalid storage key");
    }
    return filePath;
  }

  async put(key: string, data: Buffer, _contentType: string): Promise<string> {
    const filePath = this.resolveKey(key);
    const parentDir = path.dirname(filePath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.writeFileSync(filePath, data);
    return filePath;
  }

  async get(key: string): Promise<Buffer | null> {
    const filePath = this.resolveKey(key);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return fs.readFileSync(filePath);
  }

  async delete(key: string): Promise<void> {
    const filePath = this.resolveKey(key);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

/**
 * Throws (with the fs error code) when the API user cannot write to the
 * storage directory, e.g. a volume still owned by root after an upgrade, so
 * the API refuses to start instead of failing on the first upload.
 */
export function assertStorageWritable(dir: string): void {
  fs.accessSync(path.resolve(dir), fs.constants.W_OK);
}

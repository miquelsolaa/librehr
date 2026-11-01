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

  async put(key: string, data: Buffer, _contentType: string): Promise<string> {
    const filePath = path.join(this.baseDir, key);
    const parentDir = path.dirname(filePath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.writeFileSync(filePath, data);
    return filePath;
  }

  async get(key: string): Promise<Buffer | null> {
    const filePath = path.join(this.baseDir, key);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return fs.readFileSync(filePath);
  }

  async delete(key: string): Promise<void> {
    const filePath = path.join(this.baseDir, key);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

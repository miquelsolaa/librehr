import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { locales } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const messagesDir = path.resolve(__dirname, "../messages");

function flattenKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  let keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      keys = keys.concat(
        flattenKeys(value as Record<string, unknown>, fullKey),
      );
    } else {
      keys.push(fullKey);
    }
  }
  return keys.sort();
}

export function checkI18nKeys(): { success: boolean; errors: string[] } {
  const errors: string[] = [];
  const catalogKeys: Record<string, string[]> = {};

  for (const loc of locales) {
    const filePath = path.join(messagesDir, `${loc}.json`);
    if (!fs.existsSync(filePath)) {
      errors.push(`Missing catalog file for locale: ${loc} (${filePath})`);
      continue;
    }

    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(content) as Record<string, unknown>;
      catalogKeys[loc] = flattenKeys(parsed);
    } catch (err) {
      errors.push(`Failed to parse ${loc}.json: ${(err as Error).message}`);
    }
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  const baseLocale = locales[0] ?? "ca";
  const baseKeys = new Set(catalogKeys[baseLocale] ?? []);

  for (const loc of locales) {
    if (loc === baseLocale) continue;
    const currentKeys = new Set(catalogKeys[loc] ?? []);

    for (const key of baseKeys) {
      if (!currentKeys.has(key)) {
        errors.push(
          `Locale '${loc}' is missing key present in '${baseLocale}': ${key}`,
        );
      }
    }

    for (const key of currentKeys) {
      if (!baseKeys.has(key)) {
        errors.push(
          `Locale '${loc}' has extra key not present in '${baseLocale}': ${key}`,
        );
      }
    }
  }

  return {
    success: errors.length === 0,
    errors,
  };
}

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith("check.ts") ||
    process.argv[1].endsWith("check.js"));

if (isDirectRun) {
  const result = checkI18nKeys();
  if (!result.success) {
    process.stderr.write(`i18n check failed:\n${result.errors.join("\n")}\n`);
    process.exit(1);
  } else {
    process.stdout.write(
      `i18n check passed: all locales (${locales.join(", ")}) have matching keys.\n`,
    );
  }
}

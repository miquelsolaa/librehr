/**
 * Reads a jsonb array of strings (or a JSON-encoded string written by older
 * code). Non-string elements are dropped instead of cast. The repositories
 * have no knowledge of the allowed values: callers narrow the result with
 * the Zod enums in @librehr/contracts (`parseWebhookEvents`,
 * `parsePatScopes`).
 */
export function jsonStringArray(value: unknown): string[] {
  let raw = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  return Array.isArray(raw)
    ? raw.filter((v): v is string => typeof v === "string")
    : [];
}

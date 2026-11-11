import { z } from "zod";

export const IdSchema = z.guid();
export const IsoDateTimeSchema = z.string().datetime();
export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// A UTF-16 surrogate without its partner.
const LONE_SURROGATE =
  /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

/**
 * Restricts a string schema to text that is stored exactly as sent. A lone
 * surrogate is stored by Postgres as U+FFFD and NUL is refused by it, so a
 * value hashed or signed before storage (TIM-002 chain) would not match what
 * is read back.
 *
 * @example
 * storableText(z.string().max(500)).safeParse("ok").success; // true
 * storableText(z.string()).safeParse("\ud800").success; // false
 */
export function storableText<T extends z.ZodTypeAny>(schema: T) {
  return schema.refine(
    (value: unknown) =>
      typeof value !== "string" ||
      (!LONE_SURROGATE.test(value) && !value.includes("\u0000")),
    { message: "Text must be well-formed Unicode without NUL characters" },
  );
}

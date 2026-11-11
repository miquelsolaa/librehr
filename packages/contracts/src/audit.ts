import { z } from "zod";

// Empty query values (`?actorId=`) have always meant "no filter".
const optionalFilter = <S extends z.ZodTypeAny>(schema: S) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

export const ListAuditLogQuerySchema = z.object({
  resourceType: optionalFilter(z.string().max(100)),
  resourceId: optionalFilter(z.string().max(200)),
  actorId: optionalFilter(z.guid()),
  limit: optionalFilter(z.coerce.number().int().min(1)),
});
export type ListAuditLogQuery = z.infer<typeof ListAuditLogQuerySchema>;

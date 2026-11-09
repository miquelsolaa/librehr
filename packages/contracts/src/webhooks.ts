import { z } from "zod";

/**
 * Events an organization can subscribe a webhook to. `test.ping` is sent only
 * by the test endpoint and is not subscribable.
 */
export const WEBHOOK_SUBSCRIBABLE_EVENTS = [
  "employee.created",
  "employee.updated",
  "employee.terminated",
  "leave.requested",
  "leave.approved",
  "leave.rejected",
  "time.clocked",
  "document.uploaded",
] as const;
export const WebhookEventSchema = z.enum(WEBHOOK_SUBSCRIBABLE_EVENTS);
export type WebhookSubscribableEvent = z.infer<typeof WebhookEventSchema>;

/**
 * Reads a stored events value (jsonb array, or a JSON-encoded string written
 * by older code). Input is rejected on write, so an unknown or non-string
 * element here can only come from old data: it is dropped rather than failing
 * the whole read, because a dropped subscription only means fewer deliveries.
 */
export function parseWebhookEvents(value: unknown): WebhookSubscribableEvent[] {
  let raw = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  const events: WebhookSubscribableEvent[] = [];
  for (const item of raw) {
    const parsed = WebhookEventSchema.safeParse(item);
    if (parsed.success && !events.includes(parsed.data)) {
      events.push(parsed.data);
    }
  }
  return events;
}

export const WebhookItemSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string().min(1).max(100),
  url: z.string().url(),
  /**
   * Signing secret. Returned only by create and by an update that rotates
   * it; list and other responses never include it.
   */
  secret: z.string().optional(),
  events: z.array(WebhookEventSchema),
  enabled: z.boolean(),
  lastDeliveryStatus: z.number().int().nullable().optional(),
  lastDeliveredAt: z.coerce.date().nullable().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type WebhookItem = z.infer<typeof WebhookItemSchema>;

export const CreateWebhookRequestSchema = z.object({
  name: z.string().min(1).max(100),
  url: z.string().url(),
  events: z.array(WebhookEventSchema).min(1),
  enabled: z.boolean().default(true).optional(),
});
export type CreateWebhookRequest = z.infer<typeof CreateWebhookRequestSchema>;

export const UpdateWebhookRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  url: z.string().url().optional(),
  events: z.array(WebhookEventSchema).min(1).optional(),
  enabled: z.boolean().optional(),
  rotateSecret: z.boolean().optional(),
});
export type UpdateWebhookRequest = z.infer<typeof UpdateWebhookRequestSchema>;

export const TestWebhookResponseSchema = z.object({
  success: z.boolean(),
  statusCode: z.number().int(),
  durationMs: z.number(),
  error: z.string().nullable().optional(),
});
export type TestWebhookResponse = z.infer<typeof TestWebhookResponseSchema>;

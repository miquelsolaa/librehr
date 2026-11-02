import { z } from "zod";

export const WebhookItemSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string().min(1).max(100),
  url: z.string().url(),
  secret: z.string(),
  events: z.array(z.string()),
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
  events: z.array(z.string()).min(1),
  enabled: z.boolean().default(true).optional(),
});
export type CreateWebhookRequest = z.infer<typeof CreateWebhookRequestSchema>;

export const UpdateWebhookRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  url: z.string().url().optional(),
  events: z.array(z.string()).min(1).optional(),
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

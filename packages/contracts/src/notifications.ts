import { z } from "zod";

export const NotificationItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  body: z.string(),
  category: z.string(),
  link: z.string().nullable().optional(),
  read: z.boolean(),
  createdAt: z.string().datetime(),
});
export type NotificationItem = z.infer<typeof NotificationItemSchema>;

export const NotificationListResponseSchema = z.object({
  items: z.array(NotificationItemSchema),
  unreadCount: z.number().int(),
});
export type NotificationListResponse = z.infer<
  typeof NotificationListResponseSchema
>;

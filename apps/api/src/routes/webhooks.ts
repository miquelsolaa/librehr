import { Hono } from "hono";
import type { Sql } from "postgres";
import {
  type AuthUser,
  CreateWebhookRequestSchema,
  UpdateWebhookRequestSchema,
  createProblemDetails,
} from "@librehr/contracts";
import { withTenant, WebhookRepository, AuditRepository } from "@librehr/db";
import { generateWebhookSecret, signWebhookPayload } from "@librehr/core";
import { requireAuth } from "../middleware/auth.js";
import { can } from "../policies/can.js";

export function createWebhookRoutes(sql: Sql) {
  const router = new Hono();
  const webhookRepo = new WebhookRepository();
  const auditRepo = new AuditRepository();

  // 1. GET /webhooks - List webhooks (admin/org.write)
  router.get("/webhooks", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;

    if (
      !can(
        {
          userId: user.id,
          role: user.role,
          organizationId: user.organizationId,
        },
        "org.write",
      )
    ) {
      return c.json(
        createProblemDetails({
          status: 403,
          title: "Forbidden",
          detail: "Insufficient permissions to view webhooks",
          code: "FORBIDDEN",
        }),
        403,
        { "Content-Type": "application/problem+json" },
      );
    }

    const items = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        return webhookRepo.list(tx);
      },
    );

    return c.json(items);
  });

  // 2. POST /webhooks - Create webhook (org.write)
  router.post("/webhooks", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;

    if (
      !can(
        {
          userId: user.id,
          role: user.role,
          organizationId: user.organizationId,
        },
        "org.write",
      )
    ) {
      return c.json(
        createProblemDetails({
          status: 403,
          title: "Forbidden",
          detail: "Only admins can configure outbound webhooks",
          code: "FORBIDDEN",
        }),
        403,
        { "Content-Type": "application/problem+json" },
      );
    }

    const body = await c.req.json();
    const parsed = CreateWebhookRequestSchema.safeParse(body);

    if (!parsed.success) {
      return c.json(
        createProblemDetails({
          status: 400,
          title: "Validation Error",
          detail: parsed.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join(", "),
          code: "VALIDATION_ERROR",
        }),
        400,
        { "Content-Type": "application/problem+json" },
      );
    }

    const secret = generateWebhookSecret();

    const created = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const item = await webhookRepo.create(tx, {
          name: parsed.data.name,
          url: parsed.data.url,
          secret,
          events: parsed.data.events,
          ...(parsed.data.enabled !== undefined
            ? { enabled: parsed.data.enabled }
            : {}),
        });

        await auditRepo.log(tx, {
          action: "webhook.created",
          actorId: user.id,
          resourceType: "webhook",
          resourceId: item.id,
          metadata: { name: item.name, url: item.url, events: item.events },
        });

        return item;
      },
    );

    return c.json(created, 201);
  });

  // 3. PATCH /webhooks/:id - Update webhook
  router.patch("/webhooks/:id", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const webhookId = c.req.param("id");

    if (
      !can(
        {
          userId: user.id,
          role: user.role,
          organizationId: user.organizationId,
        },
        "org.write",
      )
    ) {
      return c.json(
        createProblemDetails({
          status: 403,
          title: "Forbidden",
          detail: "Only admins can update outbound webhooks",
          code: "FORBIDDEN",
        }),
        403,
        { "Content-Type": "application/problem+json" },
      );
    }

    const body = await c.req.json();
    const parsed = UpdateWebhookRequestSchema.safeParse(body);

    if (!parsed.success) {
      return c.json(
        createProblemDetails({
          status: 400,
          title: "Validation Error",
          detail: parsed.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join(", "),
          code: "VALIDATION_ERROR",
        }),
        400,
        { "Content-Type": "application/problem+json" },
      );
    }

    const updated = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const existing = await webhookRepo.getById(tx, webhookId);
        if (!existing) return null;

        const updateData: {
          name?: string;
          url?: string;
          secret?: string;
          events?: string[];
          enabled?: boolean;
        } = {};

        if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
        if (parsed.data.url !== undefined) updateData.url = parsed.data.url;
        if (parsed.data.events !== undefined)
          updateData.events = parsed.data.events;
        if (parsed.data.enabled !== undefined)
          updateData.enabled = parsed.data.enabled;
        if (parsed.data.rotateSecret) {
          updateData.secret = generateWebhookSecret();
        }

        const res = await webhookRepo.update(tx, webhookId, updateData);

        if (res) {
          await auditRepo.log(tx, {
            action: "webhook.updated",
            actorId: user.id,
            resourceType: "webhook",
            resourceId: res.id,
            metadata: {
              before: {
                name: existing.name,
                url: existing.url,
                events: existing.events,
              },
              after: { name: res.name, url: res.url, events: res.events },
            },
          });
        }

        return res;
      },
    );

    if (!updated) {
      return c.json(
        createProblemDetails({
          status: 404,
          title: "Not Found",
          detail: "Webhook subscription not found",
          code: "WEBHOOK_NOT_FOUND",
        }),
        404,
        { "Content-Type": "application/problem+json" },
      );
    }

    return c.json(updated);
  });

  // 4. DELETE /webhooks/:id - Delete webhook
  router.delete("/webhooks/:id", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const webhookId = c.req.param("id");

    if (
      !can(
        {
          userId: user.id,
          role: user.role,
          organizationId: user.organizationId,
        },
        "org.write",
      )
    ) {
      return c.json(
        createProblemDetails({
          status: 403,
          title: "Forbidden",
          detail: "Only admins can delete outbound webhooks",
          code: "FORBIDDEN",
        }),
        403,
        { "Content-Type": "application/problem+json" },
      );
    }

    const deleted = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const existing = await webhookRepo.getById(tx, webhookId);
        if (!existing) return false;

        await webhookRepo.delete(tx, webhookId);

        await auditRepo.log(tx, {
          action: "webhook.deleted",
          actorId: user.id,
          resourceType: "webhook",
          resourceId: webhookId,
          metadata: { name: existing.name, url: existing.url },
        });

        return true;
      },
    );

    if (!deleted) {
      return c.json(
        createProblemDetails({
          status: 404,
          title: "Not Found",
          detail: "Webhook subscription not found",
          code: "WEBHOOK_NOT_FOUND",
        }),
        404,
        { "Content-Type": "application/problem+json" },
      );
    }

    return c.json({ success: true });
  });

  // 5. POST /webhooks/:id/test - Send test ping to webhook URL
  router.post("/webhooks/:id/test", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const webhookId = c.req.param("id");

    if (
      !can(
        {
          userId: user.id,
          role: user.role,
          organizationId: user.organizationId,
        },
        "org.write",
      )
    ) {
      return c.json(
        createProblemDetails({
          status: 403,
          title: "Forbidden",
          detail: "Only admins can test outbound webhooks",
          code: "FORBIDDEN",
        }),
        403,
        { "Content-Type": "application/problem+json" },
      );
    }

    const webhook = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        return webhookRepo.getById(tx, webhookId);
      },
    );

    if (!webhook) {
      return c.json(
        createProblemDetails({
          status: 404,
          title: "Not Found",
          detail: "Webhook subscription not found",
          code: "WEBHOOK_NOT_FOUND",
        }),
        404,
        { "Content-Type": "application/problem+json" },
      );
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const testPayload = JSON.stringify({
      event: "test.ping",
      timestamp: new Date().toISOString(),
      organizationId: user.organizationId,
      data: {
        message:
          "This is a test event from LibreHR to verify outbound webhook delivery.",
        webhookId: webhook.id,
        webhookName: webhook.name,
      },
    });

    const { header } = signWebhookPayload(
      testPayload,
      webhook.secret,
      timestamp,
    );

    const startTime = performance.now();
    let statusCode = 0;
    let durationMs = 0;
    let errorMessage: string | null = null;
    let success = false;

    try {
      const response = await fetch(webhook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "LibreHR-Webhook-Engine/1.0",
          "X-LibreHR-Signature-256": header,
          "X-LibreHR-Timestamp": String(timestamp),
          "X-LibreHR-Event": "test.ping",
        },
        body: testPayload,
        signal: AbortSignal.timeout(5000),
      });

      durationMs = Math.round(performance.now() - startTime);
      statusCode = response.status;
      success = response.ok;
      if (!response.ok) {
        errorMessage = `HTTP error ${response.status}: ${response.statusText}`;
      }
    } catch (err) {
      durationMs = Math.round(performance.now() - startTime);
      statusCode = 0;
      success = false;
      errorMessage =
        err instanceof Error ? err.message : "Network request failed";
    }

    // Record delivery status in database
    await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        await webhookRepo.updateDeliveryStatus(tx, webhook.id, statusCode);
      },
    );

    return c.json({
      success,
      statusCode,
      durationMs,
      ...(errorMessage ? { error: errorMessage } : { error: null }),
    });
  });

  return router;
}

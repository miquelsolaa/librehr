import { Hono, type Context } from "hono";
import type { Sql } from "postgres";
import {
  type AuthUser,
  type OrgGroup,
  CreateOrgGroupRequestSchema,
  ListOrgGroupsQuerySchema,
  UpdateOrgGroupRequestSchema,
} from "@librehr/contracts";
import {
  withTenant,
  AuditRepository,
  OrgGroupRepository,
  type OrgGroupKind,
  type OrgGroupRow,
  type TenantTx,
} from "@librehr/db";
import { requireAuth } from "../middleware/auth.js";
import { permissionScope } from "../policies/can.js";
import { resolvePolicyContext } from "../policies/context.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../errors/index.js";
import {
  IdParamSchema,
  parseJsonBody,
  parseParams,
  parseQuery,
} from "../lib/validate.js";
import { mapPgErrors, PG_UNIQUE_VIOLATION } from "../lib/pg-errors.js";

const repo = new OrgGroupRepository();
const audit = new AuditRepository();

const currentUser = (c: Context) =>
  (c.get as (key: string) => unknown)("user") as AuthUser;

const nameTaken = () =>
  new ConflictError({
    code: "GROUP_NAME_TAKEN",
    detail: "An active group of this kind already has that name",
  });

export function toOrgGroup(row: OrgGroupRow): OrgGroup {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    description: row.description,
    parentId: row.parentId,
    leadEmployeeId: row.leadEmployeeId,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Only an active area can hold groups, and only projects (one level). */
async function checkParent(
  tx: TenantTx,
  kind: OrgGroupKind,
  parentId: string | null | undefined,
): Promise<void> {
  if (!parentId) return;
  const parent = await repo.findById(tx, parentId);
  if (!parent)
    throw new NotFoundError({
      code: "PARENT_GROUP_NOT_FOUND",
      detail: "Parent group not found",
    });
  if (kind !== "project" || parent.kind !== "area" || parent.archivedAt)
    throw new ValidationError({
      status: 422,
      code: "INVALID_GROUP_PARENT",
      detail: "Only a project can have a parent, and it must be an active area",
    });
}

async function checkLead(tx: TenantTx, leadId: string | null | undefined) {
  if (!leadId) return;
  const rows = await tx`
    SELECT 1 FROM employees
    WHERE id = ${leadId} AND organization_id = ${tx.__tenantContext.organizationId}`;
  if (rows.length === 0)
    throw new NotFoundError({
      code: "EMPLOYEE_NOT_FOUND",
      detail: "Lead employee not found",
    });
}

/**
 * ORG-007 (ADR 0008): projects and areas. Everyone with org.read lists them;
 * org.write creates, edits and archives. Changes are audited with ids only.
 */
export function createOrgGroupRoutes(sql: Sql) {
  const router = new Hono();

  const inTenant = <T>(
    c: Context,
    permission: "org.read" | "org.write",
    work: (tx: TenantTx, user: AuthUser) => Promise<T>,
  ) => {
    const user = currentUser(c);
    return withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        if (!permissionScope(await resolvePolicyContext(c, tx), permission))
          throw new ForbiddenError({
            detail: "You do not have permission to manage groups",
          });
        return work(tx, user);
      },
    );
  };

  router.get("/org/groups", requireAuth, async (c) => {
    const query = parseQuery(c, ListOrgGroupsQuerySchema);
    const rows = await inTenant(c, "org.read", (tx) =>
      repo.findMany(tx, {
        ...(query.kind ? { kind: query.kind } : {}),
        includeArchived: query.includeArchived,
      }),
    );
    return c.json(rows.map(toOrgGroup));
  });

  router.post("/org/groups", requireAuth, async (c) => {
    const body = await parseJsonBody(c, CreateOrgGroupRequestSchema);
    const created = await mapPgErrors(
      () =>
        inTenant(c, "org.write", async (tx, user) => {
          await checkParent(tx, body.kind, body.parentId);
          await checkLead(tx, body.leadEmployeeId);
          const row = await repo.create(tx, body);
          await audit.log(tx, {
            actorId: user.id,
            action: "org_group.create",
            resourceType: "org_group",
            resourceId: row.id,
            metadata: { kind: row.kind },
          });
          return row;
        }),
      { [PG_UNIQUE_VIOLATION]: nameTaken },
    );
    return c.json(toOrgGroup(created), 201);
  });

  router.patch("/org/groups/:id", requireAuth, async (c) => {
    const { id } = parseParams(c, IdParamSchema, {
      detail: "Group not found",
    });
    const body = await parseJsonBody(c, UpdateOrgGroupRequestSchema);
    const updated = await mapPgErrors(
      () =>
        inTenant(c, "org.write", async (tx, user) => {
          const current = await repo.findById(tx, id);
          if (!current) throw new NotFoundError({ detail: "Group not found" });
          if (current.archivedAt)
            throw new ConflictError({
              code: "GROUP_ARCHIVED",
              detail: "An archived group cannot be changed",
            });
          const startsOn =
            body.startsOn !== undefined ? body.startsOn : current.startsOn;
          const endsOn =
            body.endsOn !== undefined ? body.endsOn : current.endsOn;
          if (startsOn && endsOn && endsOn < startsOn)
            throw new ValidationError({
              status: 422,
              code: "INVALID_DATES",
              detail: "End date must not precede start date",
            });
          await checkParent(tx, current.kind, body.parentId);
          await checkLead(tx, body.leadEmployeeId);
          const row = await repo.update(tx, id, body);
          await audit.log(tx, {
            actorId: user.id,
            action: "org_group.update",
            resourceType: "org_group",
            resourceId: id,
            metadata: {
              fields: Object.keys(body).filter(
                (k) => body[k as keyof typeof body] !== undefined,
              ),
            },
          });
          return row!;
        }),
      { [PG_UNIQUE_VIOLATION]: nameTaken },
    );
    return c.json(toOrgGroup(updated));
  });

  router.post("/org/groups/:id/archive", requireAuth, async (c) => {
    const { id } = parseParams(c, IdParamSchema, {
      detail: "Group not found",
    });
    const archived = await inTenant(c, "org.write", async (tx, user) => {
      const current = await repo.findById(tx, id);
      if (!current) throw new NotFoundError({ detail: "Group not found" });
      if (current.archivedAt) return current;
      const row = await repo.archive(tx, id);
      await audit.log(tx, {
        actorId: user.id,
        action: "org_group.archive",
        resourceType: "org_group",
        resourceId: id,
      });
      return row!;
    });
    return c.json(toOrgGroup(archived));
  });

  return router;
}

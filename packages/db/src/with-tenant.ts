import type { Sql, TransactionSql } from "postgres";

export interface TenantContext {
  organizationId: string;
  userId?: string;
  role?: string;
}

/**
 * Branded type representing a transaction executed within an RLS tenant context.
 * Repositories must require this type to ensure RLS session variables are set.
 */
export type TenantTx = TransactionSql & {
  readonly __tenantContext: TenantContext;
};

/**
 * Executes an operation inside a database transaction with app.current_org and app.current_user set.
 * Ensures strict PostgreSQL Row-Level Security isolation.
 */
export async function withTenant<T>(
  sql: Sql,
  ctx: TenantContext,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  const result = await sql.begin(async (rawTx) => {
    // If the active session is a superuser (e.g. running migrations or tests as postgres/owner),
    // switch to the unprivileged librehr_app role inside the transaction so PostgreSQL enforces Row-Level Security
    // (PostgreSQL bypasses RLS for superusers even with FORCE ROW LEVEL SECURITY).
    const [userStatus] = await rawTx<{ is_superuser: string }[]>`
      SELECT current_setting('is_superuser') as is_superuser
    `;
    if (userStatus?.is_superuser === "on") {
      try {
        await rawTx`SET LOCAL ROLE librehr_app`;
      } catch {
        // Fallback if librehr_app role does not exist
      }
    }

    // Escape string values safely using parameterized queries
    await rawTx`SELECT set_config('app.current_org', ${ctx.organizationId}, true)`;
    if (ctx.userId) {
      await rawTx`SELECT set_config('app.current_user', ${ctx.userId}, true)`;
    }
    if (ctx.role) {
      await rawTx`SELECT set_config('app.current_role', ${ctx.role}, true)`;
    }

    const tenantTx = rawTx as unknown as TenantTx;
    Object.defineProperty(tenantTx, "__tenantContext", {
      value: ctx,
      writable: false,
      enumerable: false,
    });

    return fn(tenantTx);
  });

  return result as T;
}

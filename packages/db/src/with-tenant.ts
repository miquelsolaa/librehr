export interface TenantContext {
  organizationId: string;
  userId?: string;
  role?: string;
}

export async function withTenant<T>(
  ctx: TenantContext,
  fn: (tx: unknown) => Promise<T>,
): Promise<T> {
  return fn(ctx);
}

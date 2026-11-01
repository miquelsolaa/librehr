export function createTestTenantContext(
  orgId: string = "00000000-0000-0000-0000-000000000001",
) {
  return {
    organizationId: orgId,
    userId: "00000000-0000-0000-0000-000000000002",
    role: "admin",
  };
}

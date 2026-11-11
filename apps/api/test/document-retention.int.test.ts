import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTestDatabase, type TestDatabase } from "@librehr/testing";
import { withTenant } from "@librehr/db";
import { runMigrations } from "@librehr/db/migrate";
import { createApp } from "../src/app.js";
import type { AuthPort } from "../src/ports/auth.js";
import type { AuthUser } from "@librehr/contracts";

const org = "50000000-0000-0000-0000-000000000091";
const otherOrg = "50000000-0000-0000-0000-000000000092";
const admin: AuthUser = {
  id: "50000000-0000-0000-0000-000000000011",
  email: "retention@example.invalid",
  name: "Admin",
  role: "admin",
  organizationId: org,
};
const other: AuthUser = {
  ...admin,
  id: "50000000-0000-0000-0000-000000000012",
  email: "other@example.invalid",
  organizationId: otherOrg,
};
const auth: AuthPort = {
  async verifyCredentials() {
    return null;
  },
  async createSession(user: AuthUser) {
    return { user, token: user.id, expiresAt: new Date(Date.now() + 60000) };
  },
  async getSession(token) {
    const user = token === "admin" ? admin : token === "other" ? other : null;
    return user
      ? { user, token, expiresAt: new Date(Date.now() + 60000) }
      : null;
  },
  async revokeSession() {},
};

describe("document soft deletion", () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;
  let documentId: string;
  const removed: string[] = [];
  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database)
      throw new Error("Docker is required for document retention tests");
    db = database;
    await runMigrations(db.connectionString);
    await db.sql`INSERT INTO organizations (id, name, slug) VALUES (${org}, 'Org', 'retention-org'), (${otherOrg}, 'Other', 'retention-other')`;
    await db.sql`INSERT INTO users (id, email, name) VALUES (${admin.id}, ${admin.email}, ${admin.name}), (${other.id}, ${other.email}, ${other.name})`;
    await withTenant(db.sql, { organizationId: org }, async (tx) => {
      await tx`INSERT INTO employees (user_id, first_name, last_name, email) VALUES (${admin.id}, 'Test', 'Admin', ${admin.email})`;
      const rows = await tx<
        { id: string }[]
      >`INSERT INTO documents (title, category, created_by_id) VALUES ('Example', 'other', ${admin.id}) RETURNING id`;
      documentId = rows[0]!.id;
      await tx`INSERT INTO document_versions (document_id, version_number, storage_key, filename, mime_type, size_bytes, sha256_hash, uploaded_by_id) VALUES (${documentId}, 1, 'old-key', 'old.pdf', 'application/pdf', 1, 'old', ${admin.id}), (${documentId}, 2, 'new-key', 'new.pdf', 'application/pdf', 1, 'new', ${admin.id})`;
    });
    app = createApp({
      sql: await db.appSql(),
      authPort: auth,
      storagePort: {
        async put(key) {
          return key;
        },
        async get() {
          return Buffer.from("file");
        },
        async delete(key) {
          removed.push(key);
        },
      },
    });
  }, 30000);
  afterAll(async () => {
    if (db) await db.close();
  });

  it("retains versions and storage while hiding a deleted document, including from another tenant", async () => {
    const headers = { Authorization: "Bearer admin" };
    expect(
      (
        await app.request(`/v1/documents/${documentId}`, {
          method: "DELETE",
          headers: { Authorization: "Bearer other" },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(`/v1/documents/${documentId}`, {
          method: "DELETE",
          headers,
        })
      ).status,
    ).toBe(200);
    expect(removed).toEqual([]);
    const retained = await withTenant(
      db.sql,
      { organizationId: org },
      (tx) =>
        tx<
          { versions: number }[]
        >`SELECT count(*)::int AS versions FROM document_versions WHERE document_id = ${documentId}`,
    );
    expect(retained[0]?.versions).toBe(2);
    const list = await app.request("/v1/documents", { headers });
    expect(JSON.stringify(await list.json())).not.toContain(documentId);
    expect(
      (await app.request(`/v1/documents/${documentId}/download`, { headers }))
        .status,
    ).toBe(404);
    expect(
      (
        await app.request(`/v1/documents/${documentId}/acknowledge`, {
          method: "POST",
          headers,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(`/v1/documents/${documentId}/acknowledgements`, {
          headers,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(`/v1/documents/${documentId}`, {
          method: "DELETE",
          headers,
        })
      ).status,
    ).toBe(404);
  });
});

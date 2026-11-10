import crypto from "node:crypto";
import type { Sql } from "postgres";
import { describe, expect, it, vi } from "vitest";
import {
  EditionResponseSchema,
  type AuthUser,
  type ProblemDetails,
} from "@librehr/contracts";
import { signLicenseKey, type LicensePayload } from "@librehr/ee";
import { createApp } from "../src/app.js";
import { loadEdition } from "../src/extensions/load.js";
import type { AuthPort } from "../src/ports/auth.js";

const ORG = "f1000000-0000-0000-0000-000000000001";
const users: Record<string, AuthUser> = {
  admin: {
    id: "f1000000-0000-0000-0000-0000000000a1",
    email: "edition-admin@example.invalid",
    name: "Edition Admin",
    role: "admin",
    organizationId: ORG,
  },
  employee: {
    id: "f1000000-0000-0000-0000-0000000000e1",
    email: "edition-employee@example.invalid",
    name: "Edition Employee",
    role: "employee",
    organizationId: ORG,
  },
};

/** Session token `token_<role>` resolves to that user. */
const authPort: AuthPort = {
  async verifyCredentials() {
    return null;
  },
  async createSession() {
    return null;
  },
  async getSession(token) {
    const user = users[token.replace(/^token_/, "")];
    return user
      ? { user, token, expiresAt: new Date(Date.now() + 60000) }
      : null;
  },
  async revokeSession() {},
};

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const privatePem = privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();

function key(overrides: Partial<LicensePayload> = {}): string {
  return signLicenseKey(
    {
      v: 1,
      licensee: "Example Cooperative SCCL",
      edition: "business",
      features: ["sso"],
      issuedAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
      ...overrides,
    },
    privatePem,
  );
}

async function appFor(licenseKey: string | undefined) {
  const edition = await loadEdition({ licenseKey, publicKeyPem: publicPem });
  return createApp({
    sql: {} as unknown as Sql,
    authPort,
    config: { nodeEnv: "production" },
    license: edition.license,
    extensions: edition.extensions,
  });
}

async function getEdition(app: ReturnType<typeof createApp>, role?: string) {
  return app.request("/v1/edition", {
    headers: role ? { Authorization: `Bearer token_${role}` } : {},
  });
}

describe("GET /v1/edition (LIC-001)", () => {
  it("requires authentication", async () => {
    const res = await getEdition(await appFor(undefined));
    expect(res.status).toBe(401);
    expect(((await res.json()) as ProblemDetails).code).toBe("UNAUTHORIZED");
  });

  it("defaults to Community when createApp gets no licence", async () => {
    const app = createApp({
      sql: {} as unknown as Sql,
      authPort,
      config: { nodeEnv: "production" },
    });
    const res = await getEdition(app, "employee");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      edition: "community",
      licenseStatus: "absent",
      features: [],
    });
  });

  it("reports Business with a valid key and shows the licensee to admins only", async () => {
    const app = await appFor(key());

    const adminRes = await getEdition(app, "admin");
    const adminBody = EditionResponseSchema.parse(await adminRes.json());
    expect(adminBody).toMatchObject({
      edition: "business",
      licenseStatus: "valid",
      features: ["sso"],
      licensee: "Example Cooperative SCCL",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });

    const employeeBody = EditionResponseSchema.parse(
      await (await getEdition(app, "employee")).json(),
    );
    expect(employeeBody.edition).toBe("business");
    expect(employeeBody.licensee).toBeUndefined();
    expect(employeeBody.expiresAt).toBeUndefined();
  });

  it("falls back to Community for an expired key", async () => {
    const app = await appFor(key({ expiresAt: "2020-01-01T00:00:00.000Z" }));
    const body = EditionResponseSchema.parse(
      await (await getEdition(app, "admin")).json(),
    );
    expect(body.edition).toBe("community");
    expect(body.licenseStatus).toBe("expired");
    expect(body.features).toEqual([]);
  });
});

describe("loadEdition (LIC-002)", () => {
  it("returns Community without a key and does not warn", async () => {
    const warn = vi.fn();
    const bundle = await loadEdition({ publicKeyPem: publicPem, warn });
    expect(bundle.license.licenseStatus).toBe("absent");
    expect(bundle.extensions).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns without echoing the key when it is invalid", async () => {
    const warn = vi.fn();
    const bad = `${key()}x`;
    const bundle = await loadEdition({
      licenseKey: bad,
      publicKeyPem: publicPem,
      warn,
    });
    expect(bundle.license.edition).toBe("community");
    expect(warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(warn.mock.calls)).not.toContain(bad);
  });
});

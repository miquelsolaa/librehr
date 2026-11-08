import crypto from "node:crypto";
import type { TenantTx } from "../with-tenant.js";

export interface PersonalAccessTokenRow {
  id: string;
  organizationId: string;
  userId: string;
  name: string;
  tokenHash: string;
  prefix: string;
  scopes: string[];
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatedTokenResult {
  token: PersonalAccessTokenRow;
  plainToken: string; // only returned once upon generation
}

function parseScopes(scopes: unknown): string[] {
  if (Array.isArray(scopes)) {
    return scopes as string[];
  }
  if (typeof scopes === "string") {
    try {
      const parsed = JSON.parse(scopes);
      if (Array.isArray(parsed)) return parsed as string[];
    } catch {
      // ignore
    }
  }
  return [];
}

export class TokenRepository {
  /**
   * Hashes a raw token with SHA-256 for secure storage.
   */
  static hashToken(rawToken: string): string {
    return crypto.createHash("sha256").update(rawToken).digest("hex");
  }

  /**
   * Creates a new scoped Personal Access Token (ADM-006).
   * Generates a token with prefix `lhr_` and 32 bytes of secure entropy.
   */
  async createToken(
    tx: TenantTx,
    data: {
      userId: string;
      name: string;
      scopes: string[];
      expiresAt?: Date | null | undefined;
    },
  ): Promise<CreatedTokenResult> {
    const randomSecret = crypto.randomBytes(24).toString("base64url");
    const plainToken = `lhr_${randomSecret}`;
    const tokenHash = TokenRepository.hashToken(plainToken);
    const prefix = plainToken.slice(0, 8);

    const rows = await tx<PersonalAccessTokenRow[]>`
      INSERT INTO personal_access_tokens (
        user_id, name, token_hash, prefix, scopes, expires_at
      ) VALUES (
        ${data.userId},
        ${data.name},
        ${tokenHash},
        ${prefix},
        ${tx.json(data.scopes)},
        ${data.expiresAt ?? null}
      )
      RETURNING id, organization_id as "organizationId", user_id as "userId",
                name, token_hash as "tokenHash", prefix, scopes,
                expires_at as "expiresAt", last_used_at as "lastUsedAt",
                created_at as "createdAt", updated_at as "updatedAt"
    `;

    const row = rows[0]!;
    return {
      token: {
        ...row,
        scopes: parseScopes(row.scopes),
      },
      plainToken,
    };
  }

  async listByUser(
    tx: TenantTx,
    userId: string,
  ): Promise<PersonalAccessTokenRow[]> {
    const rows = await tx<PersonalAccessTokenRow[]>`
      SELECT id, organization_id as "organizationId", user_id as "userId",
             name, token_hash as "tokenHash", prefix, scopes,
             expires_at as "expiresAt", last_used_at as "lastUsedAt",
             created_at as "createdAt", updated_at as "updatedAt"
      FROM personal_access_tokens
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
    `;
    return rows.map((r) => ({
      ...r,
      scopes: parseScopes(r.scopes),
    }));
  }

  async findByTokenHash(
    tx: TenantTx,
    tokenHash: string,
  ): Promise<PersonalAccessTokenRow | null> {
    const rows = await tx<PersonalAccessTokenRow[]>`
      SELECT id, organization_id as "organizationId", user_id as "userId",
             name, token_hash as "tokenHash", prefix, scopes,
             expires_at as "expiresAt", last_used_at as "lastUsedAt",
             created_at as "createdAt", updated_at as "updatedAt"
      FROM personal_access_tokens
      WHERE token_hash = ${tokenHash}
        AND (expires_at IS NULL OR expires_at > now())
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;
    return {
      ...row,
      scopes: parseScopes(row.scopes),
    };
  }

  async recordUsage(tx: TenantTx, tokenId: string): Promise<void> {
    await tx`
      UPDATE personal_access_tokens
      SET last_used_at = now()
      WHERE id = ${tokenId}
    `;
  }

  async delete(tx: TenantTx, id: string, userId: string): Promise<boolean> {
    const res = await tx`
      DELETE FROM personal_access_tokens
      WHERE id = ${id} AND user_id = ${userId}
    `;
    return res.count > 0;
  }
}

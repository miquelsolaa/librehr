import type { Sql } from "postgres";
import type { TenantTx } from "../with-tenant.js";
import { decryptEnvelope, encryptEnvelope } from "../crypto/envelope.js";

export interface UserRow {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  /** Decrypted TOTP secret (AUTH-003); stored envelope-encrypted. */
  twoFactorSecret?: string | null | undefined;
  /**
   * True when the stored secret predates encryption (plaintext). Callers
   * re-encrypt it with `reencryptTwoFactorSecret` after the next successful
   * verification; see `isEncryptedSecret`.
   */
  twoFactorSecretIsPlaintext?: boolean | undefined;
  twoFactorRecoveryCodes?: string[] | null | undefined;
}

type RawUserRow = Omit<UserRow, "twoFactorSecretIsPlaintext">;

/**
 * Envelope payloads are JSON objects; a Base32 TOTP secret never starts with
 * "{". Secrets written before encryption was introduced are re-encrypted
 * lazily, because the master key lives in the application and cannot be used
 * from a SQL migration.
 */
function isEncryptedSecret(value: string): boolean {
  return value.trimStart().startsWith("{");
}

function decodeRow(row: RawUserRow | undefined): UserRow | null {
  if (!row) return null;
  const stored = row.twoFactorSecret;
  if (!stored) return { ...row, twoFactorSecretIsPlaintext: false };
  if (isEncryptedSecret(stored)) {
    return {
      ...row,
      twoFactorSecret: decryptEnvelope(stored),
      twoFactorSecretIsPlaintext: false,
    };
  }
  return { ...row, twoFactorSecretIsPlaintext: true };
}

export class UserRepository {
  async findById(tx: TenantTx | Sql, id: string): Promise<UserRow | null> {
    const rows = await tx<RawUserRow[]>`
      SELECT
        id,
        email,
        name,
        email_verified as "emailVerified",
        two_factor_enabled as "twoFactorEnabled",
        two_factor_secret as "twoFactorSecret",
        two_factor_recovery_codes as "twoFactorRecoveryCodes"
      FROM users
      WHERE id = ${id}
      LIMIT 1
    `;
    return decodeRow(rows[0]);
  }

  async findByEmail(
    tx: TenantTx | Sql,
    email: string,
  ): Promise<UserRow | null> {
    const rows = await tx<RawUserRow[]>`
      SELECT
        id,
        email,
        name,
        email_verified as "emailVerified",
        two_factor_enabled as "twoFactorEnabled",
        two_factor_secret as "twoFactorSecret",
        two_factor_recovery_codes as "twoFactorRecoveryCodes"
      FROM users
      WHERE email = ${email}
      LIMIT 1
    `;
    return decodeRow(rows[0]);
  }

  /**
   * Enables 2FA with an envelope-encrypted secret. Only succeeds while 2FA is
   * off, so an existing secret is never overwritten; returns false otherwise.
   */
  async enableTwoFactor(
    tx: TenantTx | Sql,
    userId: string,
    secret: string,
    hashedRecoveryCodes: string[],
  ): Promise<boolean> {
    const rows = await tx<{ id: string }[]>`
      UPDATE users
      SET
        two_factor_enabled = true,
        two_factor_secret = ${encryptEnvelope(secret)},
        two_factor_recovery_codes = ${JSON.stringify(hashedRecoveryCodes)}::jsonb,
        updated_at = now()
      WHERE id = ${userId} AND two_factor_enabled = false
      RETURNING id
    `;
    return rows.length > 0;
  }

  /**
   * Replaces a legacy plaintext secret with its encrypted form. A no-op when
   * the stored value changed in the meantime (e.g. 2FA was disabled).
   */
  async reencryptTwoFactorSecret(
    tx: TenantTx | Sql,
    userId: string,
    plaintextSecret: string,
  ): Promise<void> {
    await tx`
      UPDATE users
      SET two_factor_secret = ${encryptEnvelope(plaintextSecret)},
          updated_at = now()
      WHERE id = ${userId} AND two_factor_secret = ${plaintextSecret}
    `;
  }

  async disableTwoFactor(tx: TenantTx | Sql, userId: string): Promise<void> {
    await tx`
      UPDATE users
      SET
        two_factor_enabled = false,
        two_factor_secret = NULL,
        two_factor_recovery_codes = NULL,
        updated_at = now()
      WHERE id = ${userId}
    `;
  }

  async updateRecoveryCodes(
    tx: TenantTx | Sql,
    userId: string,
    hashedRecoveryCodes: string[],
  ): Promise<void> {
    await tx`
      UPDATE users
      SET
        two_factor_recovery_codes = ${JSON.stringify(hashedRecoveryCodes)}::jsonb,
        updated_at = now()
      WHERE id = ${userId}
    `;
  }
}

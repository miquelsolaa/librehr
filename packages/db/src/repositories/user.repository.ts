import type { Sql } from "postgres";
import type { TenantTx } from "../with-tenant.js";
import { decryptEnvelope, encryptEnvelope } from "../crypto/envelope.js";
import { hashBearerToken } from "../crypto/token-hash.js";

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
   * Stores a server-generated TOTP secret (envelope-encrypted) and hashed
   * recovery codes as a pending 2FA setup that expires after `ttlMs`,
   * replacing any earlier pending setup. Only while 2FA is off; returns false
   * otherwise.
   */
  async startTwoFactorSetup(
    tx: TenantTx | Sql,
    userId: string,
    secret: string,
    hashedRecoveryCodes: string[],
    ttlMs: number,
  ): Promise<boolean> {
    const rows = await tx<{ id: string }[]>`
      UPDATE users
      SET
        two_factor_pending_secret = ${encryptEnvelope(secret)},
        two_factor_pending_recovery_codes = ${tx.json(hashedRecoveryCodes)},
        two_factor_pending_expires_at = now() + make_interval(secs => ${ttlMs / 1000}),
        updated_at = now()
      WHERE id = ${userId} AND two_factor_enabled = false
      RETURNING id
    `;
    return rows.length > 0;
  }

  /**
   * The unexpired pending setup of a user without 2FA: the decrypted secret,
   * and the stored ciphertext that identifies this setup for
   * {@link promotePendingTwoFactor}.
   */
  async findPendingTwoFactor(
    tx: TenantTx | Sql,
    userId: string,
  ): Promise<{ secret: string; setupId: string } | null> {
    const rows = await tx<{ stored: string }[]>`
      SELECT two_factor_pending_secret AS stored
      FROM users
      WHERE id = ${userId}
        AND two_factor_enabled = false
        AND two_factor_pending_secret IS NOT NULL
        AND two_factor_pending_expires_at > now()
      LIMIT 1
    `;
    const stored = rows[0]?.stored;
    return stored ? { secret: decryptEnvelope(stored), setupId: stored } : null;
  }

  /**
   * Enables 2FA by promoting the pending setup identified by `setupId` to the
   * active secret and recovery codes, recording `acceptedStep` (the TOTP step
   * that confirmed it) as used. A single UPDATE, so it only succeeds while
   * 2FA is off and that exact setup is still pending and unexpired; returns
   * false otherwise.
   */
  async promotePendingTwoFactor(
    tx: TenantTx | Sql,
    userId: string,
    setupId: string,
    acceptedStep: number,
  ): Promise<boolean> {
    const rows = await tx<{ id: string }[]>`
      UPDATE users
      SET
        two_factor_enabled = true,
        two_factor_last_step = ${acceptedStep},
        two_factor_secret = two_factor_pending_secret,
        two_factor_recovery_codes = two_factor_pending_recovery_codes,
        two_factor_pending_secret = NULL,
        two_factor_pending_recovery_codes = NULL,
        two_factor_pending_expires_at = NULL,
        updated_at = now()
      WHERE id = ${userId}
        AND two_factor_enabled = false
        AND two_factor_pending_secret = ${setupId}
        AND two_factor_pending_expires_at > now()
      RETURNING id
    `;
    return rows.length > 0;
  }

  /** Deletes every session of the user except `keepToken` (a raw token, if given). */
  async revokeOtherSessions(
    tx: TenantTx | Sql,
    userId: string,
    keepToken: string | undefined,
  ): Promise<number> {
    const keepHash =
      keepToken === undefined ? null : hashBearerToken(keepToken);
    const result = await tx`
      DELETE FROM sessions
      WHERE user_id = ${userId}
        AND (${keepHash}::text IS NULL OR token <> ${keepHash})
    `;
    return result.count;
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
        two_factor_pending_secret = NULL,
        two_factor_pending_recovery_codes = NULL,
        two_factor_pending_expires_at = NULL,
        updated_at = now()
      WHERE id = ${userId}
    `;
  }

  /**
   * Records `step` as the newest accepted TOTP time step, only if it is later
   * than the stored one. One conditional UPDATE, so of two requests carrying
   * the same code only one succeeds; returns false for a replay.
   */
  async consumeTotpStep(
    tx: TenantTx | Sql,
    userId: string,
    step: number,
  ): Promise<boolean> {
    const rows = await tx<{ id: string }[]>`
      UPDATE users
      SET two_factor_last_step = ${step}, updated_at = now()
      WHERE id = ${userId}
        AND two_factor_enabled = true
        AND (two_factor_last_step IS NULL OR two_factor_last_step < ${step})
      RETURNING id
    `;
    return rows.length > 0;
  }

  /**
   * Burns a recovery code: removes its hash from the stored array in one
   * conditional UPDATE, so of two parallel requests with the same code only
   * one succeeds. Returns false when the code is not (or no longer) stored.
   */
  async burnRecoveryCode(
    tx: TenantTx | Sql,
    userId: string,
    codeHash: string,
  ): Promise<boolean> {
    const rows = await tx<{ id: string }[]>`
      UPDATE users
      SET two_factor_recovery_codes = two_factor_recovery_codes - ${codeHash}::text,
          updated_at = now()
      WHERE id = ${userId}
        AND two_factor_enabled = true
        AND jsonb_typeof(two_factor_recovery_codes) = 'array'
        AND two_factor_recovery_codes @> jsonb_build_array(${codeHash}::text)
      RETURNING id
    `;
    return rows.length > 0;
  }
}

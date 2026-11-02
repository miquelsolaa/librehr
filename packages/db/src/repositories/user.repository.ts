import type { Sql } from "postgres";
import type { TenantTx } from "../with-tenant.js";

export interface UserRow {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  twoFactorSecret?: string | null | undefined;
  twoFactorRecoveryCodes?: string[] | null | undefined;
}

export class UserRepository {
  async findById(tx: TenantTx | Sql, id: string): Promise<UserRow | null> {
    const rows = await tx<UserRow[]>`
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
    return rows[0] ?? null;
  }

  async findByEmail(
    tx: TenantTx | Sql,
    email: string,
  ): Promise<UserRow | null> {
    const rows = await tx<UserRow[]>`
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
    return rows[0] ?? null;
  }

  async enableTwoFactor(
    tx: TenantTx | Sql,
    userId: string,
    secret: string,
    hashedRecoveryCodes: string[],
  ): Promise<void> {
    await tx`
      UPDATE users
      SET
        two_factor_enabled = true,
        two_factor_secret = ${secret},
        two_factor_recovery_codes = ${JSON.stringify(hashedRecoveryCodes)}::jsonb,
        updated_at = now()
      WHERE id = ${userId}
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

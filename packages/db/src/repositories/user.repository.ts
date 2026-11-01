import type { TenantTx } from "../with-tenant.js";

export interface UserRow {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
}

export class UserRepository {
  async findById(tx: TenantTx, id: string): Promise<UserRow | null> {
    const rows = await tx<UserRow[]>`
      SELECT id, email, name, email_verified as "emailVerified"
      FROM users
      WHERE id = ${id}
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  async findByEmail(tx: TenantTx, email: string): Promise<UserRow | null> {
    const rows = await tx<UserRow[]>`
      SELECT id, email, name, email_verified as "emailVerified"
      FROM users
      WHERE email = ${email}
      LIMIT 1
    `;
    return rows[0] ?? null;
  }
}

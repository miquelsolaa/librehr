import type { Sql } from "postgres";
import { z } from "zod";
import { hashPassword } from "./password.js";

const input = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(1024),
});

/** Reset one account and invalidate its existing sessions atomically. */
export async function recoverAccount(
  sql: Sql,
  email: string,
  password: string,
): Promise<boolean> {
  const data = input.parse({ email, password });
  const passwordHash = await hashPassword(data.password);
  return sql.begin(async (tx) => {
    const rows = await tx<
      { id: string }[]
    >`UPDATE users SET password_hash = ${passwordHash}, updated_at = now() WHERE email = ${data.email} RETURNING id`;
    const account = rows[0];
    if (!account) return false;
    await tx`DELETE FROM sessions WHERE user_id = ${account.id}`;
    return true;
  });
}

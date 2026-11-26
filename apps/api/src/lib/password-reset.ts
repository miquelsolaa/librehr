import crypto from "node:crypto";
import type { Sql } from "postgres";
import { hashBearerToken } from "@librehr/db";
import { hashPassword } from "./password.js";

/**
 * AUTH-001 password reset.
 *
 * The emailed token is 32 random bytes (base64url); only its SHA-256 hex is
 * stored. A token works for one hour and once. Requesting a new link spends
 * the user's earlier unused links, so at most one is ever valid.
 */

/** Default cap on links per account per hour, whatever IP asks for them. */
export const DEFAULT_RESET_LINKS_PER_HOUR = 3;

/**
 * Creates a reset link token, or null when the email has no password account
 * or the account already got `maxPerHour` links in the last hour. The cap is
 * per account and kept in the database, so rotating IPs cannot flood an
 * inbox; the caller answers 202 either way.
 */
export async function createPasswordResetToken(
  sql: Sql,
  email: string,
  maxPerHour: number = DEFAULT_RESET_LINKS_PER_HOUR,
): Promise<{ userId: string; token: string } | null> {
  const token = crypto.randomBytes(32).toString("base64url");
  return sql.begin(async (tx) => {
    // Retention (migration 0037): links older than 30 days are all spent or
    // expired; delete them on every request, account or not.
    await tx`
      DELETE FROM password_reset_tokens
      WHERE created_at < now() - interval '30 days'`;
    // Accounts without a password sign in only through single sign-on: a
    // local password would let them bypass their organization's provider.
    // FOR UPDATE serializes requests for one account (users row first, then
    // tokens: the same order as librehr_auth_reset_password).
    const [account] = await tx<{ id: string }[]>`
      SELECT id FROM users
      WHERE email = ${email} AND password_hash IS NOT NULL
      LIMIT 1
      FOR UPDATE`;
    if (!account) return null;
    const [recent] = await tx<{ count: number }[]>`
      SELECT count(*)::int AS count FROM password_reset_tokens
      WHERE user_id = ${account.id}
        AND created_at > now() - interval '1 hour'`;
    if ((recent?.count ?? 0) >= maxPerHour) return null;
    await tx`
      UPDATE password_reset_tokens SET used_at = now()
      WHERE user_id = ${account.id} AND used_at IS NULL`;
    await tx`
      INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
      VALUES (${account.id}, ${hashBearerToken(token)}, now() + interval '1 hour')`;
    return { userId: account.id, token };
  });
}

/**
 * Sets a new password with a reset token: spends the token, revokes every
 * session and personal access token, and audits the reset in each of the
 * user's organizations, all in one transaction (librehr_auth_reset_password,
 * migration 0037). Returns the user id, or null for an unknown, used or
 * expired token. Two-factor settings are left as they are.
 */
export async function resetPasswordWithToken(
  sql: Sql,
  token: string,
  password: string,
): Promise<string | null> {
  const passwordHash = await hashPassword(password);
  const [row] = await sql<{ userId: string | null }[]>`
    SELECT librehr_auth_reset_password(
      ${hashBearerToken(token)}, ${passwordHash}
    ) AS "userId"`;
  return row?.userId ?? null;
}

export type ResetLocale = "ca" | "es" | "en";

const copy: Record<
  ResetLocale,
  { subject: string; intro: string; action: string; outro: string }
> = {
  ca: {
    subject: "Restableix la contrasenya de LibreHR",
    intro:
      "Hem rebut una sol·licitud per restablir la contrasenya del teu compte de LibreHR.",
    action: "Tria una contrasenya nova",
    outro:
      "L'enllaç caduca d'aquí a 1 hora i només es pot fer servir una vegada. Si no ho has demanat tu, ignora aquest correu: la teva contrasenya no canviarà.",
  },
  es: {
    subject: "Restablece tu contraseña de LibreHR",
    intro:
      "Hemos recibido una solicitud para restablecer la contraseña de tu cuenta de LibreHR.",
    action: "Elige una contraseña nueva",
    outro:
      "El enlace caduca en 1 hora y solo se puede usar una vez. Si no lo has pedido tú, ignora este correo: tu contraseña no cambiará.",
  },
  en: {
    subject: "Reset your LibreHR password",
    intro:
      "We received a request to reset the password of your LibreHR account.",
    action: "Choose a new password",
    outro:
      "The link expires in 1 hour and works only once. If you did not ask for this, ignore this email: your password will not change.",
  },
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * The reset email. The token goes in the URL fragment, which browsers never
 * send to a server, so it stays out of web server and proxy logs.
 */
export function passwordResetEmail(
  appUrl: string,
  locale: ResetLocale,
  token: string,
): { subject: string; html: string; text: string } {
  const t = copy[locale];
  const url = `${appUrl.replace(/\/+$/, "")}/${locale}/reset-password#token=${token}`;
  return {
    subject: t.subject,
    html: `<p>${escapeHtml(t.intro)}</p><p><a href="${escapeHtml(url)}">${escapeHtml(t.action)}</a></p><p>${escapeHtml(t.outro)}</p>`,
    text: `${t.intro}\n\n${t.action}: ${url}\n\n${t.outro}`,
  };
}

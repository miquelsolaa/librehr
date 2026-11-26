import crypto from "node:crypto";
import type { Sql } from "postgres";
import { hashBearerToken } from "@librehr/db";

/**
 * AUTH-001 email verification.
 *
 * The emailed token is 32 random bytes (base64url); only its SHA-256 hex is
 * stored, with the address it was sent to. A token works once, until it
 * expires (24 h by default), and only while that address is still the
 * account's email. Requesting a new link spends the user's earlier unused
 * links, so at most one is ever valid. Confirming grants no session.
 */

/** Default cap on links per account per hour, whatever IP asks for them. */
export const DEFAULT_VERIFICATION_LINKS_PER_HOUR = 3;

/** Default link lifetime: long enough to survive checking mail the next day. */
export const DEFAULT_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

export interface EmailVerificationOptions {
  /** Links per account per hour; further requests create nothing. */
  maxPerHour?: number;
  /** How long a link stays valid, in milliseconds. */
  ttlMs?: number;
}

/**
 * Creates a verification link token for `userId`, or null when the account
 * is unknown, already verified, or already got `maxPerHour` links in the
 * last hour. The cap is per account and kept in the database, so rotating
 * IPs cannot flood an inbox. Returns the address the link must be sent to.
 */
export async function createEmailVerificationToken(
  sql: Sql,
  userId: string,
  options: EmailVerificationOptions = {},
): Promise<{ email: string; token: string } | null> {
  const maxPerHour = options.maxPerHour ?? DEFAULT_VERIFICATION_LINKS_PER_HOUR;
  const ttlMs = options.ttlMs ?? DEFAULT_VERIFICATION_TTL_MS;
  if (!Number.isInteger(ttlMs) || ttlMs <= 0) {
    throw new RangeError("ttlMs must be a positive integer");
  }
  const token = crypto.randomBytes(32).toString("base64url");
  return sql.begin(async (tx) => {
    // Retention (migration 0043): links older than 30 days are all spent or
    // expired; delete them on every request.
    await tx`
      DELETE FROM email_verification_tokens
      WHERE created_at < now() - interval '30 days'`;
    // FOR UPDATE serializes requests for one account (users row first, then
    // tokens: the same order as librehr_auth_verify_email).
    const [account] = await tx<{ email: string }[]>`
      SELECT email FROM users
      WHERE id = ${userId} AND NOT email_verified
      FOR UPDATE`;
    if (!account) return null;
    const [recent] = await tx<{ count: number }[]>`
      SELECT count(*)::int AS count FROM email_verification_tokens
      WHERE user_id = ${userId}
        AND created_at > now() - interval '1 hour'`;
    if ((recent?.count ?? 0) >= maxPerHour) return null;
    await tx`
      UPDATE email_verification_tokens SET used_at = now()
      WHERE user_id = ${userId} AND used_at IS NULL`;
    await tx`
      INSERT INTO email_verification_tokens
        (user_id, email, token_hash, expires_at)
      VALUES (${userId}, ${account.email}, ${hashBearerToken(token)},
        now() + make_interval(secs => ${ttlMs / 1000}))`;
    return { email: account.email, token };
  });
}

/**
 * Marks the account's email as verified with a link token: spends the token
 * and audits the verification in each of the user's organizations, in one
 * transaction (librehr_auth_verify_email, migration 0043). Returns the user
 * id, or null for an unknown, used, expired or no longer matching token.
 */
export async function verifyEmailWithToken(
  sql: Sql,
  token: string,
): Promise<string | null> {
  const [row] = await sql<{ userId: string | null }[]>`
    SELECT librehr_auth_verify_email(${hashBearerToken(token)}) AS "userId"`;
  return row?.userId ?? null;
}

export type VerificationLocale = "ca" | "es" | "en";

const copy: Record<
  VerificationLocale,
  {
    subject: string;
    intro: string;
    action: string;
    outro: (hours: number) => string;
  }
> = {
  ca: {
    subject: "Confirma la teva adreça electrònica a LibreHR",
    intro:
      "Confirma que aquesta és l'adreça electrònica del teu compte de LibreHR. La farem servir per enviar-te els enllaços per restablir la contrasenya.",
    action: "Confirma l'adreça electrònica",
    outro: (hours) =>
      `L'enllaç caduca d'aquí a ${hours} ${hours === 1 ? "hora" : "hores"} i només es pot fer servir una vegada. Si no tens cap compte a LibreHR, ignora aquest correu.`,
  },
  es: {
    subject: "Confirma tu dirección de correo en LibreHR",
    intro:
      "Confirma que esta es la dirección de correo de tu cuenta de LibreHR. La usaremos para enviarte los enlaces para restablecer la contraseña.",
    action: "Confirmar la dirección de correo",
    outro: (hours) =>
      `El enlace caduca en ${hours} ${hours === 1 ? "hora" : "horas"} y solo se puede usar una vez. Si no tienes ninguna cuenta en LibreHR, ignora este correo.`,
  },
  en: {
    subject: "Confirm your email address on LibreHR",
    intro:
      "Confirm that this is the email address of your LibreHR account. We will use it to send you password reset links.",
    action: "Confirm email address",
    outro: (hours) =>
      `The link expires in ${hours} ${hours === 1 ? "hour" : "hours"} and works only once. If you do not have a LibreHR account, ignore this email.`,
  },
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const isLocale = (value: string | undefined): value is VerificationLocale =>
  value === "ca" || value === "es" || value === "en";

/**
 * The verification email, in `locale` or Catalan when it is not supported.
 * The link is absolute (APP_URL) and carries the token in the URL fragment,
 * which browsers never send to a server, so it stays out of web server and
 * proxy logs. `ttlMs` is the link lifetime the email announces, rounded up
 * to whole hours.
 */
export function emailVerificationEmail(
  appUrl: string,
  locale: string | undefined,
  token: string,
  ttlMs: number = DEFAULT_VERIFICATION_TTL_MS,
): { subject: string; html: string; text: string } {
  const lang: VerificationLocale = isLocale(locale) ? locale : "ca";
  const t = copy[lang];
  const outro = t.outro(Math.max(1, Math.ceil(ttlMs / 3_600_000)));
  const url = `${appUrl.replace(/\/+$/, "")}/${lang}/verify-email#token=${encodeURIComponent(token)}`;
  return {
    subject: t.subject,
    html: `<p>${escapeHtml(t.intro)}</p><p><a href="${escapeHtml(url)}">${escapeHtml(t.action)}</a></p><p>${escapeHtml(outro)}</p>`,
    text: `${t.intro}\n\n${t.action}: ${url}\n\n${outro}`,
  };
}

/**
 * AUTH-005 invitation email. The link is absolute (APP_URL) and in the
 * organization's default locale, so it opens from any mail client.
 */

type Locale = "ca" | "es" | "en";

const copy: Record<
  Locale,
  {
    subject: (org: string) => string;
    intro: (org: string) => string;
    action: string;
    outro: string;
  }
> = {
  ca: {
    subject: (org) => `Invitació a ${org} a LibreHR`,
    intro: (org) => `T'han convidat a unir-te a ${org} a LibreHR.`,
    action: "Accepta la invitació",
    outro: "La invitació caduca d'aquí a 7 dies.",
  },
  es: {
    subject: (org) => `Invitación a ${org} en LibreHR`,
    intro: (org) => `Te han invitado a unirte a ${org} en LibreHR.`,
    action: "Aceptar la invitación",
    outro: "La invitación caduca en 7 días.",
  },
  en: {
    subject: (org) => `Invitation to ${org} on LibreHR`,
    intro: (org) => `You have been invited to join ${org} on LibreHR.`,
    action: "Accept the invitation",
    outro: "The invitation expires in 7 days.",
  },
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const isLocale = (value: string | undefined): value is Locale =>
  value === "ca" || value === "es" || value === "en";

export function invitationEmail(
  appUrl: string,
  orgLocale: string | undefined,
  orgName: string | undefined,
  token: string,
): { subject: string; html: string; text: string } {
  const locale: Locale = isLocale(orgLocale) ? orgLocale : "ca";
  const t = copy[locale];
  const org = orgName?.trim() || "LibreHR";
  const url = `${appUrl.replace(/\/+$/, "")}/${locale}/invite/${encodeURIComponent(token)}`;
  return {
    subject: t.subject(org),
    html: `<p>${escapeHtml(t.intro(org))}</p><p><a href="${escapeHtml(url)}">${escapeHtml(t.action)}</a></p><p>${escapeHtml(t.outro)}</p>`,
    text: `${t.intro(org)}\n\n${t.action}: ${url}\n\n${t.outro}`,
  };
}

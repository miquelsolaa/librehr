# Require single sign-on (AUTH-004)

"Require SSO" (**Settings -> Single Sign-On**, `enforceSso`) makes the
members of one organization sign in through its identity provider instead of
with a password. It is part of LibreHR Business (`ee/`, `LIC-003`).

## When it applies

An organization requires SSO when its SSO configuration is switched on and
"Require SSO" is checked. The instance applies it only when both hold:

- the licence grants `sso`, and
- `SSO_ENABLED=true`.

Otherwise the setting is stored but has no effect: members sign in with
their password as before, and nothing is deleted. Keep `SSO_ENABLED` off
until the OIDC callback (issue #34) is available; before that, nobody can
open an SSO session, so only break-glass admins (below) could sign in.

## Decided per membership, never by email domain

Enforcement belongs to an organization's memberships, not to email domains.
An organization that lists a shared domain in its allowed domains cannot
affect members of any other organization.

- A password sign-in opens a session in the user's oldest membership where a
  password is still allowed. Someone in an organization that requires SSO and
  in another that does not lands in the second one with a password.
- When no membership is left, sign-in answers `403` with code
  `SSO_REQUIRED`, only after the password (and second factor) were checked.
  The answer names no organization. The sign-in page then offers "Continue
  with SSO".
- Password sessions that already exist stop working as soon as the
  organization requires SSO, and work again if the requirement is lifted or
  the licence lapses. Sessions are not deleted.
- Accepting an invitation into such an organization still creates the
  membership, then answers `403 SSO_REQUIRED` without a session; the page
  sends the person to sign in with SSO.
- Personal access tokens that already exist keep working. New ones can be
  created only from an SSO session or by a break-glass admin.
- Password reset still works; the new password cannot open a session in an
  organization that requires SSO.

## Break-glass access

If the identity provider fails or is misconfigured, members with the `admin`
role who have two-factor authentication (TOTP) on can still sign in to the
organization with their password. Each such sign-in is recorded in the audit
log as `auth.sso.break_glass`. Refused sign-ins are not audited; the API logs
a warning without personal data.

Because of this, "Require SSO" can be saved only when:

- SSO is switched on (otherwise `400 VALIDATION_ERROR` on `enforceSso`), and
- at least one admin of the organization has two-factor authentication
  (otherwise `409 SSO_BREAK_GLASS_REQUIRED`).

Saving the setting asks for confirmation in the web app, and the audit entry
`sso_config.updated` records both `enforceSso` and `previousEnforceSso`.

## Operator recovery

When no break-glass admin can sign in:

- Set `SSO_ENABLED=false` and restart the API. Enforcement stops on the
  whole instance; the stored setting is kept.
- Or reset an admin's password with the recover-account CLI
  (`apps/api/src/cli/recover-account.ts`), then sign in as break-glass if
  that admin has two-factor authentication.
- Without a licence, an admin can still switch the stored configuration off
  (`POST /v1/sso/config/disable`), which also lifts "Require SSO".

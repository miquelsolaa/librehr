# Require single sign-on (AUTH-004)

"Require SSO" (**Settings -> Single Sign-On**, `enforceSso`) makes the
members of one organization sign in through its identity provider instead of
with a password. It is part of LibreHR Business (`ee/`, `LIC-003`).

## When it applies

An organization requires SSO when its SSO configuration is switched on and
"Require SSO" is checked. The instance applies it only while the licence
grants `sso`; there is no environment variable to switch it on or off.
Without such a licence the setting is stored but has no effect: members sign
in with their password as before, and nothing is deleted.

`SSO_ENABLED` is retired and ignored if still set. It used to be the
operator's emergency switch for enforcement; use the recovery paths below
instead. (Comments in migration `0041_sso_enforcement.sql` still mention it;
migrations are forward-only and are not edited.)

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
  sends the person to sign in with SSO, with the invitation's email domain
  prefilled (only the domain is put in the URL). This holds for break-glass
  admins too: accepting checks no second factor, so they sign in afterwards
  through the sign-in page with their TOTP code, which is audited.
- Personal access tokens that already exist keep working. New ones can be
  created only from an SSO session or by a break-glass admin. The
  confirmation shown before requiring SSO says how many unexpired tokens the
  organization has.
- An SSO session is always opened in the organization whose identity
  provider signed the user in; it is never bound to a default membership.
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

While an organization requires SSO, the last break-glass admin cannot be
taken away. These answer `409 SSO_BREAK_GLASS_REQUIRED` and change nothing:

- switching off two-factor authentication (`POST /v1/auth/2fa/disable`) when
  that leaves any organization the user is an admin of with no break-glass
  admin;
- terminating that admin's employee record, whatever the termination date;
- accepting an invitation with a non-admin role, which would demote them.

Give a second admin two-factor authentication first. The rule applies to
the stored setting even when enforcement is inactive on the instance, so it
cannot lock members out once the licence comes back.

## Operator recovery

When no break-glass admin can sign in, in this order:

1. **Break-glass admin.** Any `admin` of the organization with two-factor
   authentication signs in with password and TOTP code, then unchecks
   "Require SSO" in **Settings -> Single Sign-On**. This is audited
   (`auth.sso.break_glass`, `sso_config.updated`).
2. **Recover an admin.** Reset an admin's password with the recover-account
   CLI (`apps/api/src/cli/recover-account.ts`), then sign in as break-glass
   if that admin has two-factor authentication.
3. **Lift the requirement in the database.** As a last resort, the operator
   switches "Require SSO" off for one organization with SQL, connected as the
   database owner (`librehr_owner`, the role that runs migrations). Find the
   organization's id first (`SELECT id, name FROM organizations;`). The
   tables use row-level security, so the statement sets the organization
   for the transaction, and it records the change in the audit log:

   ```sql
   BEGIN;
   SELECT set_config('app.current_org', '<organization-id>', true);
   UPDATE sso_configurations
      SET enforce_sso = false, updated_at = now()
    WHERE organization_id = '<organization-id>' AND enforce_sso;
   INSERT INTO audit_log (organization_id, action, resource_type, metadata)
   VALUES ('<organization-id>', 'sso_config.updated', 'sso_configurations',
           '{"enforceSso": false, "previousEnforceSso": true, "source": "operator_sql"}');
   COMMIT;
   ```

   Check that the `UPDATE` reports `UPDATE 1` before committing; otherwise
   run `ROLLBACK;`. Password sessions of the organization work again at once
   (enforcement is checked at lookup) and nothing else changes. Note in your
   own operations log who ran it and why. Admins then fix the identity
   provider and give a second admin two-factor authentication before
   requiring SSO again.

Without a licence granting `sso`, enforcement is already inert; an admin can
also switch the stored configuration off (`POST /v1/sso/config/disable`),
which lifts "Require SSO" as well.

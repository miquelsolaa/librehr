-- 0025b_two_factor_pending_setup.sql
-- AUTH-003: the server keeps the 2FA setup state instead of trusting the
-- client. /2fa/setup stores a freshly generated TOTP secret (envelope
-- encrypted, like two_factor_secret) and the hashed recovery codes as
-- pending, with an expiry; /2fa/enable only accepts a code that verifies
-- against that pending secret, then promotes it.
--
-- Additive and nullable: existing users have no pending setup.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "two_factor_pending_secret" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "two_factor_pending_recovery_codes" jsonb;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "two_factor_pending_expires_at" timestamptz;

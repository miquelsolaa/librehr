-- 0026_hash_bearer_tokens.sql
-- AUTH-001/002, AUTH-005: session and invitation tokens are stored hashed.
--
-- sessions.token and invitations.token held the raw bearer secret, so anyone
-- who could read the table or a backup could replay a live session or accept
-- a pending invitation. From this release the API stores only
-- SHA-256(token) as lowercase hex (hashBearerToken in packages/db) and hashes
-- the presented token before every lookup. The lookup functions of
-- migrations 0019/0021 compare the value they are given, so they need no
-- change. This migration rewrites the rows already stored, so existing
-- sessions and invitation links keep working.
--
-- Run once, before the new API serves requests (the runner records it in
-- librehr_migrations). Rows written by an older API after this migration
-- would hold raw tokens and simply stop matching: deploy the code together
-- with the migration.

-- 1. sessions is a global table without RLS: a plain UPDATE.
UPDATE "sessions"
SET "token" = encode(sha256(convert_to("token", 'UTF8')), 'hex');

-- 2. invitations is a tenant table under FORCE ROW LEVEL SECURITY, which binds
-- the owner role too, so a plain UPDATE would see no rows. The owner lifts
-- FORCE for this one statement and restores it in the same transaction (the
-- runner wraps each migration in one), so no other session ever observes the
-- table without it.
ALTER TABLE "invitations" NO FORCE ROW LEVEL SECURITY;
UPDATE "invitations"
SET "token" = encode(sha256(convert_to("token", 'UTF8')), 'hex');
ALTER TABLE "invitations" FORCE ROW LEVEL SECURITY;

COMMENT ON COLUMN "sessions"."token" IS
  'SHA-256 hex of the session bearer token; the raw token is never stored.';
COMMENT ON COLUMN "invitations"."token" IS
  'SHA-256 hex of the invitation link token; the raw token is never stored.';

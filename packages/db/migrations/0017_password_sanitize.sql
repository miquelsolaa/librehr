-- Only the current salted scrypt format is accepted by the password verifier.
-- Legacy plaintext and unsupported formats require an operator-assisted reset.
UPDATE users SET password_hash = NULL
WHERE password_hash IS NOT NULL
  AND password_hash !~ '^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$';

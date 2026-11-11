/**
 * Issues a LibreHR licence key (LIC-002).
 *
 *   pnpm --filter @librehr/ee issue-license -- \
 *     --private-key /secure/offline/librehr-license.pem \
 *     --licensee "Example SL" --features sso --expires 2027-12-31T23:59:59Z
 *
 * To create a development keypair (never use it in production):
 *
 *   pnpm --filter @librehr/ee issue-license -- --generate-keypair <dir>
 *
 * The private key must stay offline; never commit it (AGENTS.md section 8).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { signLicenseKey } from "../src/licensing/license-key.js";

const { values } = parseArgs({
  options: {
    "private-key": { type: "string" },
    licensee: { type: "string" },
    features: { type: "string", default: "sso" },
    expires: { type: "string" },
    "generate-keypair": { type: "string" },
  },
});

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

if (values["generate-keypair"]) {
  const dir = path.resolve(values["generate-keypair"]);
  fs.mkdirSync(dir, { recursive: true });
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  fs.writeFileSync(
    path.join(dir, "license-private.pem"),
    privateKey.export({ type: "pkcs8", format: "pem" }),
    { mode: 0o600 },
  );
  fs.writeFileSync(
    path.join(dir, "license-public.pem"),
    publicKey.export({ type: "spki", format: "pem" }),
  );
  process.stdout.write(`Keypair written to ${dir}\n`);
  process.exit(0);
}

const privateKeyPath =
  values["private-key"] ?? fail("--private-key is required");
const licensee = values.licensee ?? fail("--licensee is required");
const expires = values.expires ?? fail("--expires is required (RFC 3339 UTC)");

const token = signLicenseKey(
  {
    v: 1,
    licensee,
    edition: "business",
    features: values.features
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean),
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(expires).toISOString(),
  },
  fs.readFileSync(privateKeyPath, "utf8"),
);
process.stdout.write(`${token}\n`);

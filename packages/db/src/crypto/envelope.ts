import crypto from "node:crypto";

export interface EnvelopeEncrypted {
  keyId: string;
  encryptedDek: string; // base64
  dekIv: string; // base64
  dekTag: string; // base64
  ciphertext: string; // base64
  iv: string; // base64
  tag: string; // base64
}

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // Standard 96-bit IV for GCM
const KEY_LENGTH = 32; // 256 bits

const DEV_MASTER_KEY_SEED = "dev_envelope_master_key_for_local_dev";

function isDevMasterKey(envKey: string): boolean {
  return (
    envKey === DEV_MASTER_KEY_SEED ||
    Buffer.from(envKey, "base64").toString("utf-8") === DEV_MASTER_KEY_SEED
  );
}

export function getMasterKeyFromEnv(): Buffer {
  const envKey = process.env["ENVELOPE_MASTER_KEY"];
  if (
    process.env["NODE_ENV"] === "production" &&
    (!envKey || isDevMasterKey(envKey))
  ) {
    // The dev key is public; encrypting real data with it is equivalent to plaintext.
    throw new Error(
      "ENVELOPE_MASTER_KEY is missing or uses the public development key; set a unique key in production (e.g. `openssl rand -base64 32`)",
    );
  }
  if (envKey) {
    const b64Buf = Buffer.from(envKey, "base64");
    if (b64Buf.length === KEY_LENGTH) {
      return b64Buf;
    }
    const utf8Buf = Buffer.from(envKey, "utf-8");
    if (utf8Buf.length === KEY_LENGTH) {
      return utf8Buf;
    }
    return crypto.createHash("sha256").update(envKey).digest();
  }
  // Standard fallback for test / dev environment (exactly 32 bytes)
  return crypto
    .createHash("sha256")
    .update("dev_envelope_master_key_for_local_dev")
    .digest();
}

/**
 * Encrypts sensitive data using AES-256-GCM envelope encryption.
 * A fresh Data Encryption Key (DEK) is generated for each encryption,
 * and the DEK itself is encrypted using the Master Key.
 */
export function encryptEnvelope(
  plaintext: string,
  masterKey: Buffer = getMasterKeyFromEnv(),
  keyId: string = "v1",
): string {
  if (masterKey.length !== KEY_LENGTH) {
    throw new Error(`Master key must be exactly ${KEY_LENGTH} bytes`);
  }

  // 1. Generate ephemeral data key (DEK)
  const dek = crypto.randomBytes(KEY_LENGTH);

  // 2. Encrypt plaintext with DEK
  const dataIv = crypto.randomBytes(IV_LENGTH);
  const dataCipher = crypto.createCipheriv(ALGORITHM, dek, dataIv);
  const ciphertext = Buffer.concat([
    dataCipher.update(plaintext, "utf-8"),
    dataCipher.final(),
  ]);
  const dataTag = dataCipher.getAuthTag();

  // 3. Encrypt DEK with Master Key
  const dekIv = crypto.randomBytes(IV_LENGTH);
  const dekCipher = crypto.createCipheriv(ALGORITHM, masterKey, dekIv);
  const encryptedDek = Buffer.concat([
    dekCipher.update(dek),
    dekCipher.final(),
  ]);
  const dekTag = dekCipher.getAuthTag();

  const payload: EnvelopeEncrypted = {
    keyId,
    encryptedDek: encryptedDek.toString("base64"),
    dekIv: dekIv.toString("base64"),
    dekTag: dekTag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    iv: dataIv.toString("base64"),
    tag: dataTag.toString("base64"),
  };

  return JSON.stringify(payload);
}

/**
 * Decrypts envelope-encrypted data using the Master Key.
 */
export function decryptEnvelope(
  encryptedPayload: string,
  masterKey: Buffer = getMasterKeyFromEnv(),
): string {
  if (masterKey.length !== KEY_LENGTH) {
    throw new Error(`Master key must be exactly ${KEY_LENGTH} bytes`);
  }

  const payload: EnvelopeEncrypted = JSON.parse(encryptedPayload);

  // 1. Decrypt DEK using Master Key
  const dekIv = Buffer.from(payload.dekIv, "base64");
  const dekTag = Buffer.from(payload.dekTag, "base64");
  const encryptedDek = Buffer.from(payload.encryptedDek, "base64");

  const dekDecipher = crypto.createDecipheriv(ALGORITHM, masterKey, dekIv);
  dekDecipher.setAuthTag(dekTag);
  const dek = Buffer.concat([
    dekDecipher.update(encryptedDek),
    dekDecipher.final(),
  ]);

  // 2. Decrypt ciphertext using DEK
  const dataIv = Buffer.from(payload.iv, "base64");
  const dataTag = Buffer.from(payload.tag, "base64");
  const ciphertext = Buffer.from(payload.ciphertext, "base64");

  const dataDecipher = crypto.createDecipheriv(ALGORITHM, dek, dataIv);
  dataDecipher.setAuthTag(dataTag);
  const plaintext = Buffer.concat([
    dataDecipher.update(ciphertext),
    dataDecipher.final(),
  ]);

  return plaintext.toString("utf-8");
}

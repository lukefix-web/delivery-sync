import crypto from "node:crypto";

// AES-256-GCM encryption for secrets stored in the database.
// Key: 32 random bytes, base64 encoded, in env DELIVERY_SYNC_ENCRYPTION_KEY.
// The key is never stored in the database.
//
// Stored format: v1:<iv base64>:<auth tag base64>:<ciphertext base64>
// The "v1" prefix allows key rotation later.

const VERSION = "v1";
const IV_LENGTH = 12;

function getKey() {
  const raw = process.env.DELIVERY_SYNC_ENCRYPTION_KEY;

  if (!raw) {
    throw new Error("DELIVERY_SYNC_ENCRYPTION_KEY is not set");
  }

  const key = Buffer.from(raw, "base64");

  if (key.length !== 32) {
    throw new Error("DELIVERY_SYNC_ENCRYPTION_KEY must be 32 bytes (base64)");
  }

  return key;
}

export function encryptSecret(plaintext) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(String(plaintext), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

export function decryptSecret(payload) {
  const [version, iv, tag, ciphertext] = String(payload).split(":");

  if (version !== VERSION || !iv || !tag || !ciphertext) {
    throw new Error("Unsupported encrypted secret format");
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getKey(),
    Buffer.from(iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

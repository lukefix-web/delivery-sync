import db from "../db.server";
import { decryptSecret, encryptSecret } from "./crypto.server";

// Every tenant lookup goes through the shop domain from the authenticated
// Shopify session — never from form data or query parameters.

export async function getOrCreateShop(shopDomain) {
  return db.shop.upsert({
    where: { shopDomain },
    update: { isActive: true, uninstalledAt: null },
    create: { shopDomain },
  });
}

// Status only — no secrets, safe to return to the browser.
export async function getDhlCredentialStatus(shopId) {
  const credential = await db.dhlCredential.findUnique({
    where: { shopId },
    select: {
      lastTestedAt: true,
      lastTestOk: true,
      lastTestMessage: true,
      updatedAt: true,
    },
  });

  return credential
    ? { configured: true, ...credential }
    : { configured: false };
}

// Server-side only (DHL requests). Never return this to the browser.
export async function getDhlCredentials(shopId) {
  const credential = await db.dhlCredential.findUnique({ where: { shopId } });

  if (!credential) return null;

  return {
    apiKey: decryptSecret(credential.apiKeyEnc),
    apiSecret: decryptSecret(credential.apiSecretEnc),
    trackingUsername: decryptSecret(credential.trackingUsernameEnc),
    trackingPassword: decryptSecret(credential.trackingPasswordEnc),
  };
}

export async function saveDhlCredentials(shopId, credentials, testResult) {
  const data = {
    apiKeyEnc: encryptSecret(credentials.apiKey),
    apiSecretEnc: encryptSecret(credentials.apiSecret),
    trackingUsernameEnc: encryptSecret(credentials.trackingUsername),
    trackingPasswordEnc: encryptSecret(credentials.trackingPassword),
    lastTestedAt: new Date(),
    lastTestOk: testResult.ok,
    lastTestMessage: testResult.message,
  };

  await db.dhlCredential.upsert({
    where: { shopId },
    update: data,
    create: { shopId, ...data },
  });
}

export async function recordDhlTest(shopId, testResult) {
  await db.dhlCredential.updateMany({
    where: { shopId },
    data: {
      lastTestedAt: new Date(),
      lastTestOk: testResult.ok,
      lastTestMessage: testResult.message,
    },
  });
}

export async function deleteDhlCredentials(shopId) {
  await db.dhlCredential.deleteMany({ where: { shopId } });
}

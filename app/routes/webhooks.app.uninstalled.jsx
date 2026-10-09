import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already
  // been uninstalled, so every step here must be idempotent.

  // Invalidate Shopify tokens.
  await db.session.deleteMany({ where: { shop } });

  // Deactivate the shop and drop its DHL secrets right away. Shipments are
  // kept until Shopify sends shop/redact (48 hours later), see
  // webhooks.compliance.jsx.
  const existing = await db.shop.findUnique({ where: { shopDomain: shop } });
  if (existing) {
    await db.shop.update({
      where: { id: existing.id },
      data: { isActive: false, uninstalledAt: new Date() },
    });
    await db.dhlCredential.deleteMany({ where: { shopId: existing.id } });
    await db.syncState.updateMany({
      where: { shopId: existing.id },
      data: { lockedUntil: null },
    });
  }

  return new Response();
};

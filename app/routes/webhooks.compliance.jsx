import { authenticate } from "../shopify.server";
import db from "../db.server";

// Mandatory privacy webhooks for public apps.
// Delivery Sync stores no customer data (no names, addresses, emails),
// only order/fulfillment IDs, order names and tracking numbers.
export const action = async ({ request }) => {
  // Verifies the HMAC; invalid requests are rejected with 401.
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const existing = await db.shop.findUnique({ where: { shopDomain: shop } });

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST":
      // Nothing customer-related is stored, so there is nothing to export.
      break;

    case "CUSTOMERS_REDACT": {
      const orderIds = (payload.orders_to_redact || []).map(
        (id) => `gid://shopify/Order/${id}`,
      );
      if (existing && orderIds.length) {
        await db.shipment.deleteMany({
          where: { shopId: existing.id, shopifyOrderId: { in: orderIds } },
        });
      }
      break;
    }

    case "SHOP_REDACT":
      // Deletes the shop and, via cascade, all its shipments, logs, sync
      // state and DHL credentials.
      if (existing) {
        await db.shop.delete({ where: { id: existing.id } });
      }
      await db.session.deleteMany({ where: { shop } });
      break;

    default:
      return new Response("Unhandled webhook topic", { status: 404 });
  }

  return new Response();
};

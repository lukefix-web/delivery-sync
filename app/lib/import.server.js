import db from "../db.server";

const FIRST_IMPORT_DAYS = 30;
const IMPORT_OVERLAP_MS = 60 * 60 * 1000;
const PAGE_SIZE = 50;
const MAX_PAGES = 40;

const ORDERS_QUERY = `#graphql
  query DeliverySyncOrders($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, query: $query, sortKey: UPDATED_AT) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        name
        updatedAt
        fulfillments(first: 20) {
          id
          status
          displayStatus
          deliveredAt
          trackingInfo(first: 10) {
            number
            company
            url
          }
        }
      }
    }
  }
`;

// Only DHL Paket (Parcel DE). DHL Express and DHL eCommerce (US/Asia) use
// other tracking systems and are excluded.
export function isDhlParcel({ company, url }) {
  const name = String(company || "").toLowerCase();
  const link = String(url || "").toLowerCase();

  if (/express|ecommerce|e-commerce|asia|global mail/.test(name)) return false;
  if (link.includes("express")) return false;
  if (/\bdhl\b|deutsche post/.test(name)) return true;

  // No carrier name, but a DHL Germany tracking link.
  return !name && /(^|\.)dhl\.de\//.test(link.replace(/^https?:\/\//, ""));
}

export function normalizeTrackingNumber(number) {
  return String(number || "").replace(/\s+/g, "").toUpperCase();
}

async function upsertFulfillment(shopId, order, fulfillment) {
  if (fulfillment.status === "CANCELLED") {
    await db.shipment.deleteMany({
      where: { shopId, shopifyFulfillmentId: fulfillment.id },
    });
    return 0;
  }

  const parcels = new Map();
  for (const info of fulfillment.trackingInfo) {
    const trackingNumber = normalizeTrackingNumber(info.number);
    if (trackingNumber && isDhlParcel(info)) {
      parcels.set(trackingNumber, info.company || null);
    }
  }

  // Tracking number changed or removed in Shopify: drop stale open rows.
  await db.shipment.deleteMany({
    where: {
      shopId,
      shopifyFulfillmentId: fulfillment.id,
      shopifyDelivered: false,
      trackingNumber: { notIn: [...parcels.keys()] },
    },
  });

  const alreadyDelivered = fulfillment.displayStatus === "DELIVERED";

  for (const [trackingNumber, trackingCompany] of parcels) {
    const shared = {
      shopifyOrderName: order.name,
      trackingCompany,
      shopifyFulfillmentStatus: fulfillment.displayStatus,
      ...(alreadyDelivered
        ? {
            shopifyDelivered: true,
            shopifyDeliveredAt: fulfillment.deliveredAt
              ? new Date(fulfillment.deliveredAt)
              : new Date(),
            nextCheckAt: null,
            lastError: null,
          }
        : {}),
    };

    await db.shipment.upsert({
      where: {
        shopId_shopifyFulfillmentId_trackingNumber: {
          shopId,
          shopifyFulfillmentId: fulfillment.id,
          trackingNumber,
        },
      },
      update: shared,
      create: {
        shopId,
        shopifyFulfillmentId: fulfillment.id,
        shopifyOrderId: order.id,
        trackingNumber,
        nextCheckAt: alreadyDelivered ? null : new Date(),
        ...shared,
      },
    });
  }

  return parcels.size;
}

/**
 * Imports DHL parcels from Shopify fulfillments of orders updated since the
 * last import (first run: last 30 days).
 */
export async function importFulfillments(admin, shop) {
  const state = await db.syncState.upsert({
    where: { shopId: shop.id },
    update: {},
    create: { shopId: shop.id },
  });

  const startedAt = new Date();
  const since = state.lastImportAt
    ? new Date(state.lastImportAt.getTime() - IMPORT_OVERLAP_MS)
    : new Date(Date.now() - FIRST_IMPORT_DAYS * 24 * 60 * 60 * 1000);

  let after = null;
  let lastOrderUpdatedAt = null;
  let orders = 0;
  let parcels = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const response = await admin.graphql(ORDERS_QUERY, {
      variables: {
        first: PAGE_SIZE,
        after,
        query: `updated_at:>='${since.toISOString()}'`,
      },
    });
    const json = await response.json();

    if (json.errors?.length) {
      throw new Error(`Shopify Import Fehler: ${json.errors[0].message}`);
    }

    const connection = json.data.orders;

    for (const order of connection.nodes) {
      orders++;
      lastOrderUpdatedAt = order.updatedAt;
      for (const fulfillment of order.fulfillments) {
        parcels += await upsertFulfillment(shop.id, order, fulfillment);
      }
    }

    if (!connection.pageInfo.hasNextPage) {
      await db.syncState.update({
        where: { shopId: shop.id },
        data: { lastImportAt: startedAt },
      });
      return { orders, parcels, complete: true };
    }

    after = connection.pageInfo.endCursor;
  }

  // Page limit reached: continue from the last processed order next run.
  // Orders are sorted by updated_at ascending.
  await db.syncState.update({
    where: { shopId: shop.id },
    data: { lastImportAt: new Date(lastOrderUpdatedAt) },
  });
  return { orders, parcels, complete: false };
}

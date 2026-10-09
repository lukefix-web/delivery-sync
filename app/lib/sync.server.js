import db from "../db.server";
import { fetchDhlPieceStatus } from "./dhl.server";
import { importFulfillments } from "./import.server";
import { getDhlCredentials } from "./shop.server";

const HOUR_MS = 60 * 60 * 1000;
const MAX_CHECKS_PER_RUN = 300;
const MAX_SHIPMENT_AGE_DAYS = 60;
const MAX_SHOPIFY_RETRIES = 10;
const LOCK_MS = 15 * 60 * 1000;
const LOG_RETENTION_DAYS = 30;

const FULFILLMENT_QUERY = `#graphql
  query DeliverySyncFulfillment($id: ID!) {
    fulfillment(id: $id) {
      id
      status
      displayStatus
      deliveredAt
    }
  }
`;

const DELIVERED_MUTATION = `#graphql
  mutation DeliverySyncDelivered($fulfillmentEvent: FulfillmentEventInput!) {
    fulfillmentEventCreate(fulfillmentEvent: $fulfillmentEvent) {
      fulfillmentEvent {
        id
        status
        happenedAt
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export async function writeLog(shopId, level, message) {
  await db.appLog.create({ data: { shopId, level, message } });
}

function retryDelayMs(retryCount) {
  return Math.min(2 ** retryCount, 24) * HOUR_MS;
}

class DhlAuthError extends Error {}

async function checkShipmentAtDhl(credentials, shipment) {
  const now = new Date();
  const ageDays = (now - shipment.createdAt) / (24 * HOUR_MS);
  const result = await fetchDhlPieceStatus(credentials, shipment.trackingNumber);

  if (!result.ok) {
    if (result.httpStatus === 401 || result.httpStatus === 403) {
      throw new DhlAuthError(result.message);
    }

    await db.shipment.update({
      where: { id: shipment.id },
      data: {
        lastCheckedAt: now,
        lastError: result.message,
        retryCount: { increment: 1 },
        nextCheckAt: new Date(now.getTime() + retryDelayMs(shipment.retryCount + 1)),
      },
    });
    return "error";
  }

  const dhl = result.shipment;
  const unknown = dhl.errorStatus && dhl.errorStatus !== "0";

  const data = {
    lastCheckedAt: now,
    dhlStatus: dhl.status,
    dhlStatusCode: dhl.statusCode,
  };

  if (dhl.delivered) {
    // happenedAt must not lie in the future.
    const deliveredAt = dhl.statusAt && dhl.statusAt < now ? dhl.statusAt : now;
    Object.assign(data, {
      dhlDelivered: true,
      dhlDeliveredAt: deliveredAt,
      nextCheckAt: null,
      lastError: null,
      retryCount: 0,
    });
  } else if (ageDays > MAX_SHIPMENT_AGE_DAYS) {
    Object.assign(data, {
      nextCheckAt: null,
      lastError: `Keine Zustellung nach ${MAX_SHIPMENT_AGE_DAYS} Tagen, Prüfung beendet.`,
    });
  } else if (unknown) {
    Object.assign(data, {
      lastError: `DHL kennt diese Sendung (noch) nicht (error-status ${dhl.errorStatus}).`,
      retryCount: { increment: 1 },
      nextCheckAt: new Date(now.getTime() + retryDelayMs(shipment.retryCount + 1)),
    });
  } else {
    Object.assign(data, {
      lastError: null,
      retryCount: 0,
      nextCheckAt: new Date(now.getTime() + HOUR_MS),
    });
  }

  await db.shipment.update({ where: { id: shipment.id }, data });

  if (dhl.delivered) return "delivered";
  return unknown ? "error" : "pending";
}

async function markFulfillmentDelivered(admin, shopId, fulfillmentId) {
  const rows = await db.shipment.findMany({
    where: { shopId, shopifyFulfillmentId: fulfillmentId },
  });

  // Several parcels in one fulfillment: wait until DHL delivered all of them.
  if (rows.some((row) => !row.dhlDelivered)) return "waiting";

  const markRows = (data) =>
    db.shipment.updateMany({
      where: { shopId, shopifyFulfillmentId: fulfillmentId },
      data,
    });

  const statusResponse = await admin.graphql(FULFILLMENT_QUERY, {
    variables: { id: fulfillmentId },
  });
  const fulfillment = (await statusResponse.json()).data?.fulfillment;

  if (!fulfillment || fulfillment.status === "CANCELLED") {
    await markRows({
      lastError: "Fulfillment in Shopify nicht gefunden oder storniert.",
      retryCount: MAX_SHOPIFY_RETRIES,
    });
    return "error";
  }

  // Already delivered in Shopify: no new event.
  if (fulfillment.displayStatus === "DELIVERED") {
    await markRows({
      shopifyDelivered: true,
      shopifyDeliveredAt: fulfillment.deliveredAt
        ? new Date(fulfillment.deliveredAt)
        : new Date(),
      shopifyFulfillmentStatus: "DELIVERED",
      lastError: null,
    });
    return "already";
  }

  const happenedAt = new Date(
    Math.max(...rows.map((row) => row.dhlDeliveredAt?.getTime() ?? Date.now())),
  );

  const response = await admin.graphql(DELIVERED_MUTATION, {
    variables: {
      fulfillmentEvent: {
        fulfillmentId,
        status: "DELIVERED",
        happenedAt: happenedAt.toISOString(),
      },
    },
  });
  const json = await response.json();
  const userErrors = json.data?.fulfillmentEventCreate?.userErrors ?? [];
  const error = json.errors?.[0]?.message ?? userErrors[0]?.message;

  if (error) {
    await db.shipment.updateMany({
      where: { shopId, shopifyFulfillmentId: fulfillmentId },
      data: {
        lastError: `Shopify: ${error}`,
        retryCount: { increment: 1 },
      },
    });
    return "error";
  }

  await markRows({
    shopifyDelivered: true,
    shopifyDeliveredAt: new Date(),
    shopifyFulfillmentStatus: "DELIVERED",
    lastError: null,
    retryCount: 0,
  });
  return "marked";
}

async function syncShipments(admin, shop, credentials) {
  const stats = { checked: 0, dhlDelivered: 0, shopifyMarked: 0, errors: 0 };

  const due = await db.shipment.findMany({
    where: {
      shopId: shop.id,
      shopifyDelivered: false,
      dhlDelivered: false,
      nextCheckAt: { lte: new Date() },
    },
    orderBy: { nextCheckAt: "asc" },
    take: MAX_CHECKS_PER_RUN,
  });

  for (const shipment of due) {
    const outcome = await checkShipmentAtDhl(credentials, shipment);
    stats.checked++;
    if (outcome === "delivered") stats.dhlDelivered++;
    if (outcome === "error") stats.errors++;
  }

  const toMark = await db.shipment.findMany({
    where: {
      shopId: shop.id,
      dhlDelivered: true,
      shopifyDelivered: false,
      retryCount: { lt: MAX_SHOPIFY_RETRIES },
    },
    distinct: ["shopifyFulfillmentId"],
    select: { shopifyFulfillmentId: true },
  });

  for (const { shopifyFulfillmentId } of toMark) {
    const outcome = await markFulfillmentDelivered(admin, shop.id, shopifyFulfillmentId);
    if (outcome === "marked") stats.shopifyMarked++;
    if (outcome === "error") stats.errors++;
  }

  return stats;
}

async function acquireLock(shopId) {
  await db.syncState.upsert({
    where: { shopId },
    update: {},
    create: { shopId },
  });

  const now = new Date();
  const { count } = await db.syncState.updateMany({
    where: {
      shopId,
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
    },
    data: { lockedUntil: new Date(now.getTime() + LOCK_MS) },
  });

  return count === 1;
}

/**
 * Full run for one shop: import fulfillments, check DHL, mark delivered.
 * `admin` is an authenticated Admin API client for exactly this shop.
 */
export async function runShopSync(admin, shop) {
  if (!(await acquireLock(shop.id))) {
    return { ok: false, message: "Ein Sync läuft bereits." };
  }

  let result;

  try {
    const credentials = await getDhlCredentials(shop.id);
    if (!credentials) {
      result = { ok: false, message: "DHL Zugangsdaten fehlen." };
    } else {
      const imported = await importFulfillments(admin, shop);
      const stats = await syncShipments(admin, shop, credentials);
      result = {
        ok: true,
        message:
          `${imported.parcels} DHL Sendungen aus ${imported.orders} Bestellungen importiert, ` +
          `${stats.checked} bei DHL geprüft, ${stats.dhlDelivered} zugestellt, ` +
          `${stats.shopifyMarked} in Shopify als Delivered markiert, ${stats.errors} Fehler.`,
      };
    }
  } catch (error) {
    result = {
      ok: false,
      message:
        error instanceof DhlAuthError
          ? `${error.message} Sync abgebrochen.`
          : `Sync Fehler: ${error instanceof Error ? error.message : "Unbekannt"}`,
    };
  }

  await db.syncState.update({
    where: { shopId: shop.id },
    data: {
      lastSyncAt: new Date(),
      lastSyncOk: result.ok,
      lastSyncMessage: result.message,
      lockedUntil: null,
    },
  });
  await writeLog(shop.id, result.ok ? "info" : "error", result.message);

  return result;
}

export async function pruneLogs() {
  await db.appLog.deleteMany({
    where: {
      createdAt: { lt: new Date(Date.now() - LOG_RETENTION_DAYS * 24 * HOUR_MS) },
    },
  });
}

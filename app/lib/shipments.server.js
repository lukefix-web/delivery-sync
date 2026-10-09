import db from "../db.server";

// All queries are scoped to one shopId (tenant isolation).

const FILTERS = {
  all: {},
  pending: { shopifyDelivered: false, lastError: null },
  delivered: { shopifyDelivered: true },
  errors: { shopifyDelivered: false, NOT: { lastError: null } },
};

const SHIPMENT_FILTERS = Object.keys(FILTERS);

export async function getShipmentStats(shopId) {
  const [total, pending, delivered, errors] = await Promise.all(
    SHIPMENT_FILTERS.map((filter) =>
      db.shipment.count({ where: { shopId, ...FILTERS[filter] } }),
    ),
  );

  return { total, pending, delivered, errors };
}

function serialize(shipment) {
  return {
    id: shipment.id,
    orderName: shipment.shopifyOrderName,
    orderId: shipment.shopifyOrderId.split("/").pop(),
    trackingNumber: shipment.trackingNumber,
    dhlStatus: shipment.dhlStatus,
    dhlDelivered: shipment.dhlDelivered,
    shopifyDelivered: shipment.shopifyDelivered,
    shopifyStatus: shipment.shopifyFulfillmentStatus,
    lastCheckedAt: shipment.lastCheckedAt?.toISOString() ?? null,
    lastError: shipment.lastError,
  };
}

export async function listShipments(shopId, { filter = "all", page = 1, pageSize = 50 } = {}) {
  const where = { shopId, ...(FILTERS[filter] ?? FILTERS.all) };

  const [count, rows] = await Promise.all([
    db.shipment.count({ where }),
    db.shipment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    shipments: rows.map(serialize),
    page,
    pageCount: Math.max(1, Math.ceil(count / pageSize)),
    count,
  };
}

export async function getSyncState(shopId) {
  const state = await db.syncState.findUnique({ where: { shopId } });

  return {
    lastSyncAt: state?.lastSyncAt?.toISOString() ?? null,
    lastSyncOk: state?.lastSyncOk ?? null,
    lastSyncMessage: state?.lastSyncMessage ?? null,
  };
}

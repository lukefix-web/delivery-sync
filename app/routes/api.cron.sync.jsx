/* eslint-env node */
import crypto from "node:crypto";
import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { pruneLogs, runShopSync, writeLog } from "../lib/sync.server";

// Hourly background sync for all active shops.
// Called by an external scheduler (e.g. Render Cron Job):
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/sync

function isAuthorized(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get("Authorization") || "");

  return (
    expected.length === received.length &&
    crypto.timingSafeEqual(expected, received)
  );
}

export const loader = () => new Response("Method Not Allowed", { status: 405 });

export const action = async ({ request }) => {
  if (request.method !== "POST" || !isAuthorized(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const shops = await db.shop.findMany({
    where: { isActive: true, dhlCredential: { isNot: null } },
  });

  const summary = { shops: shops.length, ok: 0, failed: 0 };

  for (const shop of shops) {
    try {
      // Offline token of exactly this shop; refreshed automatically if expired.
      const { admin } = await unauthenticated.admin(shop.shopDomain);
      const result = await runShopSync(admin, shop);
      summary[result.ok ? "ok" : "failed"]++;
    } catch (error) {
      summary.failed++;
      await writeLog(
        shop.id,
        "error",
        `Hintergrund-Sync fehlgeschlagen: ${error instanceof Error ? error.message : "Unbekannt"}`,
      );
    }
  }

  await pruneLogs();

  return Response.json(summary);
};

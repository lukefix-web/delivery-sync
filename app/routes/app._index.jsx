import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getDhlCredentialStatus, getOrCreateShop } from "../lib/shop.server";
import { getShipmentStats, getSyncState, listShipments } from "../lib/shipments.server";
import { runShopSync } from "../lib/sync.server";
import { ShipmentTable } from "../components/ShipmentTable";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);

  const response = await admin.graphql(
    `#graphql
      query DeliverySyncShop {
        shop {
          name
          myshopifyDomain
        }
      }
    `,
  );
  const responseJson = await response.json();

  const [stats, credentialStatus, syncState, recent] = await Promise.all([
    getShipmentStats(shop.id),
    getDhlCredentialStatus(shop.id),
    getSyncState(shop.id),
    listShipments(shop.id, { pageSize: 10 }),
  ]);

  return {
    shop: responseJson.data.shop,
    stats,
    dhlConfigured: credentialStatus.configured,
    dhlConnected: credentialStatus.configured && credentialStatus.lastTestOk === true,
    syncState,
    recentShipments: recent.shipments,
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);

  return runShopSync(admin, shop);
};

function StatCard({ label, value, description }) {
  return (
    <div
      style={{
        border: "1px solid #e1e3e5",
        borderRadius: "12px",
        padding: "18px",
        background: "#ffffff",
        minHeight: "110px",
      }}
    >
      <div style={{ fontSize: "13px", color: "#616161", marginBottom: "8px" }}>
        {label}
      </div>
      <div style={{ fontSize: "28px", fontWeight: 650, lineHeight: 1.2, marginBottom: "8px" }}>
        {value}
      </div>
      <div style={{ fontSize: "13px", color: "#616161" }}>{description}</div>
    </div>
  );
}

function StatusRow({ label, value, good = false }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: "16px",
        padding: "12px 0",
        borderBottom: "1px solid #ebebeb",
      }}
    >
      <span>{label}</span>
      <span style={{ fontWeight: 600, color: good ? "#008060" : "#8a6116" }}>{value}</span>
    </div>
  );
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString("de-DE") : null;
}

export default function Index() {
  const { shop, stats, dhlConfigured, dhlConnected, syncState, recentShipments } =
    useLoaderData();
  const syncResult = useActionData();
  const navigation = useNavigation();
  const isSyncing = navigation.state === "submitting";
  const lastSync = formatDate(syncState.lastSyncAt);

  let dhlLabel = "Noch nicht eingerichtet";
  if (dhlConnected) dhlLabel = "Verbunden";
  else if (dhlConfigured) dhlLabel = "Gespeichert, letzter Test fehlgeschlagen";

  return (
    <s-page heading="Delivery Sync">
      <s-section>
        <s-heading>DHL Delivery Sync</s-heading>
        <s-paragraph>
          Automatische Synchronisierung des DHL Zustellstatus mit Shopify.
          Sobald DHL eine erfolgreiche Zustellung bestätigt, wird das
          zugehörige Shopify Fulfillment als Delivered markiert. Der Abgleich
          läuft stündlich automatisch.
        </s-paragraph>

        <Form method="post" style={{ marginTop: "16px" }}>
          <button
            type="submit"
            disabled={isSyncing || !dhlConfigured}
            style={{
              padding: "10px 18px",
              border: 0,
              borderRadius: "8px",
              background: dhlConfigured ? "#303030" : "#b5b5b5",
              color: "#ffffff",
              fontWeight: 600,
              cursor: dhlConfigured ? "pointer" : "not-allowed",
            }}
          >
            {isSyncing ? "Synchronisiere..." : "Jetzt synchronisieren"}
          </button>
        </Form>

        {syncResult && (
          <div
            style={{
              marginTop: "16px",
              padding: "12px 16px",
              borderRadius: "10px",
              background: syncResult.ok ? "#e3f1df" : "#fbeae5",
            }}
          >
            {syncResult.message}
          </div>
        )}
      </s-section>

      <s-section heading="Übersicht">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "16px",
          }}
        >
          <StatCard label="Sendungen gesamt" value={stats.total} description="Erfasste DHL Sendungen" />
          <StatCard label="Offen" value={stats.pending} description="Noch nicht zugestellt" />
          <StatCard label="Zugestellt" value={stats.delivered} description="In Shopify als Delivered" />
          <StatCard label="Fehler" value={stats.errors} description="Sendungen mit Sync Fehler" />
        </div>
      </s-section>

      <s-section heading="Verbindungen">
        <div>
          <StatusRow label="Shopify" value={`Verbunden · ${shop.name}`} good={true} />
          <StatusRow label="Shop Domain" value={shop.myshopifyDomain} good={true} />
          <StatusRow label="DHL Tracking API" value={dhlLabel} good={dhlConnected} />
          <StatusRow
            label="Letzter Sync"
            value={lastSync ? `${lastSync} · ${syncState.lastSyncOk ? "OK" : "Fehler"}` : "Noch kein Sync durchgeführt"}
            good={Boolean(lastSync) && syncState.lastSyncOk}
          />
        </div>

        {syncState.lastSyncMessage && (
          <s-paragraph>
            <span style={{ color: "#616161" }}>{syncState.lastSyncMessage}</span>
          </s-paragraph>
        )}
      </s-section>

      <s-section heading="Letzte Sendungen">
        <ShipmentTable
          shipments={recentShipments}
          emptyText="Noch keine Sendungen synchronisiert."
          showErrors={false}
        />
        <div style={{ marginTop: "12px" }}>
          <s-link href="/app/shipments">Alle Sendungen anzeigen</s-link>
        </div>
      </s-section>

      <s-section slot="aside" heading="Systemstatus">
        <s-paragraph>
          <strong>Shopify</strong>
          <br />
          Verbunden
        </s-paragraph>
        <s-paragraph>
          <strong>DHL</strong>
          <br />
          {dhlConnected ? "Verbunden" : "Einrichtung erforderlich"}
        </s-paragraph>
        <s-paragraph>
          <strong>Synchronisierung</strong>
          <br />
          {lastSync ? "Aktiv" : "Noch nicht gestartet"}
        </s-paragraph>
      </s-section>

      {!dhlConfigured && (
        <s-section slot="aside" heading="Nächster Schritt">
          <s-paragraph>
            DHL Zugangsdaten unter{" "}
            <s-link href="/app/settings">Einstellungen</s-link> hinterlegen und
            die Verbindung testen.
          </s-paragraph>
        </s-section>
      )}
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};

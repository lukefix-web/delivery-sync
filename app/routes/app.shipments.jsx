import { Link, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getOrCreateShop } from "../lib/shop.server";
import { listShipments } from "../lib/shipments.server";
import { ShipmentTable } from "../components/ShipmentTable";

const FILTER_LABELS = {
  all: "Alle",
  pending: "Offen",
  delivered: "Zugestellt",
  errors: "Fehler",
};
const SHIPMENT_FILTERS = Object.keys(FILTER_LABELS);

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);

  const url = new URL(request.url);
  const filter = SHIPMENT_FILTERS.includes(url.searchParams.get("filter"))
    ? url.searchParams.get("filter")
    : "all";
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1);

  return { filter, ...(await listShipments(shop.id, { filter, page })) };
};

function pageLink(filter, page) {
  return `?filter=${filter}&page=${page}`;
}

export default function Shipments() {
  const { shipments, filter, page, pageCount, count } = useLoaderData();

  const tabStyle = (active) => ({
    padding: "6px 14px",
    borderRadius: "8px",
    textDecoration: "none",
    color: "#303030",
    fontWeight: active ? 650 : 450,
    background: active ? "#e3e3e3" : "transparent",
  });

  return (
    <s-page heading="Sendungen">
      <s-section>
        <s-paragraph>
          Alle von Delivery Sync erkannten DHL Paket Sendungen ({count}).
          DHL Express wird nicht berücksichtigt.
        </s-paragraph>

        <div style={{ display: "flex", gap: "6px", margin: "16px 0", flexWrap: "wrap" }}>
          {SHIPMENT_FILTERS.map((key) => (
            <Link key={key} to={pageLink(key, 1)} style={tabStyle(key === filter)}>
              {FILTER_LABELS[key]}
            </Link>
          ))}
        </div>

        <ShipmentTable shipments={shipments} emptyText="Keine Sendungen vorhanden." />

        {pageCount > 1 && (
          <div style={{ display: "flex", gap: "12px", alignItems: "center", marginTop: "16px" }}>
            {page > 1 && <Link to={pageLink(filter, page - 1)}>← Zurück</Link>}
            <span>
              Seite {page} von {pageCount}
            </span>
            {page < pageCount && <Link to={pageLink(filter, page + 1)}>Weiter →</Link>}
          </div>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};

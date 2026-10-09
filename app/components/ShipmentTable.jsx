function formatDate(value) {
  return value ? new Date(value).toLocaleString("de-DE") : "–";
}

function ShopifyStatusBadge({ shipment }) {
  if (shipment.shopifyDelivered) return <s-badge tone="success">Delivered</s-badge>;
  if (shipment.lastError) return <s-badge tone="critical">Fehler</s-badge>;
  if (shipment.dhlDelivered) return <s-badge tone="info">Wird markiert</s-badge>;
  return <s-badge>Offen</s-badge>;
}

const cell = { padding: "12px", borderTop: "1px solid #ebebeb", verticalAlign: "top" };

export function ShipmentTable({ shipments, emptyText, showErrors = true }) {
  const columns = showErrors ? 6 : 5;

  return (
    <div style={{ border: "1px solid #e1e3e5", borderRadius: "12px", overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "750px" }}>
        <thead>
          <tr style={{ background: "#f7f7f7", textAlign: "left" }}>
            <th style={{ padding: "12px" }}>Bestellung</th>
            <th style={{ padding: "12px" }}>Trackingnummer</th>
            <th style={{ padding: "12px" }}>DHL Status</th>
            <th style={{ padding: "12px" }}>Shopify</th>
            <th style={{ padding: "12px" }}>Letzte Prüfung</th>
            {showErrors && <th style={{ padding: "12px" }}>Fehler</th>}
          </tr>
        </thead>
        <tbody>
          {shipments.length === 0 ? (
            <tr>
              <td colSpan={columns} style={{ padding: "28px 12px", textAlign: "center", color: "#616161" }}>
                {emptyText}
              </td>
            </tr>
          ) : (
            shipments.map((shipment) => (
              <tr key={shipment.id}>
                <td style={cell}>
                  <s-link href={`shopify://admin/orders/${shipment.orderId}`}>
                    {shipment.orderName}
                  </s-link>
                </td>
                <td style={{ ...cell, fontFamily: "monospace" }}>
                  <s-link
                    href={`https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode=${encodeURIComponent(shipment.trackingNumber)}`}
                    target="_blank"
                  >
                    {shipment.trackingNumber}
                  </s-link>
                </td>
                <td style={cell}>{shipment.dhlStatus ?? "Noch nicht geprüft"}</td>
                <td style={cell}>
                  <ShopifyStatusBadge shipment={shipment} />
                </td>
                <td style={cell}>{formatDate(shipment.lastCheckedAt)}</td>
                {showErrors && (
                  <td style={{ ...cell, color: "#8e1f0b", maxWidth: "260px" }}>
                    {shipment.lastError ?? ""}
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

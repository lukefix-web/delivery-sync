// DHL Parcel DE Tracking (Post & Parcel Germany), XML "get-status-for-public-user".
// Set DHL_TRACKING_ENDPOINT to the sandbox URL for testing:
// https://api-sandbox.dhl.com/parcel/de/tracking/v0/shipments

const DEFAULT_ENDPOINT =
  "https://api-eu.dhl.com/parcel/de/tracking/v0/shipments";

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

// Attribute name must start after whitespace, otherwise "status" would also
// match inside "error-status" (which DHL sends before "status").
function getXmlAttribute(xml, attribute) {
  const match = xml.match(new RegExp(`\\s${attribute}="([^"]*)"`, "i"));
  return match?.[1] ?? null;
}

function berlinOffsetMs(timestamp) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Berlin",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(timestamp));
  const get = (type) => Number(parts.find((part) => part.type === type).value);

  return (
    Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) -
    timestamp
  );
}

// DHL sends local German time, e.g. status-timestamp="09.10.2026 14:23".
export function parseDhlTimestamp(value) {
  const match = String(value || "").match(
    /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (!match) return null;

  const [day, month, year, hour, minute, second] = match
    .slice(1)
    .map((part) => Number(part ?? 0));
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let timestamp = asUtc - berlinOffsetMs(asUtc);
  timestamp = asUtc - berlinOffsetMs(timestamp);

  return new Date(timestamp);
}

/**
 * Queries the status of a single DHL piece.
 * credentials: { apiKey, apiSecret, trackingUsername, trackingPassword }
 *
 * Returns { ok: true, shipment } or { ok: false, httpStatus?, message }.
 * Never includes credentials in the result.
 */
export async function fetchDhlPieceStatus(credentials, trackingNumber) {
  const { apiKey, apiSecret, trackingUsername, trackingPassword } = credentials;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<req:RequestPieceStatus
  xmlns:req="http://dhl.de/webservice/cisbase"
  appname="${escapeXml(trackingUsername)}"
  password="${escapeXml(trackingPassword)}"
  request="get-status-for-public-user"
  language-code="de">
  <data piece-code="${escapeXml(trackingNumber)}"/>
</req:RequestPieceStatus>`;

  const url = new URL(process.env.DHL_TRACKING_ENDPOINT || DEFAULT_ENDPOINT);
  url.searchParams.set("xml", xml);

  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization:
          "Basic " + Buffer.from(`${apiKey}:${apiSecret}`).toString("base64"),
        "DHL-API-Key": apiKey,
        Accept: "application/xml",
      },
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    return {
      ok: false,
      message: `DHL nicht erreichbar: ${error instanceof Error ? error.message : "Unbekannter Fehler"}`,
    };
  }

  const responseText = await response.text();

  if (!response.ok) {
    return {
      ok: false,
      httpStatus: response.status,
      message:
        response.status === 401 || response.status === 403
          ? "DHL hat die Zugangsdaten abgelehnt (API Key / Secret prüfen)."
          : `DHL API Fehler ${response.status}`,
    };
  }

  const deliveryFlag = getXmlAttribute(responseText, "delivery-event-flag");

  return {
    ok: true,
    shipment: {
      trackingNumber,
      status: getXmlAttribute(responseText, "status"),
      delivered: deliveryFlag === "1",
      deliveryFlag,
      statusCode: getXmlAttribute(responseText, "standard-event-code"),
      statusAt: parseDhlTimestamp(getXmlAttribute(responseText, "status-timestamp")),
      ice: getXmlAttribute(responseText, "ice"),
      errorStatus: getXmlAttribute(responseText, "error-status"),
    },
  };
}

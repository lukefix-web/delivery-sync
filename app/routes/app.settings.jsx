import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { fetchDhlPieceStatus } from "../lib/dhl.server";
import {
  deleteDhlCredentials,
  getDhlCredentialStatus,
  getDhlCredentials,
  getOrCreateShop,
  recordDhlTest,
  saveDhlCredentials,
} from "../lib/shop.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);

  return { credentialStatus: await getDhlCredentialStatus(shop.id) };
};

function field(formData, name) {
  return String(formData.get(name) || "").trim();
}

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);

  const formData = await request.formData();
  const intent = field(formData, "intent");

  if (intent === "delete") {
    await deleteDhlCredentials(shop.id);
    return { ok: true, message: "DHL Zugangsdaten wurden gelöscht." };
  }

  const trackingNumber = field(formData, "trackingNumber");
  if (!trackingNumber) {
    return { ok: false, message: "Bitte eine Test Trackingnummer angeben." };
  }

  const stored = await getDhlCredentials(shop.id);

  if (intent === "test") {
    if (!stored) {
      return { ok: false, message: "Es sind noch keine Zugangsdaten gespeichert." };
    }

    const result = await fetchDhlPieceStatus(stored, trackingNumber);
    const message = result.ok ? "DHL Verbindung erfolgreich." : result.message;
    await recordDhlTest(shop.id, { ok: result.ok, message });

    return { ok: result.ok, message, shipment: result.shipment };
  }

  // intent === "save": empty fields keep the stored value.
  const credentials = {
    apiKey: field(formData, "apiKey") || stored?.apiKey || "",
    apiSecret: field(formData, "apiSecret") || stored?.apiSecret || "",
    trackingUsername:
      field(formData, "trackingUsername") || stored?.trackingUsername || "",
    trackingPassword:
      field(formData, "trackingPassword") || stored?.trackingPassword || "",
  };

  if (Object.values(credentials).some((value) => !value)) {
    return { ok: false, message: "Bitte alle Zugangsdaten ausfüllen." };
  }

  const result = await fetchDhlPieceStatus(credentials, trackingNumber);

  if (!result.ok) {
    // Credentials that DHL rejects are not stored.
    return {
      ok: false,
      message: `${result.message} Zugangsdaten wurden nicht gespeichert.`,
    };
  }

  const message = "DHL Verbindung erfolgreich. Zugangsdaten verschlüsselt gespeichert.";
  await saveDhlCredentials(shop.id, credentials, { ok: true, message });

  return { ok: true, message, shipment: result.shipment };
};

function formatDate(value) {
  return value ? new Date(value).toLocaleString("de-DE") : "–";
}

export default function Settings() {
  const { credentialStatus } = useLoaderData();
  const result = useActionData();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const submittingIntent = navigation.formData?.get("intent");
  const configured = credentialStatus.configured;

  const inputStyle = {
    width: "100%",
    padding: "10px 12px",
    border: "1px solid #8c9196",
    borderRadius: "8px",
    boxSizing: "border-box",
  };

  const buttonStyle = {
    padding: "10px 18px",
    border: 0,
    borderRadius: "8px",
    background: "#303030",
    color: "#ffffff",
    fontWeight: 600,
    cursor: "pointer",
  };

  const secondaryButtonStyle = {
    ...buttonStyle,
    background: "#ffffff",
    color: "#303030",
    border: "1px solid #8c9196",
  };

  const secretPlaceholder = configured ? "Gespeichert – leer lassen zum Beibehalten" : "";

  return (
    <s-page heading="Einstellungen">
      <s-section heading="DHL Parcel Tracking">
        <s-paragraph>
          Hinterlege deine DHL API Zugangsdaten. Beim Speichern wird die
          Verbindung mit einer vorhandenen DHL Trackingnummer getestet. Nur
          Zugangsdaten, die DHL akzeptiert, werden gespeichert.
        </s-paragraph>

        <Form method="post" autoComplete="off">
          <div style={{ display: "grid", gap: "18px", maxWidth: "650px", marginTop: "20px" }}>
            <label>
              <div style={{ marginBottom: "6px", fontWeight: 600 }}>DHL API Key</div>
              <input name="apiKey" type="password" autoComplete="off" required={!configured} placeholder={secretPlaceholder} style={inputStyle} />
            </label>

            <label>
              <div style={{ marginBottom: "6px", fontWeight: 600 }}>DHL API Secret</div>
              <input name="apiSecret" type="password" autoComplete="off" required={!configured} placeholder={secretPlaceholder} style={inputStyle} />
            </label>

            <label>
              <div style={{ marginBottom: "6px", fontWeight: 600 }}>DHL Tracking Benutzername</div>
              <input name="trackingUsername" type="password" autoComplete="off" required={!configured} placeholder={secretPlaceholder} style={inputStyle} />
            </label>

            <label>
              <div style={{ marginBottom: "6px", fontWeight: 600 }}>DHL Tracking Passwort</div>
              <input name="trackingPassword" type="password" autoComplete="new-password" required={!configured} placeholder={secretPlaceholder} style={inputStyle} />
            </label>

            <label>
              <div style={{ marginBottom: "6px", fontWeight: 600 }}>Test Trackingnummer</div>
              <input name="trackingNumber" type="text" required placeholder="0034..." style={inputStyle} />
            </label>

            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
              <button type="submit" name="intent" value="save" disabled={isSubmitting} style={buttonStyle}>
                {isSubmitting && submittingIntent === "save"
                  ? "Wird getestet und gespeichert..."
                  : "Testen und speichern"}
              </button>

              {configured && (
                <button type="submit" name="intent" value="test" disabled={isSubmitting} style={secondaryButtonStyle}>
                  {isSubmitting && submittingIntent === "test"
                    ? "Verbindung wird getestet..."
                    : "Gespeicherte Verbindung testen"}
                </button>
              )}
            </div>
          </div>
        </Form>
      </s-section>

      {result && (
        <s-section heading={result.ok ? "Erfolgreich" : "Fehlgeschlagen"}>
          <s-paragraph>{result.message}</s-paragraph>

          {result.shipment && (
            <div style={{ marginTop: "16px", padding: "16px", border: "1px solid #e1e3e5", borderRadius: "10px" }}>
              <p><strong>Trackingnummer:</strong> {result.shipment.trackingNumber}</p>
              <p><strong>DHL Status:</strong> {result.shipment.status || "Unbekannt"}</p>
              <p><strong>Zugestellt:</strong> {result.shipment.delivered ? "Ja" : "Nein"}</p>
              <p><strong>delivery-event-flag:</strong> {result.shipment.deliveryFlag ?? "nicht vorhanden"}</p>
              <p><strong>Statuscode:</strong> {result.shipment.statusCode ?? "nicht vorhanden"}</p>
              <p><strong>ICE:</strong> {result.shipment.ice ?? "nicht vorhanden"}</p>
              <p><strong>error-status:</strong> {result.shipment.errorStatus ?? "nicht vorhanden"}</p>
            </div>
          )}
        </s-section>
      )}

      <s-section slot="aside" heading="Status">
        <s-paragraph>
          <strong>DHL Zugangsdaten</strong>
          <br />
          {configured ? "Gespeichert (verschlüsselt)" : "Nicht eingerichtet"}
        </s-paragraph>

        {configured && (
          <>
            <s-paragraph>
              <strong>Letzter Test</strong>
              <br />
              {formatDate(credentialStatus.lastTestedAt)} ·{" "}
              {credentialStatus.lastTestOk ? "OK" : "Fehlgeschlagen"}
            </s-paragraph>

            <Form method="post">
              <button
                type="submit"
                name="intent"
                value="delete"
                disabled={isSubmitting}
                style={{ ...secondaryButtonStyle, color: "#8e1f0b" }}
              >
                Zugangsdaten löschen
              </button>
            </Form>
          </>
        )}
      </s-section>

      <s-section slot="aside" heading="Sicherheit">
        <s-paragraph>
          Zugangsdaten werden serverseitig mit AES-256-GCM verschlüsselt
          gespeichert und nie wieder an den Browser zurückgegeben.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};

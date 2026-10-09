# Delivery Sync – Betrieb

## Ablauf

Stündlich (Cron) und auf Knopfdruck im Dashboard pro Shop:

1. **Import** – Shopify Bestellungen, die seit dem letzten Import geändert wurden (erster Lauf: 30 Tage), werden gelesen. Aus den Fulfillments werden nur DHL Paket Trackingnummern übernommen (DHL Express / eCommerce ausgeschlossen, siehe `isDhlParcel` in `app/lib/import.server.js`). Stornierte Fulfillments werden entfernt, bereits in Shopify gelieferte nicht mehr geprüft.
2. **DHL Prüfung** – fällige Sendungen (`nextCheckAt`) werden bei DHL abgefragt. `delivery-event-flag="1"` = zugestellt, Zeitpunkt aus `status-timestamp` (deutsche Zeit).
3. **Shopify** – sind alle DHL Pakete eines Fulfillments zugestellt, wird der aktuelle Shopify Status geprüft und nur falls nötig `fulfillmentEventCreate(status: DELIVERED, happenedAt)` ausgeführt.

Fehler: Wiederholung mit Backoff (2, 4, 8 … max. 24 Std.). Nach 60 Tagen ohne Zustellung wird die Prüfung beendet. Bei abgelehnten DHL Zugangsdaten bricht der Lauf des Shops ab.

## Umgebungsvariablen

| Variable | Zweck |
|---|---|
| `DELIVERY_SYNC_ENCRYPTION_KEY` | 32 Byte, base64. Verschlüsselt DHL Zugangsdaten (AES-256-GCM). **Nie ändern ohne Migration** – sonst sind gespeicherte Zugangsdaten unlesbar. Production bekommt einen eigenen Schlüssel. |
| `CRON_SECRET` | Bearer Token für `POST /api/cron/sync`. |
| `DHL_TRACKING_ENDPOINT` | Optional. Für Tests: `https://api-sandbox.dhl.com/parcel/de/tracking/v0/shipments` |
| `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SCOPES` | Shopify (in Dev setzt die CLI diese automatisch). |

Schlüssel erzeugen:

```bash
node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))'
```

## Cron

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<app-domain>/api/cron/sync
```

einmal pro Stunde. Antwort: `{"shops":n,"ok":n,"failed":n}`.

## Datenschutz

Gespeichert werden nur Shopify IDs, Bestellnummer (#1001), Trackingnummer, Carrier-Name und Statuswerte – keine Namen, Adressen oder E-Mails. Die DHL Antwort enthält Empfängerdaten; davon wird nichts gespeichert.

- `app/uninstalled`: Sessions gelöscht, Shop deaktiviert, DHL Zugangsdaten sofort gelöscht.
- `customers/redact`: Sendungen der genannten Bestellungen gelöscht.
- `shop/redact`: Shop mit allen Daten gelöscht.
- `customers/data_request`: keine Kundendaten vorhanden.

## Production (offen)

Geplant: Node Hosting (z. B. Render oder Fly.io) + Postgres. Dafür in `prisma/schema.prisma` `provider = "postgresql"` und `url = env("DATABASE_URL")` setzen und die Migrationen für Postgres neu erzeugen.

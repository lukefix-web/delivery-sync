// Keep-alive / uptime check. Deliberately does not touch the database, so the
// pings that keep the web service awake let the Neon compute suspend.
export const loader = () =>
  Response.json({ ok: true, service: "delivery-sync" });

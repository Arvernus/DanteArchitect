# Dante Architect

## Hinweis: Umbenennen von Geräten & Subscriptions (Dante Controller Limit)
Der Dante Controller **passt Subscriptions NICHT automatisch an**, wenn Geräte umbenannt oder Presets mit geänderten Namen geladen werden.
Konsequenz: `<subscribed_device>` verweist sonst weiter auf den alten Namen. Audinate empfiehlt, Preset-XML direkt zu bearbeiten (alle Vorkommen: `<name>`, `<friendly_name>`, `<subscribed_device>`).

**Dante Architect** löst das: Dummy-Geräte → echte Gerätenamen mappen, Subscriptions automatisch anpassen, Preset exportieren – fertig.

## Optionaler Online-Scan (Helper)
Die Web-App ist vollständig offline nutzbar. Für Zuordnung *Preset ↔ Online* kann optional ein lokaler Helper (mDNS-Scan) genutzt werden.

- API: `GET /health` → `{ ok: true, name: "DaScan", version: "0.1" }`
- API: `GET /scan` → `[{ "name":"Device-1","ip":"192.168.1.10","manufacturer":"…" }, … ]`
- CORS: `Access-Control-Allow-Origin: *`

Die App erkennt den Helper automatisch (Backoff + Reconnect) – kein Neustart nötig.
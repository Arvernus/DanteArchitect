# Dante mDNS Helper in Python
# Start:
#   cd helper
#   python -m venv .venv
#   .venv/Scripts/activate   (Windows)  |  source .venv/bin/activate (macOS/Linux)
#   pip install -r requirements.txt
#   python server.py
#
# API:
#   GET /health
#   GET /scan?timeout=2000   (Timeout in ms, 500..10000)

from flask import Flask, jsonify, request
from flask_cors import CORS
from zeroconf import Zeroconf, ServiceBrowser, ServiceStateChange, ServiceInfo
import socket
import time

SERVICE_TYPES = [
    "_netaudio._udp.local.",
    "_dante._tcp.local.",
    "_netaudio-json._tcp.local."
]
import threading
import psutil
import os
from zeroconf import Zeroconf, ServiceBrowser, ServiceStateChange, ServiceInfo, IPVersion, InterfaceChoice



# Cache für schnelle Antworten + Status
DEVICES_CACHE = []
LAST_SCAN_TS = 0
_CACHE_LOCK = threading.Lock()
SELECTED_IFACES = None  # None = alle, sonst Liste von IPs

app = Flask(__name__)
CORS(app)

def _list_interfaces():
    """
    Liefert Liste aktiver Interfaces mit IPv4/IPv6 als Dicts
    und loggt sie beim Start sowie auf /ifaces.
    """
    res = []
    try:
        stats = psutil.net_if_stats()
        addrs = psutil.net_if_addrs()
        for name, st in stats.items():
            if not st.isup:
                continue
            ips_v4, ips_v6 = [], []
            for a in addrs.get(name, []):
                if a.family == socket.AF_INET and a.address:
                    ips_v4.append(a.address)
                elif a.family == socket.AF_INET6 and a.address:
                    # link-local %scope entfernen
                    ips_v6.append(a.address.split("%")[0])
            res.append({
                "name": name,
                "is_up": st.isup,
                "ipv4": ips_v4,
                "ipv6": ips_v6
            })
    except Exception as e:
        print("[IFACES] error:", e)
    return res

def _select_zeroconf_interfaces():
    """
    Bestimme, worauf Zeroconf bindet:
    - Env DANTE_IFACES: kommasepariert (Interface-Name oder IP)
      Beispiele: DANTE_IFACES=Ethernet,192.168.2.201
    - Standard: alle Interfaces (InterfaceChoice.All)
    """
    env = os.getenv("DANTE_IFACES", "").strip()
    if not env:
        print("[IFACES] using: ALL")
        return InterfaceChoice.All

    wanted = [x.strip() for x in env.split(",") if x.strip()]
    addrs = psutil.net_if_addrs()
    stats = psutil.net_if_stats()

    selected_ips = []

    for w in wanted:
        # 1) wenn es exakt eine IP ist, direkt übernehmen
        try:
            socket.inet_aton(w)  # IPv4?
            selected_ips.append(w)
            continue
        except OSError:
            pass
        try:
            socket.inet_pton(socket.AF_INET6, w)  # IPv6?
            selected_ips.append(w)
            continue
        except OSError:
            pass

        # 2) sonst als Interface-Name interpretieren
        if w in addrs and stats.get(w) and stats[w].isup:
            for a in addrs[w]:
                if a.family == socket.AF_INET and a.address:
                    selected_ips.append(a.address)
                elif a.family == socket.AF_INET6 and a.address:
                    selected_ips.append(a.address.split("%")[0])

    # Duplikate entfernen
    selected_ips = sorted(set(selected_ips))
    if selected_ips:
        print("[IFACES] using:", ", ".join(selected_ips))
        return selected_ips

    print("[IFACES] DANTE_IFACES gesetzt, aber nichts brauchbares gefunden → fallback ALL")
    return InterfaceChoice.All

def _current_ifaces_choice():
    global SELECTED_IFACES
    if SELECTED_IFACES and len(SELECTED_IFACES) > 0:
        return SELECTED_IFACES
    return InterfaceChoice.All

def _pick_ip_version(arg: str | None):
    v = (arg or "").lower()
    if v in ("4", "v4", "ipv4"):
        return IPVersion.V4Only
    if v in ("6", "v6", "ipv6"):
        return IPVersion.V6Only
    return IPVersion.All

def discover_service_types(timeout_ms=1500):
    """
    Durchsucht via _services._dns-sd._udp.local. alle verfügbaren Service-Typen.
    Rückgabe: Liste vollqualifizierter Servicenamen, z. B. "_netaudio._udp.local."
    """
    zc = Zeroconf(interfaces=_current_ifaces_choice(), ip_version=IPVersion.All)
    found = set()

    # Wichtig: Signatur MUSS die Keyword-Args annehmen (service_type, state_change)
    def on_change(zeroconf, service_type, name, state_change, **kwargs):
        if state_change in (ServiceStateChange.Added, ServiceStateChange.Updated):
            if name:
                # Beim Browse auf _services... ist "name" bereits der Service-Typ
                svc = name if name.endswith(".") else (name + ".")
                found.add(svc)

    browser = None
    try:
        browser = ServiceBrowser(zc, "_services._dns-sd._udp.local.", handlers=[on_change])
        time.sleep(max(0.3, timeout_ms / 1000.0))
    finally:
        if browser:
            try: browser.cancel()
            except Exception: pass
        try: zc.close()
        except Exception: pass

    return sorted(found)


def _iface_signature():
    """
    Liefert eine stabile Signatur aktiver Interfaces (Name, up, IPs),
    um Änderungen erkennen zu können.
    """
    sig = []
    try:
        stats = psutil.net_if_stats()
        addrs = psutil.net_if_addrs()
        for name, st in stats.items():
            if not st.isup:
                continue
            ips = []
            for a in addrs.get(name, []):
                if a.family in (socket.AF_INET, socket.AF_INET6) and a.address:
                    ips.append(a.address)
            ips.sort()
            sig.append((name, st.isup, tuple(ips)))
    except Exception:
        pass
    sig.sort()
    return tuple(sig)

def _update_cache(devices, ts):
    global DEVICES_CACHE, LAST_SCAN_TS
    with _CACHE_LOCK:
        DEVICES_CACHE = list(devices)
        LAST_SCAN_TS = int(ts)

def do_scan(timeout_ms=2000):
    devices = scan_mdns(timeout_ms)
    ts = int(time.time() * 1000)
    _update_cache(devices, ts)
    return devices, ts

def _decode_props(props: dict) -> dict:
    out = {}
    for k, v in (props or {}).items():
        try:
            ks = k.decode("utf-8", errors="ignore") if isinstance(k, (bytes, bytearray)) else str(k)
            vs = v.decode("utf-8", errors="ignore") if isinstance(v, (bytes, bytearray)) else str(v)
            out[ks] = vs
        except Exception:
            pass
    return out

class _Collector:
    def __init__(self, zc: Zeroconf):
        self.zc = zc
        self.items = {}  # key: fullname -> dict

    def add_or_update(self, fullname: str, info: ServiceInfo | None):
        if fullname not in self.items:
            self.items[fullname] = {"fqdn": fullname, "name": "", "ip": "", "host": "", "port": 0,
                                    "manufacturer": "", "model": "", "_props": {}}
        d = self.items[fullname]
        if info:
            d["host"] = (info.server or "").rstrip(".")
            d["port"] = info.port or 0
            # name vor "._" als Geräteanzeige
            if not d["name"]:
                base = fullname.split("._", 1)[0]
                d["name"] = base
            # IP auflösen
            ip = ""
            try:
                # bevorzugt IPv4 aus addresses
                if info.addresses:
                    for addr in info.addresses:
                        if len(addr) == 4:  # IPv4
                            ip = socket.inet_ntoa(addr)
                            break
                    if not ip:  # evtl. nur IPv6
                        ip = socket.inet_ntop(socket.AF_INET6, info.addresses[0])
            except Exception:
                pass
            d["ip"] = d["ip"] or ip
            # TXT Properties
            props = _decode_props(info.properties or {})
            d["_props"] |= props
            d["manufacturer"] = d["manufacturer"] or props.get("manufacturer") or props.get("vendor") or props.get("mfgr") or ""
            d["model"] = d["model"] or props.get("model") or props.get("product") or ""
            d["name"] = d["name"] or props.get("name") or d["name"]

def scan_mdns(timeout_ms = 2000, ipver: IPVersion = IPVersion.All, service_types = None):
    zc = Zeroconf(interfaces=_current_ifaces_choice(), ip_version=ipver)
    types = service_types if service_types else SERVICE_TYPES
    if not types:
        # Fallback: auto-discover und nach Dante filtern
        types = [t for t in discover_service_types(800) if ("netaudio" in t.lower() or "dante" in t.lower())]
        if not types:
            # letzter Fallback: bekannte Typen probieren
            types = ["_netaudio._udp.local.", "_dante._tcp.local.", "_netaudio-json._tcp.local."]
    collector = _Collector(zc)

    def on_service_change(zeroconf, service_type, name, state_change):
        if state_change in (ServiceStateChange.Added, ServiceStateChange.Updated):
            info = zeroconf.get_service_info(service_type, name, timeout=0)
            # Wenn nicht direkt vorhanden, kurz versuchen zu resolven
            if info is None:
                try:
                    info = ServiceInfo(type_=service_type, name=name)
                    info = zeroconf.get_service_info(service_type, name, timeout=500)
                except Exception:
                    info = None
            collector.add_or_update(name, info)

    # --- Start Browser pro Service-Typ ---
    browsers = []
    try:
        types = service_types if service_types else SERVICE_TYPES
        # Fallback, falls Liste leer: bekannte Dante-Typen
        if not types:
            types = ["_netaudio._udp.local.", "_dante._tcp.local.", "_netaudio-json._tcp.local."]

        # Alle Typen auf FQDN normieren
        types = [t if t.endswith(".") else (t + ".") for t in types]

        # Browser starten
        for st in types:
            browsers.append(ServiceBrowser(zc, st, handlers=[on_service_change]))

        # Geduld: mind. 2s oder timeout_ms, was größer ist
        wait_s = max(2.0, timeout_ms / 1000.0)
        time.sleep(wait_s)

        # Wenn noch immer nichts gefunden wurde: kurzer IPv4-Only Retry
        if not collector.items:
            try:
                zc_v4 = Zeroconf(interfaces=_current_ifaces_choice(), ip_version=IPVersion.V4Only)
                tmp = []
                for st in types:
                    tmp.append(ServiceBrowser(zc_v4, st, handlers=[on_service_change]))
                time.sleep(2.0)
            finally:
                for b in tmp:
                    try: b.cancel()
                    except: pass
                try: zc_v4.close()
                except: pass

    finally:
        for b in browsers:
            try: b.cancel()
            except Exception:
                pass
        try:
            zc.close()
        except Exception:
            pass

    lst = []
    for d in collector.items.values():
        lst.append({
            "name": d["name"] or d["fqdn"],
            "ip": d["ip"],
            "manufacturer": d["manufacturer"],
            "model": d["model"],
            "host": d["host"],
            "port": d["port"]
        })
    # stabil sortieren: Name, dann IP
    lst.sort(key=lambda x: (x.get("name") or "", x.get("ip") or ""))
    return lst

@app.get("/health")
def health():
    return jsonify({"ok": True, "serviceTypes": SERVICE_TYPES, "ts": int(time.time() * 1000)})

@app.get("/services")
def services():
    return jsonify({"ok": True, "services": discover_service_types(1500)})


@app.get("/scan")
def scan():
    try:
        timeout = int(request.args.get("timeout", "4000"))  # default 4s
    except ValueError:
        timeout = 4000
    ipver = _pick_ip_version(request.args.get("ipver")) or IPVersion.V4Only  # default V4Only
    raw = request.args.get("services")
    stypes = [s.strip() for s in raw.split(",")] if raw else None
    devices = scan_mdns(timeout, ipver=ipver, service_types=stypes)
    return jsonify({"ok": True, "devices": devices, "ts": int(time.time()*1000)})

@app.get("/latest")
def latest():
    with _CACHE_LOCK:
        return jsonify({"ok": True, "devices": DEVICES_CACHE, "ts": LAST_SCAN_TS})


# -- Kombinierte Route: /ifaces (GET: auflisten, POST: Auswahl setzen/Reset) --
@app.route("/ifaces", methods=["GET", "POST"])
def ifaces_route():
    global SELECTED_IFACES
    if request.method == "GET":
        return jsonify({"ok": True, "interfaces": _list_interfaces(), "selected": SELECTED_IFACES})

    # POST: Auswahl setzen ({"ips": ["<ip>"]}) oder Reset (leerer Body/ohne ips)
    data = request.get_json(silent=True) or {}
    sel = data.get("ips")
    if sel:
        SELECTED_IFACES = sel
        print("[IFACES] selected:", sel)
    else:
        SELECTED_IFACES = None
        print("[IFACES] reset to ALL")
    return jsonify({"ok": True, "selected": SELECTED_IFACES})

# -- Optional: Kompatibilität für bisherigen Frontend-Call /ifaces/select (POST) --
app.add_url_rule("/ifaces/select", view_func=ifaces_route, methods=["POST"], endpoint="ifaces_select")


if __name__ == "__main__":
    # 0.0.0.0:53535 → kompatibel zum Frontend

        # Hintergrund-Watcher: erkennt Interface-Änderungen & triggert Scans
    def watcher():
        sig_prev = None
        last_periodic = 0
        period_s = int(os.getenv("DANTE_SCAN_PERIOD", "5"))  # Periodic-Scan, default 30s
        while True:
            try:
                sig_now = _iface_signature()
                now = time.time()
                iface_changed = (sig_prev is None) or (sig_now != sig_prev)
                periodic_due = (now - last_periodic) >= period_s
                if iface_changed or periodic_due:
                    do_scan(2000)
                    sig_prev = sig_now
                    last_periodic = now
            except Exception:
                # Fehler im Watcher dürfen den Server nicht stoppen
                pass
            time.sleep(5)

    t = threading.Thread(target=watcher, name="iface-watcher", daemon=True)
    t.start()

    print("[IFACES] active interfaces:")
    for nic in _list_interfaces():
        print(f"  - {nic['name']}: IPv4={nic['ipv4']} IPv6={nic['ipv6']}")


    app.run(host="0.0.0.0", port=53535)

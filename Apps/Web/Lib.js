// Apps/Web/Lib.js
// Library v2 – XSD/XML-nahe Keys, modellabhängige model_params, device_defaults mit sinnvollen Defaults,
// Dedupe inkl. model_params, Wizard (Adopt), Sidebar, Device-XML-Builder.

window.DA_LIB = (function () {
  const LKEY = "DA_MODEL_LIBRARY_V2";

  // ===== Defaults =====
  const DEFAULTS = {
    manufacturer_name: "unknownSupplier",
    model_name: "unknownModel",
    name_pattern: "Device-xxxx-[n]",
    txLabelPrefix: "Ch",
    rxNamePrefix: "In",

    // device-defaults
    serial: "",
    mac: "",
    ipv4: "",
    dhcp: "true",             // als String, damit es 1:1 als XML-Text geschrieben werden kann
    location: "",
    firmware_version: "unknown",
    hardware_rev: "",         // device-spezifische Sicht
  };

  // device simple fields we emit (name is handled separately)
  const DEVICE_SIMPLE_FIELDS = [
    "serial",
    "mac",
    "ipv4",
    "dhcp",
    "location",
    "firmware_version",
    "hardware_rev",
  ];

  // ===== Storage =====
  function load() {
    try {
      const raw = localStorage.getItem(LKEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function save(list) {
    list.forEach(validateAndNormalize);
    list = dedupe(list);
    localStorage.setItem(LKEY, JSON.stringify(list || []));
  }

  function exportJson() {
    return JSON.stringify({ version: 2, models: load() }, null, 2);
  }

  function importJson(jsonText) {
    const parsed = JSON.parse(jsonText);
    let list = Array.isArray(parsed)
      ? parsed
      : parsed && Array.isArray(parsed.models)
      ? parsed.models
      : null;
    if (!list) throw new Error("Ungültiges JSON-Format für Model Library (v2).");

    list.forEach(validateAndNormalize);
    list = dedupe(list);

    const current = load();
    const combined = dedupe(current.concat(list));
    localStorage.setItem(LKEY, JSON.stringify(combined));
    return list.length;
  }

  // ===== Validation / Normalize =====
  function validateAndNormalize(m) {
    if (!m || typeof m !== "object") throw new Error("Model fehlt/ungültig");
    if (m.json_version !== 2) m.json_version = 2;
    if (!m.id) m.id = "mdl_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

    if (typeof m.manufacturer_name !== "string") m.manufacturer_name = "";
    if (typeof m.model_name !== "string") m.model_name = "";

    // model_params: freie Map<string,string>
    if (!m.model_params || typeof m.model_params !== "object") m.model_params = {};
    // Stelle sicher: alle values sind Strings
    Object.keys(m.model_params).forEach(k => {
      const v = m.model_params[k];
      m.model_params[k] = (v == null) ? "" : String(v);
    });

    if (!m.device_defaults) m.device_defaults = {};
    const dd = m.device_defaults;

    if (typeof dd.name_pattern !== "string") dd.name_pattern = DEFAULTS.name_pattern;

    // device simple fields defaults
    DEVICE_SIMPLE_FIELDS.forEach(key => {
      if (typeof dd[key] !== "string") {
        dd[key] = (DEFAULTS[key] != null) ? String(DEFAULTS[key]) : "";
      }
    });

    if (!Array.isArray(dd.txchannels)) dd.txchannels = [];
    if (!Array.isArray(dd.rxchannels)) dd.rxchannels = [];
    if (!Array.isArray(dd.extras)) dd.extras = [];

    dd.txchannels.forEach((c, i) => {
      if (typeof c.danteId !== "string") c.danteId = String(i + 1);
      if (typeof c.label !== "string") c.label = `${DEFAULTS.txLabelPrefix}${i + 1}`;
    });
    dd.rxchannels.forEach((c, i) => {
      if (typeof c.danteId !== "string") c.danteId = String(i + 1);
      if (typeof c.name !== "string") c.name = `${DEFAULTS.rxNamePrefix}${i + 1}`;
    });

    m.txCount = dd.txchannels.length | 0;
    m.rxCount = dd.rxchannels.length | 0;

    if (!m.createdAt) m.createdAt = Date.now();
    if (typeof m.notes !== "string") m.notes = "";
  }

  // ===== Dedupe =====
  function normalizeStr(s) {
    return String(s || "").trim().toLowerCase();
  }
  function channelsSignature(arr, key) {
    return (arr || []).map((c) => (c && typeof c[key] === "string" ? c[key] : "")).join("|");
  }
  function paramsSignature(obj) {
    // stable key order
    const keys = Object.keys(obj || {}).sort();
    return keys.map(k => `${k}=${String(obj[k])}`).join("&");
  }
  function modelSignature(m) {
    const man = normalizeStr(m.manufacturer_name);
    const mod = normalizeStr(m.model_name);
    const txN = m.txCount | 0;
    const rxN = m.rxCount | 0;
    const txSig = channelsSignature(m.device_defaults?.txchannels || [], "label");
    const rxSig = channelsSignature(m.device_defaults?.rxchannels || [], "name");
    const mpSig = paramsSignature(m.model_params);
    return `${man}::${mod}::${txN}x${rxN}::TX{${txSig}}::RX{${rxSig}}::MP{${mpSig}}`;
  }
  function dedupe(list) {
    const seen = new Set();
    const out = [];
    for (const m of list) {
      const sig = modelSignature(m);
      if (!seen.has(sig)) {
        seen.add(sig);
        out.push(m);
      }
    }
    return out;
  }

  // ===== XML helpers (namespace-robust) =====
  const XSD_VENDOR = ["manufacturer_name", "manufacturer"]; // Template nutzt manufacturer_name
  const XSD_MODEL = ["model_name"];
  const XSD_NAME  = ["name"];

  const FB_VENDOR = [
    "manufacturerName",
    "vendor", "vendor_name", "vendorName",
    "brand", "maker", "company",
  ];
  const FB_MODEL  = ["model", "product_name", "product"];

  function findByLocalNames(root, names) {
    if (!root) return null;
    const all = root.getElementsByTagName("*");
    for (let i = 0; i < all.length; i++) {
      const ln = all[i].localName || all[i].nodeName;
      if (names.includes(ln)) return all[i];
    }
    return null;
  }

  function readFirstText(root, prim, fb) {
    let el = findByLocalNames(root, prim);
    if (!el && fb && fb.length) el = findByLocalNames(root, fb);
    return el && el.textContent ? el.textContent.trim() : "";
  }

  function qAllLocal(root, localName) {
    const out = [];
    const all = root.getElementsByTagName("*");
    for (let i = 0; i < all.length; i++) {
      const ln = all[i].localName || all[i].nodeName;
      if (ln === localName) out.push(all[i]);
    }
    return out;
  }

  // ===== Name Pattern =====
  function getNamePattern(modelId){
    var id = String(modelId || '').trim();

    // Debug: schnell sehen, ob die Funktion aufgerufen wird
    // console.debug('[DA_LIB] getNamePattern called with id=', id);

    var list = load();
    var m = list.find(x => String(x.id) === id);

    // Fallback-Suche (falls einmal andere IDs verwendet werden)
    if (!m) {
      m = list.find(x => String((x && x._drag_id) || '') === id);
    }

    if (!m) {
      // console.warn('[DA_LIB] getNamePattern: model not found for id=', id);
      return 'Device-[n]';
    }

    var pat =
        (m.device_defaults && m.device_defaults.name_pattern) ||
        m.name_pattern ||
        (m.naming && m.naming.pattern) ||
        m.pattern ||
        'Device-[n]';

    // console.debug('[DA_LIB] getNamePattern: found pattern=', pat, 'for model', m.model_name);
    return String(pat);
    // Stelle sicher, dass getNamePattern öffentlich verfügbar ist:
    (function(){
      try{
        if (typeof window !== "undefined") {
          if (!window.DA_LIB) window.DA_LIB = {};
          // nur setzen, wenn noch nicht vorhanden oder überschreiben ausdrücklich gewünscht
          window.DA_LIB.getNamePattern = getNamePattern;
        }
      }catch(_){}
    })(); 
}


  // ===== Fingerprint + Extraction =====
  function fingerprintFromDevice(deviceEl) {
    const devName = readFirstText(deviceEl, XSD_NAME, []);
    let manufacturer_name = readFirstText(deviceEl, XSD_VENDOR, FB_VENDOR);
    if (!manufacturer_name) manufacturer_name = DEFAULTS.manufacturer_name;

    let model_name = readFirstText(deviceEl, XSD_MODEL, FB_MODEL);
    if (!model_name) model_name = DEFAULTS.model_name;

    // Kanäle
    const txEls = qAllLocal(deviceEl, "txchannel");
    const rxEls = qAllLocal(deviceEl, "rxchannel");

    const txchannels = txEls.map((tx, i) => {
      const id = String(tx.getAttribute("danteId") || i + 1);
      const lblEl = findByLocalNames(tx, ["label"]);
      const label =
        (lblEl && lblEl.textContent && lblEl.textContent.trim()) ||
        `${DEFAULTS.txLabelPrefix}${i + 1}`;
      return { danteId: id, label };
    });

    const rxchannels = rxEls.map((rx, i) => {
      const id = String(rx.getAttribute("danteId") || i + 1);
      const nmEl = findByLocalNames(rx, ["name"]);
      const name =
        (nmEl && nmEl.textContent && nmEl.textContent.trim()) ||
        `${DEFAULTS.rxNamePrefix}${i + 1}`;
      return { danteId: id, name };
    });

    // model_params: alle einfachen direkten Kindelemente mit Text (ein Level),
    // die NICHT name/manufacturer/model_name/txchannel/rxchannel/subscriptions sind.
    const model_params = {};
    for (let i = 0; i < deviceEl.children.length; i++) {
      const child = deviceEl.children[i];
      const ln = child.localName || child.nodeName;
      if (!ln) continue;
      if (ln === "name" || ln === "manufacturer_name" || ln === "manufacturer" ||
          ln === "model_name" || ln === "txchannel" || ln === "rxchannel" ||
          ln === "subscriptions") {
        continue;
      }
      // nur simple text children aufnehmen
      const text = (child.textContent || "").trim();
      if (text && child.children.length === 0) {
        model_params[ln] = text;
      }
    }

    return {
      manufacturer_name,
      model_name,
      devNameHint: devName,
      txCount: txchannels.length,
      rxCount: rxchannels.length,
      model_params,
      device_defaults: {
        name_pattern: DEFAULTS.name_pattern,
        // device simple fields mit Defaults
        serial: DEFAULTS.serial,
        mac: DEFAULTS.mac,
        ipv4: DEFAULTS.ipv4,
        dhcp: DEFAULTS.dhcp,
        location: DEFAULTS.location,
        firmware_version: DEFAULTS.firmware_version,
        hardware_rev: DEFAULTS.hardware_rev,

        txchannels,
        rxchannels,
        extras: [],
      },
    };
  }

  function findAllDevices(doc) {
    const out = [];
    const pres = findByLocalNames(doc, ["preset"]);
    if (pres) {
      const all = pres.getElementsByTagName("*");
      for (let i = 0; i < all.length; i++) {
        const ln = all[i].localName || all[i].nodeName;
        if (ln === "device") out.push(all[i]);
      }
    }
    if (!out.length) {
      const all2 = doc.getElementsByTagName("*");
      for (let j = 0; j < all2.length; j++) {
        const ln = all2[j].localName || all2[j].nodeName;
        if (ln === "device") out.push(all2[j]);
      }
    }
    return out;
  }

  // ===== Gleichheits-/Duplicate-Check =====
  function isSameAsModel(fp, m) {
    if (!fp || !m) return false;
    const fakeModel = {
      manufacturer_name: fp.manufacturer_name,
      model_name: fp.model_name,
      txCount: fp.device_defaults.txchannels.length,
      rxCount: fp.device_defaults.rxchannels.length,
      device_defaults: {
        txchannels: fp.device_defaults.txchannels,
        rxchannels: fp.device_defaults.rxchannels,
      },
      model_params: fp.model_params || {},
    };
    return modelSignature(fakeModel) === modelSignature(m);
  }

  function findExistingModelId(fp) {
    const list = load();
    for (const m of list) {
      if (isSameAsModel(fp, m)) return m.id;
    }
    return null;
  }

  // ===== Add model (mit Dedupe) =====
  function addModelFromFP(fp) {
    const list = load();

    const existingId = findExistingModelId(fp);
    if (existingId) {
      return list.find(x => x.id === existingId);
    }

    const id = "mdl_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    const model = {
      json_version: 2,
      id,
      manufacturer_name: fp.manufacturer_name || "",
      model_name: fp.model_name || "",
      txCount: fp.device_defaults.txchannels.length,
      rxCount: fp.device_defaults.rxchannels.length,
      model_params: fp.model_params || {},

      device_defaults: {
        name_pattern: fp.device_defaults.name_pattern || DEFAULTS.name_pattern,

        serial: fp.device_defaults.serial ?? DEFAULTS.serial,
        mac: fp.device_defaults.mac ?? DEFAULTS.mac,
        ipv4: fp.device_defaults.ipv4 ?? DEFAULTS.ipv4,
        dhcp: fp.device_defaults.dhcp ?? DEFAULTS.dhcp,
        location: fp.device_defaults.location ?? DEFAULTS.location,
        firmware_version: fp.device_defaults.firmware_version ?? DEFAULTS.firmware_version,
        hardware_rev: fp.device_defaults.hardware_rev ?? DEFAULTS.hardware_rev,

        txchannels: fp.device_defaults.txchannels,
        rxchannels: fp.device_defaults.rxchannels,
        extras: fp.device_defaults.extras || [],
      },

      notes: "",
      createdAt: Date.now(),
    };

    save([...list, model]);
    return model;
  }

  // ===== Device-XML Builder =====

function makeDeviceXml(modelId, opts) {
  const list = load();
  const m = list.find((x) => x.id === modelId);
  if (!m) throw new Error("Model nicht gefunden");

  const dd = m.device_defaults || {};
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  // Name: weiterhin deine Logik — ABER ohne zusätzliche Fallback-Defaults
  const name =
    (opts && typeof opts.name === "string" && opts.name.trim()) ||
    (dd.name_pattern ? dd.name_pattern.replace("[n]", "1").replace("xxxx", "0000") : "");

  let xml = `<device>\n`;
  if (name) xml += `  <name>${esc(name)}</name>\n`;

  // Nur aus der Lib vorhandene Felder schreiben (keine Defaults aus Code!)
  if (m.manufacturer_name) xml += `  <manufacturer_name>${esc(m.manufacturer_name)}</manufacturer_name>\n`;
  if (m.model_name)        xml += `  <model_name>${esc(m.model_name)}</model_name>\n`;

  // optionale Device-Metadaten ausschließlich, wenn in der Lib vorhanden
  if (typeof dd.default_name === "string" && dd.default_name) {
    xml += `  <default_name>${esc(dd.default_name)}</default_name>\n`;
  }
  if (typeof dd.friendly_name === "string" && dd.friendly_name) {
    xml += `  <friendly_name>${esc(dd.friendly_name)}</friendly_name>\n`;
  }

  // instance_id nur, wenn beide Felder vorhanden sind
  if ((dd.device_id && dd.device_id !== "") || (dd.process_id && dd.process_id !== "")) {
    xml += `  <instance_id>\n`;
    if (dd.device_id)  xml += `    <device_id>${esc(dd.device_id)}</device_id>\n`;
    if (dd.process_id) xml += `    <process_id>${esc(dd.process_id)}</process_id>\n`;
    xml += `  </instance_id>\n`;
  }

  // model_params (unverändert, aber nur die vorhandenen)
  const mp = m.model_params || {};
  Object.keys(mp).sort().forEach((k) => {
    const v = mp[k];
    if (v !== undefined && v !== null && v !== "") {
      xml += `  <${k}>${esc(v)}</${k}>\n`;
    }
  });

  // DEVICE_SIMPLE_FIELDS: nur wenn im dd gesetzt (kein Fallback auf DEFAULTS)
  DEVICE_SIMPLE_FIELDS.forEach((key) => {
    const val = dd[key];
    if (val !== "" && val !== null && val !== undefined) {
      xml += `  <${key}>${esc(val)}</${key}>\n`;
    }
  });

  // optionale Flags/Felder nur, wenn im dd vorhanden
  if (dd.hasOwnProperty("switch_vlan")) {
    xml += `  <switch_vlan value="${esc(String(dd.switch_vlan))}"/>\n`;
  }
  if (dd.hasOwnProperty("preferred_master")) {
    xml += `  <preferred_master value="${dd.preferred_master ? "true" : "false"}"/>\n`;
  }
  if (dd.hasOwnProperty("external_word_clock")) {
    xml += `  <external_word_clock value="${dd.external_word_clock ? "true" : "false"}"/>\n`;
  }
  if (dd.hasOwnProperty("redundancy")) {
    xml += `  <redundancy value="${dd.redundancy ? "true" : "false"}"/>\n`;
  }
  if (dd.hasOwnProperty("samplerate") && dd.samplerate !== "" && dd.samplerate !== null) {
    xml += `  <samplerate>${esc(String(dd.samplerate))}</samplerate>\n`;
  }
  if (dd.hasOwnProperty("encoding") && dd.encoding !== "" && dd.encoding !== null) {
    xml += `  <encoding>${esc(String(dd.encoding))}</encoding>\n`;
  }
  if (dd.hasOwnProperty("unicast_latency") && dd.unicast_latency !== "" && dd.unicast_latency !== null) {
    xml += `  <unicast_latency>${esc(String(dd.unicast_latency))}</unicast_latency>\n`;
  }

  // Interfaces: nur, wenn in dd.interfaces vorhanden (Anzahl) ODER dd.interfaces_list existiert
  if (typeof dd.interfaces === "number" && dd.interfaces > 0) {
    for (let n = 0; n < dd.interfaces; n++) {
      const mode = (dd.ipv4_mode ? String(dd.ipv4_mode) : "").trim();
      xml += `  <interface network="${n}">\n`;
      if (mode) xml += `    <ipv4_address mode="${esc(mode)}"/>\n`;
      xml += `  </interface>\n`;
    }
  } else if (Array.isArray(dd.interfaces_list) && dd.interfaces_list.length) {
    dd.interfaces_list.forEach((it) => {
      const net = (it && it.network != null) ? String(it.network) : null;
      const mode = (it && it.ipv4_mode != null) ? String(it.ipv4_mode) : null;
      if (net != null) {
        xml += `  <interface network="${esc(net)}">\n`;
        if (mode) xml += `    <ipv4_address mode="${esc(mode)}"/>\n`;
        xml += `  </interface>\n`;
      }
    });
  }

  // Kanäle: nur, wenn dd.txchannels / dd.rxchannels gesetzt
  if (Array.isArray(dd.txchannels) && dd.txchannels.length) {
    xml += dd.txchannels.map((c) => {
      const id = c && c.danteId != null ? String(c.danteId) : null;
      const lbl = c && c.label != null ? String(c.label) : null;
      if (!id) return "";
      let s = `  <txchannel danteId="${esc(id)}"`;
      // mediaType nur, wenn in Lib definiert
      if (c.mediaType) s += ` mediaType="${esc(String(c.mediaType))}"`;
      s += `>\n`;
      if (lbl) s += `    <label>${esc(lbl)}</label>\n`;
      s += `  </txchannel>`;
      return s;
    }).filter(Boolean).join("\n") + "\n";
  }

  if (Array.isArray(dd.rxchannels) && dd.rxchannels.length) {
    xml += dd.rxchannels.map((c) => {
      const id = c && c.danteId != null ? String(c.danteId) : null;
      const nm = c && c.name != null ? String(c.name) : null;
      if (!id) return "";
      let s = `  <rxchannel danteId="${esc(id)}"`;
      if (c.mediaType) s += ` mediaType="${esc(String(c.mediaType))}"`;
      s += `>\n`;
      if (nm) s += `    <name>${esc(nm)}</name>\n`;
      s += `  </rxchannel>`;
      return s;
    }).filter(Boolean).join("\n") + "\n";
  }

  // Extra-XML nur, wenn explizit in der Lib hinterlegt
  if (typeof dd.extra_xml === "string" && dd.extra_xml.trim()) {
    xml += dd.extra_xml.trim() + "\n";
  }

  xml += `</device>`;
  return xml;
}


  // ===== UI: Adopt Wizard =====
function findModelsByModelName(model_name) {
  const list = load();
  const needle = String(model_name || "").trim().toLowerCase();
  return list.filter(m => String(m.model_name || "").trim().toLowerCase() === needle);
}

function findSameModelSameManufacturer(model_name, manufacturer_name) {
  const nameL = String(model_name || "").trim().toLowerCase();
  const manL  = String(manufacturer_name || "").trim().toLowerCase();
  const list = load();
  return list.find(m =>
    String(m.model_name || "").trim().toLowerCase() === nameL &&
    String(m.manufacturer_name || "").trim().toLowerCase() === manL
  ) || null;
}
  function openAdoptWizard(xmlDoc) {
    const modal = document.getElementById("libWizardModal");
    if (!modal) {
      alert("Modal-Container #libWizardModal fehlt.");
      return;
    }
    modal.style.display = "flex";
    const closeBtn = modal.querySelector("[data-role='libwiz-close']");
    if (closeBtn) closeBtn.onclick = () => (modal.style.display = "none");
    modal.addEventListener("click", (ev) => {
      if (ev.target === modal) modal.style.display = "none";
    });

    const devices = findAllDevices(xmlDoc).map((de, idx) => {
      const fp = fingerprintFromDevice(de);
      const modelId = findExistingModelId(fp);
      const devName = fp.devNameHint || `Device-${idx + 1} (${fp.txCount}×${fp.rxCount})`;
      return { fp, devName, modelId };
    });

    const filterInput = document.getElementById("libwizFilter");
    const onlyUnknown = document.getElementById("libwizUnknown");
    const tbody = document.getElementById("libwizTbody");
    const countSpan = document.getElementById("libwizCount");

    function render() {
      const txt = (filterInput.value || "").toLowerCase();
      const unk = !!onlyUnknown.checked;
      tbody.innerHTML = "";
      let shown = 0;

      devices.forEach((row) => {
const isUnknown = findModelsByModelName(row.fp.model_name).length === 0;
        if (unk && !isUnknown) return;

        const hay = [
          row.devName,
          row.fp.manufacturer_name || "",
          row.fp.model_name || "",
          String(row.fp.txCount) + "x" + String(row.fp.rxCount),
          row.fp.device_defaults.txchannels.map((c) => c.label).join(" "),
          row.fp.device_defaults.rxchannels.map((c) => c.name).join(" "),
          // auch model_params mit durchsuchen
          Object.entries(row.fp.model_params || {}).map(([k,v]) => `${k}:${v}`).join(" "),
        ].join(" ").toLowerCase();
        if (txt && hay.indexOf(txt) < 0) return;

        shown++;
        const tr = document.createElement("tr");

        const tdKnown = document.createElement("td");
        tdKnown.style.textAlign = "center";
        tdKnown.textContent = isUnknown ? "—" : "✓";

        const tdDev = document.createElement("td");
        tdDev.textContent = row.devName;

        const tdCounts = document.createElement("td");
        tdCounts.textContent = row.fp.txCount + "×" + row.fp.rxCount;

        const tdLabels = document.createElement("td");
        const txs = row.fp.device_defaults.txchannels
          .map((c) => c.label).filter(Boolean).slice(0, 6).join(", ");
        const rxs = row.fp.device_defaults.rxchannels
          .map((c) => c.name).filter(Boolean).slice(0, 6).join(", ");
        tdLabels.textContent = (txs || "(keine)") + " | " + (rxs || "(keine)");

        const tdVendor = document.createElement("td");
        tdVendor.textContent = row.fp.manufacturer_name;

        const tdModel = document.createElement("td");
        tdModel.textContent = row.fp.model_name;

        const tdAct = document.createElement("td");
        const btn = document.createElement("button");
        btn.className = "btn";
        btn.textContent = isUnknown ? "Übernehmen" : "Schon in Lib";
        btn.disabled = !isUnknown;
btn.onclick = function () {
  const fp = row.fp;

  // Kandidaten nur nach model_name
  const sameName = findModelsByModelName(fp.model_name);

  if (sameName.length === 0) {
    // Noch kein Modell mit diesem model_name → neu anlegen
    const model = addModelFromFP(fp);
  } else {
    // Gibt es eins mit gleichem Hersteller?
    const exact = findSameModelSameManufacturer(fp.model_name, fp.manufacturer_name);
    if (exact) {
      // Bereits exakt vorhanden → nichts anlegen, auf dieses mappen
      // (kein addModelFromFP nötig)
    } else {
      // Abweichender Hersteller bei gleichem Modelnamen → Benutzer fragen
      const listText = sameName
        .map(m => `• ${m.manufacturer_name || "(ohne Hersteller)"} / ${m.model_name}`)
        .join("\n");
      const msg =
        `Es existieren bereits Modelle mit demselben Modelnamen („${fp.model_name}“), ` +
        `aber anderem Hersteller.\n\nBereits vorhanden:\n${listText}\n\n` +
        `Neues Modell anlegen mit:\n` +
        `• Hersteller: ${fp.manufacturer_name || "(leer)"}\n` +
        `• Modelname: ${fp.model_name}\n\n` +
        `OK = Neues Modell anlegen\nAbbrechen = Vorhandenes weiter nutzen (kein Anlegen)`;
      const createNew = window.confirm(msg);
      if (createNew) {
        addModelFromFP(fp);
      } else {
        // nichts tun; bleibt „Schon in Lib“ durch Neuprüfung unten,
        // falls du stattdessen gezielt auf ein vorhandenes mappen willst:
        // row.modelId = sameName[0].id;  // optional
      }
    }
  }

  // Nach jeder Aktion: alle Zeilen neu gegen die Library prüfen
  devices.forEach(function (r) {
    // "bekannt" jetzt: gibt es mind. 1 Modell mit gleichem model_name?
    r.modelId = (findModelsByModelName(r.fp.model_name)[0] || {}).id || null;
  });

  render();
  requestRenderSidebar();
};
        tdAct.appendChild(btn);

        [tdKnown, tdDev, tdCounts, tdLabels, tdVendor, tdModel, tdAct].forEach(
          (td) => tr.appendChild(td)
        );
        tbody.appendChild(tr);
      });

      countSpan.textContent = String(shown);
    }

    filterInput.oninput = render;
    onlyUnknown.onchange = render;
    render();

    // Export/Import
    const expBtn = document.getElementById("libwizExport");
    const impBtn = document.getElementById("libwizImport");
    const impFile = document.getElementById("libwizImportFile");
    expBtn.onclick = function () {
      const content = exportJson();
      const blob = new Blob([content], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "DanteArchitect_ModelLibrary.json";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 0);
    };
    impBtn.onclick = function () {
      impFile.value = "";
      impFile.click();
    };
    impFile.onchange = function (e) {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = function (ev) {
        try {
          const num = importJson(String(ev.target.result || ""));
          alert("Import erfolgreich: " + num + " Modelle übernommen.");
          render();
          requestRenderSidebar();
        } catch (err) {
          alert(err.message || String(err));
        }
      };
      reader.readAsText(f);
    };
  }

  // ===== Sidebar =====
function renderSidebarInto(container) {
  const list = load();
  const el = (typeof container === "string") ? document.querySelector(container) : container;
  if (!el) return;

  el.innerHTML = "";
  if (!list.length) {
    el.innerHTML = "<div class='muted'>Keine Modelle in der Bibliothek.</div>";
    return;
  }

  // sortiert wie zuvor (Vendor+Model)
  const sorted = list.slice().sort((a, b) =>
    ((a.manufacturer_name || "") + a.model_name).localeCompare(
      (b.manufacturer_name || "") + b.model_name
    )
  );

  const esc = (s) => String(s || "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"
  }[c]));

  // HTML mit Plus-Button und 3-Punkte-Menü
  const html = sorted.map(m => {
    return (
      `<div class="lib-item" draggable="true" data-role="lib-item" data-id="${m.id}">
        <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:8px;">
          <div>
            <strong>${esc(m.manufacturer_name)} — ${esc(m.model_name)}</strong>
            <div class="muted" style="font-size:12px; margin-top:2px;">
              ${m.txCount|0}×${m.rxCount|0}
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:6px;">
            <button class="btn btn-plus" data-role="lib-spawn" data-id="${m.id}" title="Einfügen">+</button>
            <div class="menu">
              <button class="btn menu-toggle" type="button" title="Mehr">⋯</button>
              <div class="menu-list">
                <button class="menu-item" data-role="lib-edit"  data-id="${m.id}">Bearbeiten</button>
                <button class="menu-item" data-role="lib-delete" data-id="${m.id}">Löschen</button>
              </div>
            </div>
          </div>
        </div>
      </div>`
    );
  }).join("");

  el.innerHTML = html;

  // Drag & Drop für jedes Item aktivieren (mit Fallback-Type)
  el.querySelectorAll(".lib-item[draggable]").forEach(row => {
    row.addEventListener("dragstart", function(ev){
      const id = row.getAttribute("data-id") || "";
      try{
        ev.dataTransfer.setData("application/x-da-modellib-id", id);
        ev.dataTransfer.setData("text/plain", "MODLIB:" + id); // Fallback
        ev.dataTransfer.effectAllowed = "copy";
      }catch(_){}
    });
  });
}

  let sidebarPending = false;
  function requestRenderSidebar() {
    if (sidebarPending) return;
    sidebarPending = true;
    requestAnimationFrame(function () {
      sidebarPending = false;
      const cont = document.getElementById("libSidebarBody");
      if (cont) renderSidebarInto(cont);
    });
  }

  // --- Public helpers for external callers (Script.js expects these) ---
  function removeById(id) {
    const list = load();
    const idx = list.findIndex(x => String(x.id) === String(id));
    if (idx >= 0) {
      list.splice(idx, 1);
      save(list);
      try { requestRenderSidebar(); } catch(_) {}
    }
  }

  // Save a full list coming from outside (fallback path in Script.js)
  function saveModels(list) {
    save(Array.isArray(list) ? list : []);
    try { requestRenderSidebar(); } catch(_) {}
  }


  // ===== Edit/Delete Modal =====
  // (Hinweis: Für das Edit-Modal haben wir bereits Vendor/Model/Pattern/Counts/Labels/Notes.
  //  Wenn du die neuen Felder (serial/mac/...) & model_params dort editierbar haben willst,
  //  sag Bescheid – ich ergänze die UI-Felder & Bindings konsistent.)
  function openEditModal(modelId) {
    const list = load();
    const idx = list.findIndex((x) => x.id === modelId);
    if (idx < 0) {
      alert("Eintrag nicht gefunden.");
      return;
    }
    const m = list[idx];

    const modal = document.getElementById("libEditModal");
    if (!modal) {
      alert("Modal-Container #libEditModal fehlt.");
      return;
    }

    const fVendor = modal.querySelector("#libEditVendor");
    const fName = modal.querySelector("#libEditName");
    const fTx = modal.querySelector("#libEditTx");
    const fRx = modal.querySelector("#libEditRx");
    const fTxLbl = modal.querySelector("#libEditTxLabels");
    const fRxLbl = modal.querySelector("#libEditRxLabels");
    const fNotes = modal.querySelector("#libEditNotes");
    const fPattern = modal.querySelector("#libEditNamePattern");

    if (fVendor) fVendor.value = m.manufacturer_name || "";
    if (fName)   fName.value   = m.model_name || "";
    if (fTx)     fTx.value     = String(m.txCount || 0);
    if (fRx)     fRx.value     = String(m.rxCount || 0);
    if (fTxLbl)  fTxLbl.value  = (m.device_defaults.txchannels || []).map((c) => c.label).join(", ");
    if (fRxLbl)  fRxLbl.value  = (m.device_defaults.rxchannels || []).map((c) => c.name).join(", ");
    if (fNotes)  fNotes.value  = m.notes || "";
    if (fPattern)fPattern.value= m.device_defaults.name_pattern || DEFAULTS.name_pattern;

    modal.style.display = "flex";

    const btnClose = modal.querySelector("[data-role='libedit-close']");
    if (btnClose) btnClose.onclick = () => (modal.style.display = "none");
    modal.addEventListener("click", (ev) => {
      if (ev.target === modal) modal.style.display = "none";
    });

    const btnSave = modal.querySelector("#libEditSave");
    if (btnSave) btnSave.onclick = function () {
      const txN = Math.max(0, parseInt((fTx && fTx.value) || "0", 10) || 0);
      const rxN = Math.max(0, parseInt((fRx && fRx.value) || "0", 10) || 0);

      const txLabels = ((fTxLbl && fTxLbl.value) || "")
        .split(",").map((s) => s.trim()).filter((s) => s.length || s === "");
      const rxLabels = ((fRxLbl && fRxLbl.value) || "")
        .split(",").map((s) => s.trim()).filter((s) => s.length || s === "");

      const txchannels = Array.from({ length: txN }, (_, i) => ({
        danteId: String(i + 1),
        label: txLabels[i] || `${DEFAULTS.txLabelPrefix}${i + 1}`,
      }));
      const rxchannels = Array.from({ length: rxN }, (_, i) => ({
        danteId: String(i + 1),
        name: rxLabels[i] || `${DEFAULTS.rxNamePrefix}${i + 1}`,
      }));

      m.manufacturer_name = (fVendor && fVendor.value || "").trim();
      m.model_name        = (fName && fName.value || "").trim();
      if (fPattern) {
        m.device_defaults.name_pattern = (fPattern.value || "").trim() || DEFAULTS.name_pattern;
      }
      m.device_defaults.txchannels = txchannels;
      m.device_defaults.rxchannels = rxchannels;
      m.notes = (fNotes && fNotes.value || "").trim();

      m.txCount = txchannels.length;
      m.rxCount = rxchannels.length;

      save(list);
      modal.style.display = "none";
      requestRenderSidebar();
    };

    const btnDel = modal.querySelector("#libEditDelete");
    if (btnDel) btnDel.onclick = function () {
      if (!confirm("Eintrag wirklich löschen?")) return;
      list.splice(idx, 1);
      save(list);
      modal.style.display = "none";
      requestRenderSidebar();
    };
  }

  // ===== Public API =====
// ===== Public API =====
return {
  openAdoptWizard,
  renderSidebarInto,
  _forceRenderSidebar: requestRenderSidebar,
  makeDeviceXml,
  getNamePattern,
  listModels: function(){ return load().slice(); },
  removeById,          // <-- neu
  saveModels,          // <-- neu
  openEditModal
};

})();


// === Device Library v1 =======================================================
// Speichert reale Geräte aus einem Preset (ohne Subscriptions),
// inklusive Name (Prefix/Suffix berücksichtigt), Vendor/Model, Channels, Simple-Fields.
// NICHT virtuell.
window.DA_DEVLIB = (function(){
  const LKEY = "DA_DEVICE_LIBRARY_V1";

  function load(){
    try{
      const raw = localStorage.getItem(LKEY);
      if(!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    }catch(_){ return []; }
  }
  function save(list){
    // einfache Dedupe nach Name+Vendor+Model+TX/RX Signatur
    const seen = new Set();
    const out = [];
    list.forEach(d => {
      const sig = deviceSignature(d);
      if(!seen.has(sig)){ seen.add(sig); out.push(d); }
    });
    localStorage.setItem(LKEY, JSON.stringify(out));
  }
  function exportJson(){
    return JSON.stringify({ version:1, devices: load() }, null, 2);
  }
  function importJson(jsonText){
    const parsed = JSON.parse(jsonText);
    const list = Array.isArray(parsed?.devices) ? parsed.devices : (Array.isArray(parsed) ? parsed : null);
    if(!list) throw new Error("Ungültiges JSON-Format für Device Library (v1).");
    const cur = load();
    save(cur.concat(list.map(normalize)));
    return list.length;
  }

  function normalize(d){
    const n = Object.assign({
      id: "dev_"+Math.random().toString(36).slice(2,10)+Date.now().toString(36),
      non_virtual: true,     // wichtig: echte Geräte
      createdAt: Date.now(),
      notes: ""
    }, d||{});
    // Pflichtfelder
    n.name = String(n.name||"");
    n.manufacturer_name = String(n.manufacturer_name||"");
    n.model_name = String(n.model_name||"");
    n.txchannels = Array.isArray(n.txchannels) ? n.txchannels : [];
    n.rxchannels = Array.isArray(n.rxchannels) ? n.rxchannels : [];
    // simple device fields (falls vorhanden)
    ["serial","mac","ipv4","dhcp","location","firmware_version","hardware_rev"].forEach(k=>{
      if(n[k]==null) n[k]="";
      else n[k]=String(n[k]);
    });
    return n;
  }
  function deviceSignature(d){
    const txSig = (d.txchannels||[]).map(c=>String(c?.label||"")).join("|");
    const rxSig = (d.rxchannels||[]).map(c=>String(c?.name||"")).join("|");
    return [
      (d.manufacturer_name||"").toLowerCase().trim(),
      (d.model_name||"").toLowerCase().trim(),
      (d.name||"").toLowerCase().trim(),
      `${(d.txchannels||[]).length}x${(d.rxchannels||[]).length}`,
      `TX{${txSig}}::RX{${rxSig}}`
    ].join("::");
  }

  // Hilfen für XML
  function qAllLocal(root, ln){
    const out=[]; const all=root.getElementsByTagName("*");
    for(let i=0;i<all.length;i++){ const n=all[i].localName||all[i].nodeName; if(n===ln) out.push(all[i]); }
    return out;
  }
  function findByLocalNames(root, names){
    const all = root.getElementsByTagName("*");
    for(let i=0;i<all.length;i++){ const ln=all[i].localName||all[i].nodeName; if(names.includes(ln)) return all[i]; }
    return null;
  }
  function readText(root, prim, fb){
    let el = findByLocalNames(root, prim);
    if(!el && fb && fb.length) el = findByLocalNames(root, fb);
    return el && el.textContent ? el.textContent.trim() : "";
  }

  // Name split/join kompatibel zur App
  function splitName(full){
    const s = String(full||"").trim();
    if(!s) return {prefix:"", suffix:""};
    // rechtes -\d+ als Zähler, falls danach -[A-Za-z] folgt -> Rest ist Suffix
    let idx=-1, m, re=/-(\d+)/g;
    while((m=re.exec(s))){
      const after=re.lastIndex, rest=s.slice(after);
      if(/-[A-Za-z]/.test(rest)) idx=after;
    }
    if(idx!==-1 && s.charAt(idx)==='-') return { prefix:s.slice(0,idx), suffix:s.slice(idx+1) };
    const m2 = s.match(/^(.*-\d+)(?:-(.+))?$/);
    if(m2) return { prefix:m2[1], suffix:m2[2]||"" };
    const i = s.lastIndexOf("-");
    if(i<0) return {prefix:s, suffix:""};
    return {prefix:s.slice(0,i), suffix:s.slice(i+1)};
  }
  function joinName(prefix, suffix){
    prefix=String(prefix||""); suffix=String(suffix||"");
    return suffix ? (prefix+"-"+suffix) : prefix;
  }

  // Hauptfunktion: alle Geräte aus Preset übernehmen
  function addDevicesFromPreset(xmlDoc, opts){
    opts = opts || {};
    const nameConcept = !!opts.nameConcept;
    const out = load();

    // Geräte finden (robust)
    let devEls = Array.prototype.slice.call(xmlDoc.querySelectorAll("preset > device"));
    if(!devEls.length) devEls = Array.prototype.slice.call(xmlDoc.querySelectorAll("device"));

    devEls.forEach(de=>{
      const name = readText(de, ["name"], []);
      const man  = readText(de, ["manufacturer_name","manufacturer"], ["manufacturerName","vendor","brand"]);
      const modn = readText(de, ["model_name"], ["model","product_name"]);
      const txEls = qAllLocal(de,"txchannel");
      const rxEls = qAllLocal(de,"rxchannel");

      // Channels OHNE subscriptions übernehmen
      const txchannels = txEls.map((tx,i)=>{
        const id = String(tx.getAttribute("danteId")||i+1);
        const lblEl = findByLocalNames(tx,["label"]);
        const label = (lblEl && lblEl.textContent ? lblEl.textContent.trim() : ("Ch"+(i+1)));
        return { danteId:id, label };
      });
      const rxchannels = rxEls.map((rx,i)=>{
        const id = String(rx.getAttribute("danteId")||i+1);
        const nmEl = findByLocalNames(rx,["name"]);
        const rnm = (nmEl && nmEl.textContent ? nmEl.textContent.trim() : ("In"+(i+1)));
        return { danteId:id, name:rnm };
      });

      // ggf. Prefix/Suffix bewahren (nur Anzeige/Felder; der gespeicherte name bleibt 1:1)
      let finalName = String(name||"");
      if(nameConcept){
        const p = splitName(finalName);
        finalName = joinName(p.prefix, p.suffix); // idempotent – dient nur Klarheit
      }

      const devEntry = normalize({
        name: finalName,
        manufacturer_name: man||"",
        model_name: modn||"",
        txchannels, rxchannels,
        // einfache Felder falls vorhanden (optional)
        serial: readText(de, ["serial"], []),
        mac: readText(de, ["mac"], []),
        ipv4: readText(de, ["ipv4"], []),
        dhcp: readText(de, ["dhcp"], []),
        location: readText(de, ["location"], []),
        firmware_version: readText(de, ["firmware_version"], []),
        hardware_rev: readText(de, ["hardware_rev"], []),
        non_virtual: true
      });

      out.push(devEntry);
    });

    save(out);
    return out.length;
  }

  // einfache Render-Helfer (Liste → HTML)
function toListItem(d, present){
  const p = splitName(d.name);
  const title = p.suffix ? (p.prefix + "-") : p.prefix;
  const sub   = p.suffix || "";
  const presentCls = present ? " is-present" : "";
  const dragAttr = present ? "" : ' draggable="true"';
  const plusDisabled = present ? ' disabled aria-disabled="true" title="Bereits im Preset"' : ' title="Einfügen"';

  return (
    `<div class="lib-item${presentCls}"${dragAttr} data-role="devlib-item" data-id="${d.id}">
      <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:8px;">
        <div>
          <strong>${escapeHtml(title)}</strong>${sub?("<br><span class='muted'>"+escapeHtml(sub)+"</span>"):""}
          <div class="muted" style="font-size:12px; margin-top:2px;">
            ${escapeHtml(d.manufacturer_name)} — ${escapeHtml(d.model_name)} · ${d.txchannels.length}×${d.rxchannels.length}
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:6px;">
          <button class="btn btn-plus" data-role="devlib-spawn" data-id="${d.id}"${plusDisabled}>+</button>
          <div class="menu">
            <button class="btn menu-toggle" type="button" title="Mehr">⋯</button>
            <div class="menu-list">
              <button class="menu-item" data-role="devlib-edit"  data-id="${d.id}">Bearbeiten</button>
              <button class="menu-item" data-role="devlib-delete" data-id="${d.id}">Löschen</button>
            </div>
          </div>
        </div>
      </div>
    </div>`
  );
}  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function renderSidebarList(container, xmlDoc){
  const el = (typeof container==="string") ? document.querySelector(container) : container;
  if(!el) return;
  const list = load();

  // Hilfsfunktion: prüft, ob Device bereits im Preset vorhanden ist (Name/MAC/Serial)
  function existsIn(doc, dev){
    try{
      if(!doc) return false;
      const root = doc.querySelector("preset") || doc;
      const devs = Array.prototype.slice.call(root.getElementsByTagName("device"));
      const pick = (node, sel) => {
        const n = node.querySelector(sel);
        return n && n.textContent ? n.textContent.trim() : "";
      };
      for(let i=0;i<devs.length;i++){
        const de = devs[i];
        const n = pick(de,"name");
        const m = pick(de,"mac");
        const s = pick(de,"serial");
        if (n && dev.name && n === dev.name) return true;
        if (m && dev.mac  && m === dev.mac)  return true;
        if (s && dev.serial && s === dev.serial) return true;
      }
    }catch(_){}
    return false;
  }

  el.innerHTML = list.length
    ? list.map(d => toListItem(d, existsIn(xmlDoc, d))).join("")
    : "<div class='muted'>Noch keine Geräte in der Bibliothek.</div>";
}

  // Public
  return {
    load, save, exportJson, importJson,
    addDevicesFromPreset,
    renderSidebarList
  };
})();

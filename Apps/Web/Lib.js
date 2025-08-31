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

    const name =
      (opts && typeof opts.name === "string" && opts.name.trim()) ||
      m.device_defaults.name_pattern.replace("[n]", "1").replace("xxxx", "0000");

    const dd = m.device_defaults;

    function esc(s) {
      return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    // 1) Name + Basis
    let xml =
      `<device>\n` +
      `  <name>${esc(name)}</name>\n` +
      `  <manufacturer_name>${esc(m.manufacturer_name || DEFAULTS.manufacturer_name)}</manufacturer_name>\n` +
      `  <model_name>${esc(m.model_name || DEFAULTS.model_name)}</model_name>\n`;

    // 2) model_params (in stabiler Reihenfolge)
    const mpKeys = Object.keys(m.model_params || {}).sort();
    mpKeys.forEach(k => {
      const v = m.model_params[k];
      xml += `  <${k}>${esc(v)}</${k}>\n`;
    });

    // 3) device simple fields
    DEVICE_SIMPLE_FIELDS.forEach(key => {
      const val = (dd[key] != null) ? dd[key] : (DEFAULTS[key] != null ? DEFAULTS[key] : "");
      if (val !== "" && val !== null && val !== undefined) {
        xml += `  <${key}>${esc(val)}</${key}>\n`;
      }
    });

    // 4) Kanäle
    const txXml = dd.txchannels.map(
      (c) => `  <txchannel danteId="${esc(c.danteId)}">\n    <label>${esc(c.label)}</label>\n  </txchannel>`
    ).join("\n");
    const rxXml = dd.rxchannels.map(
      (c) => `  <rxchannel danteId="${esc(c.danteId)}">\n    <name>${esc(c.name)}</name>\n  </rxchannel>`
    ).join("\n");

    if (txXml) xml += txXml + "\n";
    if (rxXml) xml += rxXml + "\n";

    xml += `</device>`;
    return xml;
  }

  // ===== UI: Adopt Wizard =====
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
        const isUnknown = !row.modelId;
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
  // 1) Modell in die Library übernehmen (mit Dedupe)
  const model = addModelFromFP(row.fp);

  // 2) Alle Reihen neu gegen die Library prüfen
  //    -> auch weitere identische Geräte werden als "Schon in Lib" erkannt
  devices.forEach(function (r) {
    r.modelId = findExistingModelId(r.fp);
  });

  // 3) UI aktualisieren
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
    container.innerHTML = "";
    if (!list.length) {
      container.innerHTML = "<div class='muted'>Keine Modelle in der Bibliothek.</div>";
      return;
    }
    list
      .slice()
      .sort((a, b) =>
        ((a.manufacturer_name || "") + a.model_name).localeCompare(
          (b.manufacturer_name || "") + b.model_name
        )
      )
      .forEach((m) => {
        const row = document.createElement("div");
        row.className = "lib-item";
        row.style.display = "flex";
        row.style.alignItems = "center";
        row.style.justifyContent = "space-between";
        row.style.gap = "8px";

        const text = document.createElement("div");
        const vh = m.manufacturer_name ? m.manufacturer_name + " / " : "";
        text.textContent = `${vh}${m.model_name} (${m.txCount}×${m.rxCount})`;

        const actions = document.createElement("div");
        const btnEdit = document.createElement("button");
        btnEdit.className = "btn";
        btnEdit.textContent = "Bearbeiten";
        btnEdit.onclick = function () {
          openEditModal(m.id);
        };
        actions.appendChild(btnEdit);

        row.appendChild(text);
        row.appendChild(actions);
        container.appendChild(row);
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
  return {
    openAdoptWizard,
    renderSidebarInto,
    _forceRenderSidebar: requestRenderSidebar,
    makeDeviceXml,
  };
})();
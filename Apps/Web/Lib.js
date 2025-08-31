// Apps/Web/Lib.js
// Library v2 – strikte XSD-Keys; fehlende XML-Felder werden mit Defaults ergänzt.

window.DA_LIB = (function () {
  const LKEY = "DA_MODEL_LIBRARY_V2";

  // ===== Defaults zentral =====
  const DEFAULTS = {
    manufacturer: "unknownSupplier",
    model_name: "unknownModel",
    name_pattern: "Device-xxxx-[n]",
    txLabelPrefix: "Ch",
    rxNamePrefix: "In",
  };

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
    localStorage.setItem(LKEY, JSON.stringify(list || []));
  }

  function exportJson() {
    return JSON.stringify({ version: 2, models: load() }, null, 2);
  }

  function importJson(jsonText) {
    const parsed = JSON.parse(jsonText);
    const list = Array.isArray(parsed)
      ? parsed
      : parsed && Array.isArray(parsed.models)
      ? parsed.models
      : null;
    if (!list) throw new Error("Ungültiges JSON-Format für Model Library (v2).");
    list.forEach(validateAndNormalize);
    localStorage.setItem(LKEY, JSON.stringify(list));
    return list.length;
  }

  // ===== Schema/Validation (leer erlaubt, aber Strings) =====
  function validateAndNormalize(m) {
    if (!m || typeof m !== "object") throw new Error("Model fehlt/ungültig");
    if (m.json_version !== 2) throw new Error("json_version muss 2 sein");
    if (!m.id) throw new Error("id fehlt");
    if (typeof m.manufacturer !== "string") m.manufacturer = "";
    if (typeof m.model_name !== "string") m.model_name = "";

    if (!m.device_defaults) m.device_defaults = {};
    const dd = m.device_defaults;

    if (typeof dd.name_pattern !== "string")
      dd.name_pattern = DEFAULTS.name_pattern;

    if (!Array.isArray(dd.txchannels)) dd.txchannels = [];
    if (!Array.isArray(dd.rxchannels)) dd.rxchannels = [];
    if (!Array.isArray(dd.extras)) dd.extras = [];

    // IDs/Labels/Namen sicherstellen
    dd.txchannels.forEach((c, i) => {
      if (typeof c.danteId !== "string") c.danteId = String(i + 1);
      if (typeof c.label !== "string")
        c.label = `${DEFAULTS.txLabelPrefix}${i + 1}`;
    });
    dd.rxchannels.forEach((c, i) => {
      if (typeof c.danteId !== "string") c.danteId = String(i + 1);
      if (typeof c.name !== "string")
        c.name = `${DEFAULTS.rxNamePrefix}${i + 1}`;
    });

    // Quelle der Wahrheit: Arrays → Counts
    m.txCount = dd.txchannels.length | 0;
    m.rxCount = dd.rxchannels.length | 0;
    if (!m.createdAt) m.createdAt = Date.now();
    if (typeof m.notes !== "string") m.notes = "";
  }

  // ===== XML helpers (namespace-robust) =====
  const XSD_VENDOR = ["manufacturer"];
  const XSD_MODEL = ["model_name"];
  const XSD_NAME = ["name"];

  const FB_VENDOR = ["vendor", "brand", "maker", "company"]; // nur Lesen
  const FB_MODEL = ["model", "product_name", "product"]; // nur Lesen

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

  // ===== Fingerprint aus <device> (XSD-first, Defaults wo nötig) =====
  function fingerprintFromDevice(deviceEl) {
    const devName = readFirstText(deviceEl, XSD_NAME, []);
    let manufacturer = readFirstText(deviceEl, XSD_VENDOR, FB_VENDOR);
    if (!manufacturer) manufacturer = DEFAULTS.manufacturer;

    let model_name = readFirstText(deviceEl, XSD_MODEL, FB_MODEL);
    if (!model_name) model_name = DEFAULTS.model_name;

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

    return {
      manufacturer,
      model_name,
      devNameHint: devName, // nur UI
      txCount: txchannels.length,
      rxCount: rxchannels.length,
      device_defaults: {
        name_pattern: DEFAULTS.name_pattern,
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

  // ===== Vergleich (Modellgleichheit) =====
  function matchesModel(fp, m) {
    return fp && m && fp.txCount === m.txCount && fp.rxCount === m.rxCount;
  }

  function findMatchingModelId(fp) {
    const list = load();
    for (let i = 0; i < list.length; i++) {
      if (matchesModel(fp, list[i])) return list[i].id;
    }
    return null;
  }

  // ===== Übernahme in Lib (schreibt nur XSD-Keys + device_defaults) =====
  function addModelFromFP(fp) {
    const list = load();
    const id =
      "mdl_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

    const model = {
      json_version: 2,
      id,
      manufacturer: fp.manufacturer || "",
      model_name: fp.model_name || "",
      txCount: fp.device_defaults.txchannels.length,
      rxCount: fp.device_defaults.rxchannels.length,
      device_defaults: {
        name_pattern: fp.device_defaults.name_pattern || DEFAULTS.name_pattern,
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

  // ===== Device-XML Builder (aus Model) =====
  function makeDeviceXml(modelId, opts) {
    // opts: { name?: string }
    const list = load();
    const m = list.find((x) => x.id === modelId);
    if (!m) throw new Error("Model nicht gefunden");

    const name =
      (opts && typeof opts.name === "string" && opts.name.trim()) ||
      m.device_defaults.name_pattern.replace("[n]", "1").replace("xxxx", "0000");

    const dd = m.device_defaults;

    function esc(s) {
      return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }

    const txXml = dd.txchannels
      .map(
        (c) =>
          `  <txchannel danteId="${esc(c.danteId)}">\n    <label>${esc(
            c.label
          )}</label>\n  </txchannel>`
      )
      .join("\n");
    const rxXml = dd.rxchannels
      .map(
        (c) =>
          `  <rxchannel danteId="${esc(c.danteId)}">\n    <name>${esc(
            c.name
          )}</name>\n  </rxchannel>`
      )
      .join("\n");

    const manufacturer = m.manufacturer || DEFAULTS.manufacturer;
    const model_name = m.model_name || DEFAULTS.model_name;

    const xml =
      `<device>\n` +
      `  <name>${esc(name)}</name>\n` +
      `  <manufacturer>${esc(manufacturer)}</manufacturer>\n` +
      `  <model_name>${esc(model_name)}</model_name>\n` +
      `${txXml ? txXml + "\n" : ""}${rxXml}\n` +
      `</device>`;

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
      const matchId = findMatchingModelId(fp);
      // devName nur für Anzeige
      const devName =
        fp.devNameHint || `Device-${idx + 1} (${fp.txCount}×${fp.rxCount})`;
      return { fp, devName, modelId: matchId };
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
          row.fp.manufacturer || "",
          row.fp.model_name || "",
          String(row.fp.txCount) + "x" + String(row.fp.rxCount),
          row.fp.device_defaults.txchannels.map((c) => c.label).join(" "),
          row.fp.device_defaults.rxchannels.map((c) => c.name).join(" "),
        ]
          .join(" ")
          .toLowerCase();
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
          .map((c) => c.label)
          .filter(Boolean)
          .slice(0, 6)
          .join(", ");
        const rxs = row.fp.device_defaults.rxchannels
          .map((c) => c.name)
          .filter(Boolean)
          .slice(0, 6)
          .join(", ");
        tdLabels.textContent = (txs || "(keine)") + " | " + (rxs || "(keine)";

        const tdVendor = document.createElement("td");
        tdVendor.textContent = row.fp.manufacturer;

        const tdModel = document.createElement("td");
        tdModel.textContent = row.fp.model_name;

        const tdAct = document.createElement("td");
        const btn = document.createElement("button");
        btn.className = "btn";
        btn.textContent = isUnknown ? "Übernehmen" : "Schon in Lib";
        btn.disabled = !isUnknown;
        btn.onclick = function () {
          const model = addModelFromFP(row.fp);
          row.modelId = model.id;
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
        ((a.manufacturer || "") + a.model_name).localeCompare(
          (b.manufacturer || "") + b.model_name
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
        const vh = m.manufacturer ? m.manufacturer + " / " : "";
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

    fVendor.value = m.manufacturer || "";
    fName.value = m.model_name || "";
    fTx.value = String(m.txCount || 0);
    fRx.value = String(m.rxCount || 0);
    fTxLbl.value = (m.device_defaults.txchannels || [])
      .map((c) => c.label)
      .join(", ");
    fRxLbl.value = (m.device_defaults.rxchannels || [])
      .map((c) => c.name)
      .join(", ");
    fNotes.value = m.notes || "";
    fPattern.value = m.device_defaults.name_pattern || DEFAULTS.name_pattern;

    modal.style.display = "flex";

    const btnClose = modal.querySelector("[data-role='libedit-close']");
    if (btnClose) btnClose.onclick = () => (modal.style.display = "none");
    modal.addEventListener("click", (ev) => {
      if (ev.target === modal) modal.style.display = "none";
    });

    const btnSave = modal.querySelector("#libEditSave");
    btnSave.onclick = function () {
      const txN = Math.max(0, parseInt(fTx.value || "0", 10) || 0);
      const rxN = Math.max(0, parseInt(fRx.value || "0", 10) || 0);

      const txLabels = (fTxLbl.value || "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length || s === "");
      const rxLabels = (fRxLbl.value || "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length || s === "");

      // Kanallisten in gewünschter Länge erzeugen (IDs 1..N, fehlende Labels auffüllen)
      const txchannels = Array.from({ length: txN }, (_, i) => ({
        danteId: String(i + 1),
        label: txLabels[i] || `${DEFAULTS.txLabelPrefix}${i + 1}`,
      }));
      const rxchannels = Array.from({ length: rxN }, (_, i) => ({
        danteId: String(i + 1),
        name: rxLabels[i] || `${DEFAULTS.rxNamePrefix}${i + 1}`,
      }));

      m.manufacturer = (fVendor.value || "").trim();
      m.model_name = (fName.value || "").trim();
      m.device_defaults.name_pattern =
        (fPattern.value || "").trim() || DEFAULTS.name_pattern;
      m.device_defaults.txchannels = txchannels;
      m.device_defaults.rxchannels = rxchannels;
      m.notes = (fNotes.value || "").trim();

      // Counts aus Arrays ableiten
      m.txCount = txchannels.length;
      m.rxCount = rxchannels.length;

      save(list);
      modal.style.display = "none";
      requestRenderSidebar();
    };

    const btnDel = modal.querySelector("#libEditDelete");
    btnDel.onclick = function () {
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
    makeDeviceXml, // für „Gerät hinzufügen“
  };
})();
// Apps/Web/Script.js

// ---- Config & Keys ----
var HELPER = { base: "http://localhost:53535", health: "/health", scan: "/scan" };
var SKEY_XML  = "DA_PRESET_XML";
var SKEY_META = "DA_PRESET_META";

// ---- Helper Functions ----
function $(s){ return document.querySelector(s); }
function rowHtml(cols){ return "<tr>" + cols.map(function(c){ return "<td>"+c+"</td>"; }).join("") + "</tr>"; }
function parseXml(text){
  var p = new DOMParser(); var xml = p.parseFromString(text, "application/xml");
  var err = xml.querySelector("parsererror"); if(err) throw new Error("XML Parser Error: " + err.textContent);
  return xml;
}

// Legt bei Bedarf ein leeres <preset/> an und persistiert es.
function ensurePresetDoc(){
  if (window.lastXmlDoc) return window.lastXmlDoc;
  var doc = (new DOMParser()).parseFromString("<preset/>", "application/xml");
  window.lastXmlDoc = doc;
  try { sessionStorage.setItem("DA_PRESET_XML", new XMLSerializer().serializeToString(doc)); } catch(_){}
  return doc;
}

// === Model-Library: Liste robust holen ===
function getModelLibListOrThrow(){
  if (!window.DA_LIB) {
    throw new Error("Model-Library fehlt (DA_LIB nicht gefunden).");
  }
  // moderne API in deiner Lib.js:
  if (typeof DA_LIB.listModels === "function") {
    return DA_LIB.listModels();
  }
  // ältere/alternative Namen:
  if (typeof DA_LIB.load === "function")  return DA_LIB.load();
  if (typeof DA_LIB.getAll === "function") return DA_LIB.getAll();
  if (typeof DA_LIB.list === "function")   return DA_LIB.list();
  if (DA_LIB.state && Array.isArray(DA_LIB.state.list)) return DA_LIB.state.list;

  throw new Error("Model-Library fehlt (keine listModels()/load()/getAll()/list() gefunden).");
}


function getSelectionInInput(input){
  return {
    start: input.selectionStart || 0,
    end: input.selectionEnd || 0,
    text: (input.value || "").slice(input.selectionStart || 0, input.selectionEnd || 0)
  };
}


// === Namenskonzept (global) ===
var NAME_SCHEME_KEY = "DA_NAME_SCHEME_ENABLED";
function isNameConceptEnabled(){ try { return localStorage.getItem(NAME_SCHEME_KEY) === "1"; } catch(_) { return false; } }
function setNameConceptEnabled(on){ try { localStorage.setItem(NAME_SCHEME_KEY, on ? "1" : "0"); } catch(_) {} }

// [n]-sicheres Splitten: Suffix beginnt erst NACH "-<Zahl>-..."
function splitName(full){
  full = String(full || "");
  var m = full.match(/^(.*-\d+)(?:-(.+))?$/);
  if (m) return { prefix: m[1], suffix: m[2] ? m[2] : "" };
  var idx = full.lastIndexOf("-");
  if (idx < 0) return { prefix: full, suffix: "" };
  return { prefix: full.slice(0, idx), suffix: full.slice(idx + 1) };
}
function joinName(prefix, suffix){
  prefix = String(prefix || ""); suffix = String(suffix || "");
  return suffix ? (prefix + "-" + suffix) : prefix;
}

// Ist der Gerätename noch „virtuell“ (Default-Pattern im Prefix / Platzhalter 'xxxx')?
function isVirtualName(fullName){
  var s = String(fullName || "");
  // Nutze splitName, falls vorhanden – sonst einfacher Fallback:
  var parts;
  try { parts = splitName ? splitName(s) : { prefix: s, suffix: "" }; } catch(_) { parts = { prefix: s, suffix: "" }; }
  var pref = (parts.prefix || "").toLowerCase();

  // Platzhalter 'xxxx' im Prefix → virtuell
  if (/(^|-)xxxx($|-)/.test(pref)) return true;

  // Default-Pattern startet oft mit 'Device-...' → virtuell
  if (s.toLowerCase().startsWith("device-")) return true;

  return false;
}


// Serialisieren mit XML-Header (UTF-8 + standalone="yes")
function serializeWithHeader(xmlDoc){
  var xml = new XMLSerializer().serializeToString(xmlDoc);
  var hasHeader = /^\s*<\?xml[^>]*\?>/i.test(xml);
  if (hasHeader) {
    return xml; // vorhandenen Header nicht anfassen
  } else {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + xml;
  }
}

// Ensure Preset Envelope (root <preset> with version, <name>, <description>)
function ensurePresetEnvelope(doc){
  if (!doc) return;
  let root = doc.documentElement;

  // Sicherstellen, dass <preset> Root existiert
  if (!root || root.tagName !== "preset") {
    const newRoot = doc.createElement("preset");
    newRoot.setAttribute("version", "2.1.0");
    if (root) {
      while (doc.firstChild) doc.removeChild(doc.firstChild);
      doc.appendChild(newRoot);
      newRoot.appendChild(root);
    } else {
      doc.appendChild(newRoot);
    }
    root = newRoot;
  }

  // Hilfsfunktionen: nur DIREKTE Kinder ermitteln
  const getDirectChild = (parent, localName) => {
    const kids = parent.children || [];
    for (let i = 0; i < kids.length; i++) {
      if ((kids[i].localName || kids[i].nodeName) === localName) return kids[i];
    }
    return null;
  };
  const insertAfter = (ref, node) => {
    if (ref && ref.parentNode) {
      if (ref.nextSibling) ref.parentNode.insertBefore(node, ref.nextSibling);
      else ref.parentNode.appendChild(node);
    }
  };

  // Version-Attribut sicherstellen (nur wenn fehlend)
  if (!root.getAttribute("version")) root.setAttribute("version", "2.1.0");

  // <name> als direktes Kind sicherstellen
  let nameNode = getDirectChild(root, "name");
  if (!nameNode) {
    nameNode = doc.createElement("name");
    nameNode.textContent = "DanteArchitectPreset";
    root.insertBefore(nameNode, root.firstChild);
  } else if (!nameNode.textContent || !nameNode.textContent.trim()) {
    nameNode.textContent = "DanteArchitectPreset";
  }

  // <description> als direktes Kind sicherstellen
  let descNode = getDirectChild(root, "description");
  if (!descNode) {
    descNode = doc.createElement("description");
    descNode.textContent = "Dante Controller preset";
    insertAfter(nameNode, descNode);
  } else if (!descNode.textContent || !descNode.textContent.trim()) {
    descNode.textContent = "Dante Controller preset";
  }
}

// ---- Global State ----
var lastXmlDoc = null;

// ---- Statusbar helpers ----
function setLed(state){
  var led = $("#statusLed"); if(!led) return;
  led.classList.remove("green","yellow","red");
  if(state === "connected") led.classList.add("green");
  else if(state === "connecting") led.classList.add("yellow");
  else led.classList.add("red");
}
function setStatusText(txt){ var t=$("#statusText"); if(t) t.textContent=txt; }
function setSpinner(active){ var sp=$("#statusSpinner"); if(!sp) return; if(active) sp.classList.add("active"); else sp.classList.remove("active"); }
function setTimestamp(ts){
  var el = $("#statusLastScan");
  if (el) el.textContent = ts ? ("letzter Scan: " + new Date(ts).toLocaleTimeString()) : "";
}

// ---- Layout: rechte Sidebar (schiebt nur #mainContent, nicht die Statusbar) ----
(function enableRightSidebar(){
  try { document.body.classList.add("with-right-sidebar"); } catch(_) {}
  (function makeRightSidebarResizable(){
    var sidebar = $("#rightSidebar"), resizer = $("#sidebarResizer");
    if(!sidebar || !resizer) return;
    function onMove(e){
      var rect = sidebar.getBoundingClientRect();
      var newW = Math.min(Math.max(rect.right - e.clientX, 260), window.innerWidth*0.6);
      sidebar.style.width = newW+"px";
      var main = $("#mainContent"); if(main) main.style.marginRight = newW+"px";
    }
    function onUp(){ document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); }
    resizer.addEventListener("mousedown", function(e){
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      e.preventDefault();
    });
  })();
})();
// --- Sidebar Tabs für Model/Device ---
(function setupSidebarTabs(){
  var tM = document.getElementById("tabModels");
  var tD = document.getElementById("tabDevices");
  var bM = document.getElementById("libSidebarBody");
  var bD = document.getElementById("devSidebarBody");
  function show(which){
    if(!tM||!tD||!bM||!bD) return;
    var isDev = (which === "dev");
    bM.style.display = isDev ? "none" : "";
    bD.style.display = isDev ? "" : "none";
    tM.classList.toggle("active", !isDev);
    tD.classList.toggle("active", isDev);
  }
  if(tM) tM.addEventListener("click", function(){ show("model"); });
  if(tD) tD.addEventListener("click", function(){ show("dev"); });
  // Default: Models sichtbar
  show("model");
})();

// --- Device Wizard öffnen ---
(function bindDeviceWizard(){
  var btn = document.getElementById("btnDevWizardSidebar");
  var modal = document.getElementById("devWizardModal");
  var closeBtn = modal ? modal.querySelector("[data-role='devwiz-close']") : null;
  var doImport = document.getElementById("devwizImport");
  var respect = document.getElementById("devwizRespectNameConcept");

  if(!btn || !modal) return;

  btn.addEventListener("click", function(){
    if(!window.lastXmlDoc){
      alert("Kein Preset geladen.");
      return;
    }
    modal.style.display = "flex";
  });
  if(closeBtn) closeBtn.addEventListener("click", function(){ modal.style.display = "none"; });

  if(doImport){
    doImport.addEventListener("click", function(){
      try{
        var countBefore = (window.DA_DEVLIB.load()||[]).length;
        window.DA_DEVLIB.addDevicesFromPreset(window.lastXmlDoc, { nameConcept: !!(respect && respect.checked) });
        modal.style.display = "none";
        // Sidebar (Device) aktualisieren
        window.DA_DEVLIB.renderSidebarList("#devSidebarBody", window.lastXmlDoc);
        var countAfter = (window.DA_DEVLIB.load()||[]).length;
        alert((countAfter - countBefore) + " Geräte übernommen.");
      }catch(e){
        alert(e.message || String(e));
      }
    });
  }
})();

// --- Initial beide Sidebars füllen ---
(function renderLibraries(){
  try {
    if (window.DA_LIB){
      if (typeof DA_LIB.renderSidebar === "function"){
        DA_LIB.renderSidebar("#libSidebarBody");
      } else if (typeof DA_LIB.renderSidebarInto === "function"){
        DA_LIB.renderSidebarInto("#libSidebarBody");
      }
    }
  } catch(_){}
  try { window.DA_DEVLIB && window.DA_DEVLIB.renderSidebarList && window.DA_DEVLIB.renderSidebarList("#devSidebarBody", window.lastXmlDoc); } catch(_){}
})();

// --- Device Sidebar Actions (Delegation) ---
(function wireDeviceSidebarActions(){
  var host = document.getElementById("devSidebarBody");
  if(!host) return;

  // Click-Aktionen
  host.addEventListener("click", function(ev){
    var t = ev.target;
    if(!t || !t.dataset) return;

    if(t.dataset.role === "devlib-delete"){
      var id = t.dataset.id || "";
      var list = window.DA_DEVLIB.load();
      var idx = list.findIndex(x=> String(x.id)===String(id));
      if(idx>=0){
        list.splice(idx,1);
        window.DA_DEVLIB.save(list);
        window.DA_DEVLIB.renderSidebarList(host);
      }
    }

    if(t.dataset.role === "devlib-spawn"){
      // Immer die zentrale Funktion verwenden (Duplikat-Check inklusive)
      var id = t.dataset.id || "";
      spawnDeviceFromDevLibById(id);
    }

    if(t.dataset.role === "devlib-edit"){
      openDevEditModal(t.dataset.id);
    }
  });

  // Dragstart (separat, NICHT im Click-Handler!)
  host.addEventListener("dragstart", function(ev){
    var item = ev.target.closest('[data-role="devlib-item"]');
    if(!item) return;
    var id = item.dataset.id;
    try{
      ev.dataTransfer.setData("application/x-da-devlib-id", id);
      ev.dataTransfer.setData("text/plain", "DEVLIB:" + id); // Fallback
      ev.dataTransfer.effectAllowed = "copy";
    }catch(_){}
  }, true);
})();

// --- Model Sidebar Actions (Delegation) ---
(function wireModelSidebarActions(){
  var host = document.getElementById("libSidebarBody");
  if(!host) return;

  host.addEventListener("click", function(ev){
    var t = ev.target;
    if(!t) return;

    // ⋯ Menü togglen
    var kebab = t.closest(".menu-toggle");
    if (kebab){
      ev.stopPropagation();
      closeAllMenus();
      var menu = kebab.closest(".menu");
      if(menu) menu.classList.toggle("open");
      return;
    }

    // Plus → einfügen
    if (t.dataset && t.dataset.role === "lib-spawn"){
      var id = t.dataset.id || "";
      spawnModelFromLibById(id);
      closeAllMenus();
      return;
    }

    // Bearbeiten
    if (t.dataset && t.dataset.role === "lib-edit"){
      closeAllMenus();
    // existiert schon eine edit-Funktion in der Library? → nutzen
    if (window.DA_LIB && typeof DA_LIB.openEditModal === "function") {
      window.closeAllMenus();
      DA_LIB.openEditModal(t.dataset.id);
      return;
    }
    // Legacy-Global (falls vorhanden)
    if (typeof window.openLibEditModal === "function") {
      window.closeAllMenus();
      window.openLibEditModal(t.dataset.id);
      return;
    }
    // Fallback: einfacher Öffner
    tryOpenLibEditModalFallback(t.dataset.id); // siehe Hilfsfunktion unten
    return;
    }

    // Löschen
    if (t.dataset && t.dataset.role === "lib-delete"){
      window.closeAllMenus();

      var id = t.dataset.id || "";

      // 1) bevorzugt offizielle API der Library
      if (window.DA_LIB && typeof DA_LIB.removeById === "function"){
        DA_LIB.removeById(id);
      } else {
        // 2) robuster Fallback: Liste holen → Eintrag löschen → speichern
        var list = [];
        try {
          if (window.getModelLibListOrThrow) {
            list = getModelLibListOrThrow();
          } else if (window.DA_LIB && typeof DA_LIB.listModels === "function") {
            list = DA_LIB.listModels();
          } else if (window.DA_LIB && typeof DA_LIB.load === "function") {
            list = DA_LIB.load();
          }
        } catch(_){}

        var idx = list.findIndex(function(x){ return String(x.id) === String(id); });
        if (idx >= 0) list.splice(idx, 1);

        // Speichern: mehrere mögliche API-Namen abdecken
        try {
          if (window.DA_LIB && typeof DA_LIB.saveModels === "function") {
            DA_LIB.saveModels(list);
          } else if (window.DA_LIB && typeof DA_LIB.save === "function") {
            DA_LIB.save(list);
          }
        } catch(_){}
      }

      // 3) Sidebar neu rendern (unterstützt beide Render-APIs)
      try {
        if (window.DA_LIB && typeof DA_LIB.renderSidebarInto === "function") {
          DA_LIB.renderSidebarInto("#libSidebarBody");
        } else if (window.DA_LIB && typeof DA_LIB.renderSidebar === "function") {
          DA_LIB.renderSidebar("#libSidebarBody");
        }
      } catch(_){}

      return;
    }
  });

  // Dragstart (setzt Custom-Type + Text-Fallback)
  host.addEventListener("dragstart", function(ev){
    var item = ev.target.closest('[data-role="lib-item"]');
    if(!item) return;
    var id = item.getAttribute("data-id") || "";
    try{
      ev.dataTransfer.setData("application/x-da-modellib-id", id);
      ev.dataTransfer.setData("text/plain", "MODLIB:" + id);
      ev.dataTransfer.effectAllowed = "copy";
    }catch(_){}
  }, true);
})();


// Prüft, ob dieses Device (aus der Dev-Lib) im aktuellen Preset bereits existiert.
// Kriterium: gleicher Name ODER gleiche MAC ODER gleiche Seriennummer.
function deviceExistsInPreset(doc, devEntry){
  if(!doc || !devEntry) return false;
  var devEls = Array.prototype.slice.call((doc.querySelector("preset") || doc).getElementsByTagName("device"));

  function txt(el, sel){
    var n = el.querySelector(sel);
    return n && n.textContent ? n.textContent.trim() : "";
  }

  for(var i=0;i<devEls.length;i++){
    var de = devEls[i];
    var n  = txt(de,"name");
    var m  = txt(de,"mac");
    var s  = txt(de,"serial");

    if (n && devEntry.name && n === devEntry.name) return true;
    if (m && devEntry.mac && m === devEntry.mac)   return true;
    if (s && devEntry.serial && s === devEntry.serial) return true;
  }
  return false;
}

function spawnDeviceFromDevLibById(devId){
  var doc = ensurePresetDoc();
  var list = (window.DA_DEVLIB && window.DA_DEVLIB.load()) || [];
  var d = list.find(x => String(x.id) === String(devId));
  if(!d){ alert("Device nicht gefunden."); return; }

  // Harter Stop bei Duplikaten (Name oder MAC oder Serial)
  if (deviceExistsInPreset(window.lastXmlDoc, d)){
    alert("Dieses Device ist im Preset bereits vorhanden.");
    return;
  }

  var doc = window.lastXmlDoc;
  var devEl = doc.createElement("device");

  // Pflichtfelder 1:1 übernehmen (KEIN Auto-Umbenennen!)
  var n = doc.createElement("name"); n.textContent = d.name; devEl.appendChild(n);
  var man = doc.createElement("manufacturer_name"); man.textContent = d.manufacturer_name || ""; devEl.appendChild(man);
  var mdl = doc.createElement("model_name"); mdl.textContent = d.model_name || ""; devEl.appendChild(mdl);

  // optionale Felder
  ["serial","mac","ipv4","dhcp","location","firmware_version","hardware_rev","notes"].forEach(function(k){
    if(d[k]){ var e = doc.createElement(k); e.textContent = String(d[k]); devEl.appendChild(e); }
  });

  // Kanäle (ohne Abos)
  (d.txchannels||[]).forEach(function(ch){
    var tx = doc.createElement("txchannel");
    if(ch.danteId!=null) tx.setAttribute("danteId", String(ch.danteId));
    var lbl = doc.createElement("label"); lbl.textContent = String(ch.label||""); tx.appendChild(lbl);
    devEl.appendChild(tx);
  });
  (d.rxchannels||[]).forEach(function(ch){
    var rx = doc.createElement("rxchannel");
    if(ch.danteId!=null) rx.setAttribute("danteId", String(ch.danteId));
    var nm = doc.createElement("name"); nm.textContent = String(ch.name||""); rx.appendChild(nm);
    devEl.appendChild(rx);
  });

  var root = doc.querySelector("preset") || doc.documentElement;
  root.appendChild(devEl);

  var xml = new XMLSerializer().serializeToString(doc);
  try { sessionStorage.setItem("DA_PRESET_XML", xml); } catch(_){}
  if (typeof fillPresetTable === "function") fillPresetTable(doc);
  try { window.DA_DEVLIB.renderSidebarList("#devSidebarBody", window.lastXmlDoc); } catch(_){}

}

function spawnModelFromLibById(modelId){
  var doc = ensurePresetDoc();

  var list;
  try { list = getModelLibListOrThrow(); }
  catch(e){ alert(e.message || "Model-Library fehlt."); return; }

  var m = list.find(function(x){ return String(x.id)===String(modelId); });
  if(!m){ alert("Modell nicht gefunden."); return; }

  // Name-Pattern aus Lib/Model ermitteln
  var pattern = "";
  try {
    if (typeof DA_LIB.getNamePattern === "function") pattern = DA_LIB.getNamePattern(modelId) || "";
  } catch(_){}
  if (!pattern) {
    pattern =
      (m.device_defaults && m.device_defaults.name_pattern) ||
      m.name_pattern ||
      (m.naming && m.naming.pattern) ||
      m.pattern ||
      "Device-[n]";
  }

  // Eindeutigen Gerätenamen erzeugen
  var deviceName = (typeof window.generateUniqueNameFromPattern === "function")
    ? window.generateUniqueNameFromPattern(pattern, lastXmlDoc, null)
    : (pattern.replace(/\[(?:n|N)\]/g,"1") || "Device-1");

  // Device-XML über Lib erzeugen
  if (!window.DA_LIB || typeof DA_LIB.makeDeviceXml !== "function"){
    alert("Library-Modul (makeDeviceXml) fehlt.");
    return;
  }
  var xmlStr = DA_LIB.makeDeviceXml(modelId, { name: deviceName });

  // In Preset übernehmen
  var frag = parseXml(xmlStr);
  var devEl = frag.documentElement; // <device>
  var imported = lastXmlDoc.importNode ? lastXmlDoc.importNode(devEl, true) : devEl;
  var root = lastXmlDoc.querySelector("preset") || lastXmlDoc.documentElement;
  root.appendChild(imported);

  // Persist & UI
  writePresetToSession(new XMLSerializer().serializeToString(lastXmlDoc));
  fillPresetTable(lastXmlDoc);
}

(function setupDevEditModal(){
  var modal = document.getElementById("devEditModal");
  if(!modal) return;

  var inpVendor = document.getElementById("devEditVendor");
  var inpModel  = document.getElementById("devEditModel");
  var inpName   = document.getElementById("devEditFullName");
  var inpTxLbl  = document.getElementById("devEditTxLabels");
  var inpRxLbl  = document.getElementById("devEditRxLabels");
  var inpNotes  = document.getElementById("devEditNotes");
  var btnClose  = modal.querySelector("[data-role='devedit-close']");
  var btnSave   = document.getElementById("devEditSave");
  var btnDelete = document.getElementById("devEditDelete");

  var ctx = { id:null };

  function close(){ modal.style.display="none"; }
  function open(id){
    var list = window.DA_DEVLIB.load();
    var d = list.find(x => String(x.id)===String(id));
    if(!d){ alert("Eintrag nicht gefunden."); return; }
    ctx.id = d.id;
    inpVendor.value = d.manufacturer_name || "";
    inpModel.value  = d.model_name || "";
    inpName.value   = d.name || "";
    inpNotes.value  = d.notes || "";
    inpTxLbl.value  = (d.txchannels||[]).map(c=>c.label||"").join(", ");
    inpRxLbl.value  = (d.rxchannels||[]).map(c=>c.name ||"").join(", ");
    modal.style.display="";
  }

  window.openDevEditModal = open;

  if(btnClose) btnClose.addEventListener("click", close);

  if(btnSave){
    btnSave.addEventListener("click", function(){
      var list = window.DA_DEVLIB.load();
      var idx = list.findIndex(x => String(x.id)===String(ctx.id));
      if(idx<0){ close(); return; }
      var d = list[idx];

      d.manufacturer_name = inpVendor.value.trim();
      d.model_name        = inpModel.value.trim();
      d.name              = inpName.value.trim();
      d.notes             = inpNotes.value.trim();

      // TX/RX Labels neu setzen
      var txArr = (inpTxLbl.value||"").split(",").map(s=>s.trim()).filter(Boolean);
      var rxArr = (inpRxLbl.value||"").split(",").map(s=>s.trim()).filter(Boolean);
      d.txchannels = txArr.map((label,i)=>({ danteId: (d.txchannels && d.txchannels[i] ? d.txchannels[i].danteId : (i+1)), label }));
      d.rxchannels = rxArr.map((name,i)=>({ danteId: (d.rxchannels && d.rxchannels[i] ? d.rxchannels[i].danteId : (i+1)), name }));

      window.DA_DEVLIB.save(list);
      window.DA_DEVLIB.renderSidebarList("#devSidebarBody");
      close();
    });
  }

  if(btnDelete){
    btnDelete.addEventListener("click", function(){
      var list = window.DA_DEVLIB.load();
      var idx = list.findIndex(x => String(x.id)===String(ctx.id));
      if(idx>=0){ list.splice(idx,1); window.DA_DEVLIB.save(list); window.DA_DEVLIB.renderSidebarList("#devSidebarBody"); }
      close();
    });
  }
})();

// Helper: Virtual-Badge anhand des Namens setzen (idempotent)
function applyVirtualBadge(td, fullName){
  if (!td) return;
  var old = td.querySelector(".badge-virtual");
  if (old) old.remove();
  try{
    if (isVirtualName && isVirtualName(fullName)) {
      var badge = document.createElement("span");
      badge.className = "badge-virtual";
      badge.textContent = "Virtual";
      td.appendChild(badge);
    }
  }catch(_){}
}


// ---- Tables ----
function fillPresetTable(xml){
  var tbody = $("#presetTable tbody"); if(!tbody) return;
  tbody.innerHTML = "";

  // Geräte sammeln (robust für verschiedene Preset-Wurzeln)
  var devs = Array.prototype.slice.call(xml.querySelectorAll("preset > device"));
  if (devs.length === 0) devs = Array.prototype.slice.call(xml.querySelectorAll("device"));

  devs.forEach(function(d){
    var nameEl = d.querySelector("name");
    var name = nameEl && nameEl.textContent ? nameEl.textContent.trim() : "(ohne Name)";
    var tx = d.querySelectorAll("txchannel").length;
    var rx = d.querySelectorAll("rxchannel").length;

    var tr = document.createElement("tr");

    // --- Namezelle (nur Anzeige; Prefix/Suffix-Stack) ---
    var tdName = document.createElement("td");
    tdName.className = "preset-name";
    tdName.dataset.role = "preset-name";
    tdName.dataset.fullname = name; // für Aktionen (Löschen/Ersetzen)

    if (isNameConceptEnabled()) {
      var parts = splitName(name || "");
      var wrap  = document.createElement("span"); wrap.className = "name-stack";
      var top   = document.createElement("span"); top.className  = "name-prefix";
      var bot   = document.createElement("span"); bot.className  = "name-suffix";

      // Bindestrich in der oberen Zeile nur, wenn Suffix existiert
      top.textContent = parts.prefix + (parts.suffix ? "-" : "");
      bot.textContent = parts.suffix || "";

      wrap.appendChild(top);
      if (parts.suffix) wrap.appendChild(bot);
      tdName.appendChild(wrap);
    } else {
      // Namenskonzept AUS: einzeilig
      tdName.textContent = name || "";
    }
    applyVirtualBadge(tdName, name);

    var tdTx = document.createElement("td");
    tdTx.textContent = tx;

    var tdRx = document.createElement("td");
    tdRx.textContent = rx;

    // Aktionen: 3-Punkte-Menü (Dropdown)
    var tdAct = document.createElement("td");
    var menu = document.createElement("div");
    menu.className = "menu";

    var toggle = document.createElement("button");
    toggle.className = "btn menu-toggle";
    toggle.type = "button";
    toggle.title = "Aktionen";
    toggle.textContent = "⋯";

    var list = document.createElement("div");
    list.className = "menu-list";

    // Menüeintrag: Löschen
    var btnDelete = document.createElement("button");
    btnDelete.className = "menu-item";
    btnDelete.type = "button";
    btnDelete.textContent = "Löschen";

    btnDelete.addEventListener("click", function(ev){
      try { ensurePresetEnvelope(lastXmlDoc); } 
        catch(_){}
      closeAllMenus();
      // Bestätigung (mit „Nicht mehr anzeigen“-Option)
      confirmDeleteWithSkip(name).then(function(ok){
        if (ok) deleteDeviceByName(name);
      }).catch(function(){ /* abgebrochen */ });
    });
    // Menüeintrag: Gerät ersetzen
    var btnReplace = document.createElement("button");
    btnReplace.className = "menu-item";
    btnReplace.type = "button";
    btnReplace.textContent = "Gerät ersetzen";
    btnReplace.addEventListener("click", function(){
      closeAllMenus();
      try { ensurePresetEnvelope(lastXmlDoc); } catch(_){}
      openReplaceDeviceDialog(name);
    });

    // --- Neues Menü-Item: Suffix festlegen… ---
    // 'menuList' ist der Container deiner Menüeinträge (ul/div o.ä.)
    // Falls du Items als Buttons erzeugst, bleib konsistent:
    var miDefineSuffix = document.createElement("button");
    miDefineSuffix.className = "menu-item";
    miDefineSuffix.textContent = "Suffix festlegen…";
    miDefineSuffix.addEventListener("click", function(){
      closeAllMenus && closeAllMenus();
      var currentName = tdName.dataset.fullname || name;
      window.openDefineSuffixDialog(currentName);
    });

    list.appendChild(miDefineSuffix);
    list.appendChild(btnReplace);
    list.appendChild(btnDelete);
    menu.appendChild(toggle);
    menu.appendChild(list);
    tdAct.appendChild(menu);

    // Toggle Öffnen/Schließen
    toggle.addEventListener("click", function(ev){
      ev.stopPropagation();
      // Erst alle anderen schließen
      closeAllMenus();
      menu.classList.toggle("open");
    });

    tr.appendChild(tdName);
    tr.appendChild(tdTx);
    tr.appendChild(tdRx);
    tr.appendChild(tdAct);

    tbody.appendChild(tr);
  });

  var be = $("#btnExport"); if(be) be.disabled = devs.length === 0;
  var bm = $("#btnMatrix"); if(bm) bm.disabled = devs.length === 0;
}



function fillOnlineTable(list){
  var tbody = $("#onlineTable tbody"); if(!tbody) return;
  tbody.innerHTML="";
  list.forEach(function(dev){
    var name = dev && dev.name ? dev.name : "";
    var ip = dev && dev.ip ? dev.ip : "";
    var man = dev && dev.manufacturer ? dev.manufacturer : "";
    tbody.insertAdjacentHTML("beforeend", rowHtml([name, ip, man]));
  });
  var oi=$("#onlineInfo"); if(oi) oi.textContent = (list && list.length) ? "Gefundene Geräte" : "Keine Geräte gefunden";
}

// ---- Storage Helpers ----
function writePresetToSession(xmlString){
  try { sessionStorage.setItem(SKEY_XML,  xmlString); } catch(_) {}
  try { sessionStorage.setItem(SKEY_META, JSON.stringify({ ts: Date.now() })); } catch(_) {}
  try { window.name = JSON.stringify({ type:"DA_PRESET", xml: xmlString, ts: Date.now() }); } catch(_) {}
}
function readFromSession(){
  var xml = null; try { xml = sessionStorage.getItem(SKEY_XML); } catch(_) {}
  return xml;
}

// ---- Datei laden → Session + UI ----
(function bindFileInput(){
  var fi = $("#fileInput"); if(!fi) return;
  fi.addEventListener("change", function(e){
    var f = e.target && e.target.files ? e.target.files[0] : null; if(!f) return;
    var reader = new FileReader();
    reader.onload = function(ev){
      try{
        var t = String(ev.target.result || "");
        var doc = parseXml(t);
          lastXmlDoc = doc;
          fillPresetTable(lastXmlDoc);
          try { window.DA_DEVLIB.renderSidebarList("#devSidebarBody", lastXmlDoc); } catch(_){}
          var xml = new XMLSerializer().serializeToString(lastXmlDoc);
          writePresetToSession(xml);
      }catch(err){ alert(err.message || String(err)); }
    };
    reader.readAsText(f);
  });
})();

// === Einstellungen (Gear) ===
(function(){
  var btn = document.getElementById("btnSettings");
  var menu = document.getElementById("settingsMenu");
  var chk = document.getElementById("chkNameConcept");
  if (!menu || !chk) return;

  // Init
  try { chk.checked = isNameConceptEnabled(); } catch(_){}

  // Toggle open/close
  if (btn){
    btn.addEventListener("click", function(ev){
      ev.stopPropagation();
      if (typeof closeAllMenus === "function") closeAllMenus();
      menu.classList.toggle("open");
    });
  }

  // Persist + Re-Render der Preset-Tabelle
  chk.addEventListener("change", function(e){
    setNameConceptEnabled(!!e.target.checked);
    if (lastXmlDoc) fillPresetTable(lastXmlDoc);
  });

  // Click außerhalb schließt Menü
  document.addEventListener("click", function(){ menu.classList.remove("open"); });
})();


// ---- Export ----

// === Namenskonzept (global) ===
var NAME_SCHEME_KEY = "DA_NAME_SCHEME_ENABLED";
function isNameConceptEnabled(){ try { return localStorage.getItem(NAME_SCHEME_KEY) === "1"; } catch(_) { return false; } }
function setNameConceptEnabled(on){ try { localStorage.setItem(NAME_SCHEME_KEY, on ? "1" : "0"); } catch(_) {} }
function splitName(full){
  var s = String(full || "").trim();
  if (!s) return { prefix: "", suffix: "" };

  // Kandidaten: alle Vorkommen von "-<Ziffern>"
  // Wir wählen das rechteste, hinter dem im restlichen String noch "-<Buchstabe>" vorkommt.
  var idxCandidate = -1;
  var re = /-(\d+)/g, m;
  while ((m = re.exec(s))) {
    var afterNumIdx = re.lastIndex;        // Position direkt NACH den Ziffern
    var rest = s.slice(afterNumIdx);       // Rest danach
    if (/-[A-Za-z]/.test(rest)) {          // nur Kandidaten akzeptieren, wenn später ein "-<Buchstabe>" folgt
      idxCandidate = afterNumIdx;
    }
  }

  if (idxCandidate !== -1) {
    // Erwartet: direkt danach kommt ein '-' als Trenner zum Suffix
    if (s.charAt(idxCandidate) === '-') {
      return { prefix: s.slice(0, idxCandidate), suffix: s.slice(idxCandidate + 1) };
    }
    // Falls kein '-' folgt (unerwartet): Fallback auf einfachen Split
  }

  // Kein valider [n]-Anker mit folgendem Suffix → Fallback: letzter Bindestrich trennt
  var idx = s.lastIndexOf("-");
  if (idx < 0) return { prefix: s, suffix: "" };
  return { prefix: s.slice(0, idx), suffix: s.slice(idx + 1) };
}
function joinName(prefix, suffix){
  prefix = String(prefix||""); suffix = String(suffix||"");
  return suffix ? (prefix + "-" + suffix) : prefix;
}

// --- Preset-Tabelle: Name-Stack Renderer ---
function renderNameStackNode(fullName, opts){
  opts = opts || {};
  var parts = splitName(fullName || "");
  // Wenn Namenskonzept AUS -> einzeilig
  if (!isNameConceptEnabled()){
    var span = document.createElement("span");
    span.textContent = fullName || "";
    if (opts.editable){
      span.className = "editable";
      span.contentEditable = "true";
      if (opts.onApply) bindInlineEdit(span, opts.onApply);
    }
    return span;
  }
  // Namenskonzept AN -> zweizeilig Prefix/Suffix
  var wrap  = document.createElement("span"); wrap.className = "name-stack";
  var top   = document.createElement("span"); top.className  = "name-prefix"; top.textContent = parts.prefix || "";
  var bot   = document.createElement("span"); bot.className  = "name-suffix";
  bot.textContent = parts.suffix || "";
  if (opts.editable){
    bot.classList.add("editable");
    bot.contentEditable = "true";
    if (opts.onApply){
      bindInlineEdit(bot, function(v){
        // Nur Suffix ändern
        var newFull = joinName(parts.prefix, v);
        opts.onApply(newFull, v); // (voller Name, Suffix)
      });
    }
  }
  wrap.appendChild(top); wrap.appendChild(bot);
  return wrap;
}

// Kleine Edit-Bindung für Inline-Apply
function bindInlineEdit(el, apply){
  var done = false;
  function finish(){
    if(done) return;
    done = true;
    el.removeEventListener("blur", onBlur);
    el.removeEventListener("keydown", onKey);
    var val = (el.textContent||"").trim();
    apply(val);
  }
  function onBlur(){ finish(); }
  function onKey(e){ if(e.key === "Enter"){ e.preventDefault(); el.blur(); } }
  el.addEventListener("blur", onBlur);
  el.addEventListener("keydown", onKey);
}

// Dekoriert die Namen in der Preset-Tabelle zu Prefix/Suffix-Stack
function decoratePresetTableNames(){
  // Versuche gängige Selektoren (bitte ggf. anpassen):
  var roots = document.querySelectorAll(".preset-table, #tblPresets, table[data-role='presets']");
  if (!roots.length) return;

  roots.forEach(function(root){
    // Name-Spalte finden: td/ span mit Datenrolle oder Klassen
    var cells = root.querySelectorAll("[data-role='preset-name'], td.preset-name, td.col-name, td.name");
    cells.forEach(function(td){
      var fullName = td.dataset.fullname || td.textContent.trim();
      // Ersetze Inhalt
      td.innerHTML = "";
      // Falls du hier direkt speichern willst, onApply an dein Rename hängen:
      var stack = renderNameStackNode(fullName, {
        editable: true,
        onApply: function(newFull){
          // Optional: hier deine Umbenennung für Presetliste
          td.dataset.fullname = newFull;
          td.textContent = ""; td.appendChild(renderNameStackNode(newFull, { editable:true, onApply: arguments.callee }));
          // Falls es eine persistente Quelle gibt, hier aufrufen (z. B. savePresetName(...))
        }
      });
      td.appendChild(stack);
    });
  });
}


// Settings-Menü in der Topbar
(function bindSettingsMenu(){
  var btn = document.getElementById("btnSettings");
  var wrap = document.getElementById("settingsMenu");
  var chk = document.getElementById("chkNameConcept");
  if (!wrap || !chk) return;
  // init
  try { chk.checked = isNameConceptEnabled(); } catch(_){}
  // open/close
  if (btn){
    btn.addEventListener("click", function(ev){
      ev.stopPropagation();
      closeAllMenus();
      wrap.classList.toggle("open");
    });
  }
  // persist
  chk.addEventListener("change", function(e){
    setNameConceptEnabled(!!e.target.checked);
    // Darstellung sofort aktualisieren:
    decoratePresetTableNames();
  });
})();

// -- Schließe alle offenen 3-Punkte-Menüs (Dropdowns) --
function closeAllMenus(){
  try {
    document.querySelectorAll(".menu.open").forEach(function(m){ m.classList.remove("open"); });
  } catch(_){}
}

// Globale Click-Handler: Klick außerhalb schließt Menüs
(function enableGlobalMenuCloser(){
  document.addEventListener("click", function(){
    closeAllMenus();
  });
  // ESC schließt ebenfalls
  document.addEventListener("keydown", function(e){
    if (e.key === "Escape") closeAllMenus();
  });
})();

// Delete-Bestätigung mit „Nicht mehr anzeigen“
var DEL_CONFIRM_SKIP_KEY = "DA_SKIP_DELETE_CONFIRM";

function confirmDeleteWithSkip(deviceName){
  return new Promise(function(resolve, reject){
    try{
      var skip = false;
      try { skip = localStorage.getItem(DEL_CONFIRM_SKIP_KEY) === "1"; } catch(_){}
      if (skip) { resolve(true); return; }

      var host = document.createElement("div");
      host.className = "modal-confirm";
      host.innerHTML = ''+
        '<div class="card">'+
          '<div class="hdr">Löschen bestätigen</div>'+
          '<div class="body">'+
            '<div class="row">Willst du das wirklich tun?<br><strong>'+escapeHtml(deviceName)+'</strong> wird aus dem Preset entfernt.</div>'+
            '<label class="row chk"><input id="chkDeleteSkip" type="checkbox"> Diese Abfrage nicht mehr anzeigen</label>'+
          '</div>'+
          '<div class="ftr">'+
            '<button id="btnDelCancel" class="btn">Abbrechen</button>'+
            '<button id="btnDelOk" class="btn btn-danger">Löschen</button>'+
          '</div>'+
        '</div>';

      document.body.appendChild(host);

      function cleanup(){ try{ document.body.removeChild(host); }catch(_){ } }

      host.querySelector("#btnDelCancel").addEventListener("click", function(){
        cleanup(); reject();
      });
      host.querySelector("#btnDelOk").addEventListener("click", function(){
        var c = host.querySelector("#chkDeleteSkip");
        if (c && c.checked) { try { localStorage.setItem(DEL_CONFIRM_SKIP_KEY, "1"); } catch(_){ } }
        cleanup(); resolve(true);
      });

    }catch(err){
      // Fallback: normales confirm
      var ok = window.confirm("Gerät „"+deviceName+"“ wirklich löschen?");
      if (ok) resolve(true); else reject();
    }
  });
}

// kleine Helper-Funktion für HTML-Escapes
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, function(c){
    return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]);
  });
}

// Gerät aus dem Preset entfernen und speichern
function deleteDeviceByName(deviceName){
  if (!deviceName) return;
  var doc = lastXmlDoc;
  try {
    if (!doc) {
      var s = readFromSession();
      if (s) doc = parseXml(s);
    }
    if (!doc) { alert("Kein Preset geladen."); return; }

    var all = Array.prototype.slice.call(doc.getElementsByTagName("device"));
    var target = all.find(function(d){
      var n = d.querySelector("name");
      return n && n.textContent && n.textContent.trim() === deviceName;
    });

    if (!target) { alert("Gerät nicht gefunden: " + deviceName); return; }

    // Sicherheitsabfrage
    var ok = window.confirm("Gerät „" + deviceName + "“ wirklich löschen?");
    if (!ok) return;

    target.parentNode.removeChild(target);

    // Persistieren & UI aktualisieren
    lastXmlDoc = doc;
    writePresetToSession(new XMLSerializer().serializeToString(lastXmlDoc));
    fillPresetTable(lastXmlDoc);
  } catch (err) {
    console.error(err);
    alert(err.message || String(err));
  }
}
  // Benennt ein Gerät im aktuellen Preset um und passt RX-Subscriptions an.
  // Erwartet volle Namen: oldName = alter vollständiger Gerätename, newName = neuer vollständiger Gerätename.
  function renameDeviceInPreset(oldName, newName){
    // Doku / Fallbacks
    var doc = (typeof lastXmlDoc !== "undefined" && lastXmlDoc) ? lastXmlDoc : null;
    if (!doc) {
      try {
        var xml = sessionStorage.getItem("DA_PRESET_XML");
        if (xml) {
          doc = new DOMParser().parseFromString(xml, "application/xml");
          window.lastXmlDoc = doc;
        }
      } catch(_) {}
    }
    if (!doc) { alert("Kein Preset geladen."); return; }

    oldName = String(oldName || "").trim();
    newName = String(newName || "").trim();
    if (!oldName || !newName || oldName === newName) return;

    // Gerät per Namen finden
    var devEls = Array.prototype.slice.call(doc.querySelectorAll("preset > device, device"));
    var dev = null;
    for (var i=0; i<devEls.length; i++){
      var nEl = devEls[i].querySelector("name");
      var t   = nEl && nEl.textContent ? nEl.textContent.trim() : "";
      if (t === oldName) { dev = devEls[i]; break; }
    }
    if (!dev) { alert("Gerät nicht gefunden: " + oldName); return; }

    // Name aktualisieren
    var nameEl = dev.querySelector("name");
    if (!nameEl) { nameEl = doc.createElement("name"); dev.insertBefore(nameEl, dev.firstChild); }
    nameEl.textContent = newName;

    // RX-Subscriptions umbiegen
    var rxEls = Array.prototype.slice.call(doc.getElementsByTagName("rxchannel"));
    rxEls.forEach(function(rx){
      var sd = rx.querySelector("subscribed_device");
      if (sd && (sd.textContent || "").trim() === oldName) {
        sd.textContent = newName;
      }
    });

    // Persistieren
    try {
      var s = new XMLSerializer().serializeToString(doc);
      try { sessionStorage.setItem("DA_PRESET_XML", s); } catch(_) {}
    } catch(_) {}

    // UI neu aufbauen
    if (typeof fillPresetTable === "function") fillPresetTable(doc);
  }


// ===== Replace-Device: Helpers =====
function getDeviceElByName(doc, deviceName){
  var devs = Array.prototype.slice.call(doc.getElementsByTagName("device"));
  return devs.find(function(d){
    var n = d.querySelector("name");
    return n && n.textContent && n.textContent.trim() === deviceName;
  }) || null;
}

// Eindeutigkeit prüfen (anderen gleichnamigen Device ausschließen können)
function deviceNameExists(doc, name, excludeName){
  var devs = Array.prototype.map.call(doc.getElementsByTagName('device'), function(d){
    var n = d.querySelector('name');
    return n && n.textContent ? n.textContent.trim() : '';
  });
  return devs.some(function(nm){
    if (!nm) return false;
    if (excludeName && nm === excludeName) return false;
    return nm === name;
  });
}

// Globale Namensgenerator-Funktion: pattern + [n]/{n}/<n>, optional excludeName ausnehmen
if (typeof window.generateUniqueNameFromPattern !== "function") {
  window.generateUniqueNameFromPattern = function(pattern, doc, excludeName) {
    var pat = String(pattern || "Device-[n]");
    var hasToken = /\[(?:n|N)\]|\{(?:n|N)\}|<(?:n|N)>/.test(pat);

    function makeName(n) {
      var out = pat.replace(/\[(?:n|N)\]|\{(?:n|N)\}|<(?:n|N)>/g, String(n));
      if (!hasToken) out = out + "-" + String(n); // kein Token → -n anhängen
      return out;
    }

    function exists(name) {
      return Array.prototype.some.call(
        doc.getElementsByTagName("device"),
        function(d) {
          var nmEl = d.querySelector("name");
          var nm = nmEl && nmEl.textContent ? nmEl.textContent.trim() : "";
          if (!nm) return false;
          if (excludeName && nm === excludeName) return false;
          return nm === name;
        }
      );
    }

    var n = 1, candidate = makeName(n);
    while (exists(candidate)) {
      n++;
      candidate = makeName(n);
    }
    return candidate;
  };
}


// Bei Bedarf eindeutigen Namen erzeugen (Pattern-basiert oder einfache -n-Anhängung)
function ensureUniqueDeviceName(baseName, doc, excludeName, fallbackPattern){
  if (!deviceNameExists(doc, baseName, excludeName)) return baseName;

  // Prefer Pattern, falls vorhanden
  var pat = fallbackPattern || 'Device-[n]';
  if (typeof generateUniqueNameFromPattern === 'function') {
    // generateUniqueNameFromPattern prüft das gesamte Doc → liefert freien Namen
    return generateUniqueNameFromPattern(pat, doc);
  }

  // Fallback: einfache "-n" Anhängung
  var n = 2;
  var candidate = baseName + '-' + n;
  while (deviceNameExists(doc, candidate, excludeName)) {
    n++;
    candidate = baseName + '-' + n;
  }
  return candidate;
}

// Alle RX-Subscriptions im Preset sammeln
function collectAllRxSubscriptions(doc){
  var out = [];
  var rxEls = Array.prototype.slice.call(doc.getElementsByTagName("rxchannel"));
  rxEls.forEach(function(rx){
    var sd = rx.querySelector("subscribed_device");
    var sc = rx.querySelector("subscribed_channel");
    var rxNameEl = rx.querySelector("name");
    var rxDevEl = rx.parentNode && rx.parentNode.querySelector && rx.parentNode.querySelector(":scope > name");
    out.push({
      rxEl: rx,
      rxDevName: rxDevEl ? (rxDevEl.textContent||"").trim() : "",
      rxChanName: rxNameEl ? (rxNameEl.textContent||"").trim() : "",
      subDev: sd ? (sd.textContent||"").trim() : "",
      subChan: sc ? (sc.textContent||"").trim() : ""
    });
  });
  return out;
}


function txLabelsFromModel(model){
  var arr = (model && model.device_defaults && Array.isArray(model.device_defaults.txchannels))
    ? model.device_defaults.txchannels : [];
  var set = new Set();
  arr.forEach(function(c){ if (c && c.label != null) set.add(String(c.label)); });
  return set;
}
function rxIdsFromModel(model){
  var arr = (model && model.device_defaults && Array.isArray(model.device_defaults.rxchannels))
    ? model.device_defaults.rxchannels : [];
  var set = new Set();
  arr.forEach(function(c){ if (c && c.danteId != null) set.add(String(c.danteId)); });
  return set;
}
function removeSubscriptionOnRx(rxEl){
  if (!rxEl) return;
  var sd = rxEl.querySelector("subscribed_device");
  var sc = rxEl.querySelector("subscribed_channel");
  if (sd) try { rxEl.removeChild(sd); } catch(_){}
  if (sc) try { rxEl.removeChild(sc); } catch(_){}
}
function buildDeviceFromModel(modelId, keepName){
  if (!window.DA_LIB || !DA_LIB.makeDeviceXml) throw new Error("DA_LIB.makeDeviceXml nicht verfügbar");
  var xmlText = DA_LIB.makeDeviceXml(modelId, { name: keepName || "" });
  var doc = new DOMParser().parseFromString("<root>"+xmlText+"</root>","application/xml");
  var dev = doc.querySelector("device");
  if (!dev) throw new Error("Modell erzeugte kein <device>");
  // Name sicherstellen (falls im Modell leer)
  var n = dev.querySelector("name");
  if (!n){
    n = doc.createElement("name");
    n.textContent = keepName || "";
    dev.insertBefore(n, dev.firstChild);
  } else if (keepName) {
    n.textContent = keepName;
  }
  return dev;
}

// ---- Replace-Helpers: TX/RX aus Device-Element lesen + Mapping ----
function txLabelsFromDeviceEl(devEl){
  var out = [];
  if (!devEl) return out;
  var list = devEl.getElementsByTagName("txchannel");
  for (var i=0;i<list.length;i++){
    var lab = list[i].querySelector("label");
    out.push(lab && lab.textContent ? lab.textContent.trim() : "");
  }
  return out;
}
function rxInfosFromDeviceEl(devEl){
  var out = [];
  if (!devEl) return out;
  var list = devEl.getElementsByTagName("rxchannel");
  for (var i=0;i<list.length;i++){
    var rx = list[i];
    var id = String(rx.getAttribute("danteId") || "");
    var nmEl = rx.querySelector("name");
    var sdEl = rx.querySelector("subscribed_device");
    var scEl = rx.querySelector("subscribed_channel");
    out.push({
      el: rx,
      id: id,
      name: nmEl ? (nmEl.textContent||"").trim() : "",
      subDev: sdEl ? (sdEl.textContent||"").trim() : "",
      subChan: scEl ? (scEl.textContent||"").trim() : ""
    });
  }
  return out;
}
// mappt altes TX-Label auf neues TX-Label (identisch → gleich, sonst positionsbasiert)
function mapTxLabel(oldLabel, oldLabels, newLabels){
  if (!oldLabel) return null;
  // 1) identischer Name vorhanden?
  var j = newLabels.indexOf(oldLabel);
  if (j >= 0) return newLabels[j];
  // 2) positionsbasiert (nur wenn Label in alter Liste vorhanden)
  var i = oldLabels.indexOf(oldLabel);
  if (i >= 0 && i < newLabels.length) return newLabels[i];
  // 3) kein Mapping möglich
  return null;
}


// ===== Replace-Device: Dialog + Ablauf =====
function openReplaceDeviceDialog(deviceName){
  var modal = document.getElementById("replaceDeviceModal");
  if (!modal) { alert("Dialog fehlt in HTML."); return; }
  var tb = modal.querySelector("#repModelTable tbody");
  var conflictsWrap = modal.querySelector("#repConflictsWrap");
  var conflictsBody = modal.querySelector("#repConflictsTable tbody");
  var btnDo = modal.querySelector("#repDoReplace");
  var info = modal.querySelector("#repCurrent");
  var filter = modal.querySelector("#repFilter");

  info.textContent = "Ersetze: " + deviceName;
  conflictsWrap.style.display = "none";
  conflictsBody.innerHTML = "";
  btnDo.disabled = true;

  // Liste laden
  var models = [];
  try { models = (DA_LIB && DA_LIB.listModels) ? DA_LIB.listModels() : []; } catch(_){ models = []; }

  function applyFilter(){
    var f = (filter && filter.value) ? filter.value.trim().toLowerCase() : "";
    tb.innerHTML = "";
    var cnt = 0;
    models.forEach(function(m){
      var ven = (m.manufacturer_name||"");
      var mod = (m.model_name||"");
      var pat = (m.device_defaults && m.device_defaults.name_pattern) ? m.device_defaults.name_pattern : "";
      var txN = m.txCount|0, rxN = m.rxCount|0;
      var sig = (ven+" "+mod+" "+pat+" "+txN+"x"+rxN).toLowerCase();
      if (f && sig.indexOf(f) < 0) return;

      var tr = document.createElement("tr");
      tr.innerHTML = "<td>"+escapeHtml(ven)+"</td>"+
                     "<td>"+escapeHtml(mod)+"</td>"+
                     "<td>"+txN+"×"+rxN+"</td>"+
                     "<td>"+escapeHtml(pat)+"</td>"+
                     "<td><button class='btn' data-mid='"+escapeHtml(m.id)+"'>Wählen</button></td>";
      tb.appendChild(tr);
      cnt++;
    });
    if (!cnt) {
      var tr = document.createElement("tr");
      tr.innerHTML = "<td colspan='5' class='muted'>Keine Modelle gefunden.</td>";
      tb.appendChild(tr);
    }
  }
  applyFilter();
  if (filter) filter.oninput = applyFilter;

  function close(){ modal.style.display = "none"; }
  modal.querySelector('[data-role="rep-close"]').onclick = close;
  modal.querySelector('[data-role="rep-cancel"]').onclick = close;

  // Auswahl-Handler (delegiert)
  tb.onclick = function(ev){
    var t = ev.target;
    if (!t || t.tagName !== "BUTTON" || !t.dataset.mid) return;
    var modelId = t.dataset.mid;
    // Konflikte berechnen und anzeigen
    try {
      ensurePresetEnvelope(lastXmlDoc);
      var targetDev = getDeviceElByName(lastXmlDoc, deviceName);
      if (!targetDev) { alert("Gerät nicht gefunden: "+deviceName); return; }

      // Neu-Modell lesen
      var m = (DA_LIB.listModels() || []).find(function(x){ return x.id === modelId; });
      if (!m) { alert("Modell nicht gefunden."); return; }

      var txSet = txLabelsFromModel(m);
      var rxIdSet = rxIdsFromModel(m);

      // 1) Abos, die ANDERE auf dieses Gerät (als TX-Quelle) gesetzt haben:
      var subs = collectAllRxSubscriptions(lastXmlDoc);
      var conflicts = [];
      subs.forEach(function(su){
        if (su.subDev === deviceName) {
          if (!txSet.has(su.subChan)) {
            conflicts.push({
              rxDev: su.rxDevName, rxChan: su.rxChanName,
              txDev: deviceName,   txChan: su.subChan || "(leer)",
              reason: "TX-Kanal im neuen Gerät nicht vorhanden"
            });
          }
        }
      });

      // 2) Abos, die dieses Gerät (als RX) gesetzt hat → RX-Kanäle, die es im neuen Modell nicht gibt (per danteId)
      //    (Wir prüfen RX-Elemente innerhalb des Geräts)
      var rxEls = Array.prototype.slice.call(targetDev.getElementsByTagName("rxchannel"));
      rxEls.forEach(function(rx){
        var id = String(rx.getAttribute("danteId") || "");
        if (!id) return;
        if (!rxIdSet.has(id)) {
          var sd = rx.querySelector("subscribed_device");
          var sc = rx.querySelector("subscribed_channel");
          if (sd || sc) {
            var rxNameEl = rx.querySelector("name");
            conflicts.push({
              rxDev: deviceName,
              rxChan: rxNameEl ? (rxNameEl.textContent||"").trim() : ("RX "+id),
              txDev: sd ? (sd.textContent||"").trim() : "(leer)",
              txChan: sc ? (sc.textContent||"").trim() : "(leer)",
              reason: "RX-Kanal im neuen Gerät nicht vorhanden"
            });
          }
        }
      });

      // Anzeige
      conflictsBody.innerHTML = "";
      if (conflicts.length) {
        conflictsWrap.style.display = "";
        conflicts.forEach(function(c){
          var tr = document.createElement("tr");
          tr.innerHTML =
            "<td>"+escapeHtml(c.rxDev)+"</td>"+
            "<td>"+escapeHtml(c.rxChan)+"</td>"+
            "<td style='text-align:center'>↔︎</td>"+
            "<td>"+escapeHtml(c.txDev)+"</td>"+
            "<td>"+escapeHtml(c.txChan)+"</td>"+
            "<td class='muted'>"+escapeHtml(c.reason)+"</td>";
          conflictsBody.appendChild(tr);
        });
      } else {
        conflictsWrap.style.display = "none";
      }

      // Enable Replace-Button und Merker
      btnDo.disabled = false;
      btnDo.dataset.mid = modelId;
      btnDo.dataset.dev = deviceName;

    } catch (e){
      console.error(e);
      alert(e.message || String(e));
    }
  };

  // Replace ausführen (verwerfen inkompatibler Abos)
btnDo.onclick = function(){
  var modelId = btnDo.dataset.mid;
  var devName = btnDo.dataset.dev;
  if (!modelId || !devName) return;

  try {
    ensurePresetEnvelope(lastXmlDoc);

    // Altgerät + Modell
    var targetDev = getDeviceElByName(lastXmlDoc, devName);
    if (!targetDev) { alert("Gerät nicht gefunden: " + devName); return; }

    var models = (DA_LIB && DA_LIB.listModels) ? DA_LIB.listModels() : [];
    var m = models.find(function(x){ return x.id === modelId; });
    if (!m) { alert("Modell nicht gefunden."); return; }

    // — A) Vorab: alte TX-Labels & eigene RX-Infos sichern (für spätere Übernahme) —
    var oldTxLabels = txLabelsFromDeviceEl(targetDev);      // exakte Reihenfolge/Bezeichnungen
    var oldRxInfos  = rxInfosFromDeviceEl(targetDev);       // inkl. sd/sc für jeden RX

// — B) Namen bestimmen (ggf. per Pattern eindeutig) —
var renameChecked = false;
// ID in deinem Dialog lautet repRenameByPattern
var chk = document.getElementById("repRenameByPattern");
if (chk && chk.checked) renameChecked = true;

// Pattern ermitteln: Lib bevorzugen, dann Modell, dann Fallback
var patFromLib = (window.DA_LIB && typeof window.DA_LIB.getNamePattern === "function")
  ? (window.DA_LIB.getNamePattern(modelId) || "")
  : "";
var pattern =
  patFromLib ||
  (m && m.device_defaults && m.device_defaults.name_pattern) ||
  m.name_pattern ||
  (m.naming && m.naming.pattern) ||
  m.pattern ||
  "Device-[n]";

var newName;
if (renameChecked) {
  if (isNameConceptEnabled()) {
    var partsOld = splitName(devName);
    var patternWithSuffix = partsOld.suffix ? (pattern + "-" + partsOld.suffix) : pattern;
    newName = window.generateUniqueNameFromPattern(patternWithSuffix, lastXmlDoc, /*excludeName*/ devName);
  } else {
    newName = window.generateUniqueNameFromPattern(pattern, lastXmlDoc, /*excludeName*/ devName);
  }
} else {
  // alten Namen unverändert lassen
  newName = devName;
}


    // — C) neues Device aus Modell erzeugen —
    var newDev = buildDeviceFromModel(modelId, newName);

    // — D) ersetzen —
    targetDev.parentNode.replaceChild(lastXmlDoc.importNode(newDev, true), targetDev);

    // — E) neue TX-/RX-Listen aufnehmen —
    var replacedDev = getDeviceElByName(lastXmlDoc, newName);

    // NEU: Checkbox „Kanalnamen aus Modell übernehmen“ (default: aus = alte Namen behalten)
    var useModelNames = !!(document.getElementById("repChannelNamesFromModel") &&
                          document.getElementById("repChannelNamesFromModel").checked);

    // Wenn Checkbox AUS → alte TX-Labels / RX-Namen positionsbasiert übernehmen
    if (!useModelNames) {
      // TX: alte Labels pro Index übernehmen
      var txListNew = replacedDev.getElementsByTagName("txchannel");
      for (var i = 0; i < txListNew.length; i++) {
        var lblEl = txListNew[i].querySelector("label");
        if (!lblEl) { lblEl = lastXmlDoc.createElement("label"); txListNew[i].appendChild(lblEl); }
        var oldLbl = (i < oldTxLabels.length) ? (oldTxLabels[i] || "") : "";
        if (oldLbl) lblEl.textContent = oldLbl;
      }

      // RX: alte Namen pro Index übernehmen
      var rxListNewForNames = replacedDev.getElementsByTagName("rxchannel");
      for (var j = 0; j < rxListNewForNames.length; j++) {
        var nameEl = rxListNewForNames[j].querySelector("name");
        if (!nameEl) { nameEl = lastXmlDoc.createElement("name"); rxListNewForNames[j].appendChild(nameEl); }
        var oldRxName = (j < oldRxInfos.length) ? (oldRxInfos[j].name || "") : "";
        if (oldRxName) nameEl.textContent = oldRxName;
      }
    }

    // WICHTIG: erst jetzt (nach möglicher Umbenennung) die neuen TX-Labels/ RX-Liste ermitteln,
    // damit das anschließende Mapping die gesetzten Labels berücksichtigt.
    var newTxLabels = txLabelsFromDeviceEl(replacedDev);
    var newRxList   = Array.prototype.slice.call(replacedDev.getElementsByTagName("rxchannel"));

    // — F) Inbound-Subscriptions (andere Geräte → dieses Gerät) umschreiben —
    var allRx = collectAllRxSubscriptions(lastXmlDoc);
    allRx.forEach(function(su){
      if (!su.rxEl) return;
      // auf dieses Gerät?
      if ((su.subDev || "") === devName) {
        // 1) subscribed_device → neuer Name
        var sd = su.rxEl.querySelector("subscribed_device");
        if (!sd) { sd = lastXmlDoc.createElement("subscribed_device"); su.rxEl.appendChild(sd); }
        sd.textContent = newName;

        // 2) subscribed_channel → per Label/Position mappen
        var mapped = mapTxLabel(su.subChan || "", oldTxLabels, newTxLabels);
        if (mapped) {
          var sc = su.rxEl.querySelector("subscribed_channel");
          if (!sc) { sc = lastXmlDoc.createElement("subscribed_channel"); su.rxEl.appendChild(sc); }
          sc.textContent = mapped;
        } else {
          // kein Mapping möglich → Abo verwerfen
          removeSubscriptionOnRx(su.rxEl);
        }
      }
    });

    // — G) Eigene RX-Subscriptions (dieses Gerät als Empfänger) übernehmen —
    if (oldRxInfos.length === newRxList.length) {
      // positionsbasiert kopieren
      for (var i=0; i<oldRxInfos.length; i++){
        var src = oldRxInfos[i];
        var dst = newRxList[i];
        if (!dst) continue;
        // nur übernehmen, wenn vorher überhaupt was gesetzt war
        if (src.subDev || src.subChan) {
          var sd2 = dst.querySelector("subscribed_device");
          var sc2 = dst.querySelector("subscribed_channel");
          if (!sd2) { sd2 = lastXmlDoc.createElement("subscribed_device"); dst.appendChild(sd2); }
          if (!sc2) { sc2 = lastXmlDoc.createElement("subscribed_channel"); dst.appendChild(sc2); }
          sd2.textContent = src.subDev || "";
          sc2.textContent = src.subChan || "";
        }
      }
    } else {
      // id-basiert: alte RX danteId → neue RX danteId
      var mapNewById = new Map();
      newRxList.forEach(function(rx){ mapNewById.set(String(rx.getAttribute("danteId")||""), rx); });
      oldRxInfos.forEach(function(src){
        if (!(src.subDev || src.subChan)) return; // nur aktive Abos übertragen
        var dst = mapNewById.get(String(src.id||""));
        if (!dst) return; // nicht vorhanden → entfällt
        var sd2 = dst.querySelector("subscribed_device");
        var sc2 = dst.querySelector("subscribed_channel");
        if (!sd2) { sd2 = lastXmlDoc.createElement("subscribed_device"); dst.appendChild(sd2); }
        if (!sc2) { sc2 = lastXmlDoc.createElement("subscribed_channel"); dst.appendChild(sc2); }
        sd2.textContent = src.subDev || "";
        sc2.textContent = src.subChan || "";
      });
    }

    // — H) Persist & UI —
    var xmlOut = new XMLSerializer().serializeToString(lastXmlDoc);
    writePresetToSession(xmlOut);
    fillPresetTable(lastXmlDoc);

    // schließen
    (function close(){ var modal = document.getElementById("replaceDeviceModal"); if (modal) modal.style.display = "none"; })();

  } catch(e){
    console.error(e);
    alert(e.message || String(e));
  }
};

  // Anzeigen
  modal.style.display = "flex";
}

(function setupDefineSuffixDialog(){
  var modal = document.getElementById("defineSuffixModal");
  if (!modal) return;

  var inpFull   = document.getElementById("dsFull");
  var inpSuffix = document.getElementById("dsSuffix");
  var btnTake   = document.getElementById("dsTakeSelection");
  var btnSave   = document.getElementById("dsSave");
  var prev      = document.getElementById("dsPreview");
  var btnClose1 = modal.querySelector("[data-role='ds-close']");
  var btnClose2 = modal.querySelector("[data-role='ds-cancel']");

  var ctx = { oldFull: "", basePrefix: "" };

  function updatePreview(){
    var suf = (inpSuffix.value || "").trim();
    var full = joinName(ctx.basePrefix, suf);
    prev.textContent = full;
  }

  btnTake.addEventListener("click", function(){
    var s = getSelectionInInput(inpFull);
    var full = inpFull.value || "";
    var sel = (s.text || "").trim();

    if (!sel) { alert("Bitte am Ende des Namens den Suffix markieren."); return; }
    if (!full.endsWith(sel)) { alert("Die Auswahl muss am Ende des Namens stehen."); return; }

    // führenden '-' bei der Auswahl entfernen
    var suffix = sel.replace(/^-/,"");
    // Prefix ist der Rest VOR der Auswahl; ein evtl. verbleibendes trailing '-' am Prefix entfernen
    var prefRaw = full.slice(0, full.length - sel.length);
    var basePref = prefRaw.replace(/-$/,"");

    ctx.basePrefix = basePref;
    inpSuffix.value = suffix;
    updatePreview();
  });

  [inpSuffix].forEach(function(el){
    el.addEventListener("input", updatePreview);
  });

  function open(fullName){
    ctx.oldFull = String(fullName || "");
    // Default-Vorschlag aus splitName
    var parts = splitName(ctx.oldFull);
    ctx.basePrefix = parts.prefix || "";
    inpFull.value = ctx.oldFull;
    inpSuffix.value = parts.suffix || "";
    updatePreview();
    modal.style.display = "flex";
  }

  function close(){
    modal.style.display = "none";
  }

  if (btnClose1) btnClose1.addEventListener("click", close);
  if (btnClose2) btnClose2.addEventListener("click", close);

  btnSave.addEventListener("click", function(){
    var newFull = prev.textContent || "";
    if (!newFull || newFull === ctx.oldFull){ close(); return; }
    // Umbenennen im Preset inkl. RX-Subs
    renameDeviceInPreset(ctx.oldFull, newFull);
    close();
  });

  // Expose
  window.openDefineSuffixDialog = open;
})();


(function bindExport(){
  var be = $("#btnExport"); if(!be) return;
  be.addEventListener("click", function(){
    if(!lastXmlDoc){
      var s = readFromSession(); if(s){ try{ lastXmlDoc = parseXml(s); }catch(_){} }
    }
    if(!lastXmlDoc){ alert("Bitte zuerst ein Preset laden."); return; }
    try { ensurePresetEnvelope(lastXmlDoc); } catch(_){}
    var content = serializeWithHeader(lastXmlDoc);
    var blob = new Blob([content], { type: "application/xml" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "ArchitectExport.xml";
    document.body.appendChild(a);
    a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 0);
  });
})();

// ---- Matrix Navigation (immer frischen Stand schreiben) ----
(function bindMatrix(){
  var bm = $("#btnMatrix"); if(!bm) return;
  bm.addEventListener("click", function(){
    var xml = null;
    if(lastXmlDoc) xml = new XMLSerializer().serializeToString(lastXmlDoc);
    if(!xml) xml = readFromSession();
    if(!xml){ alert("Kein Preset geladen."); return; }
    writePresetToSession(xml);
    location.href = "./Matrix.html#via=btn";
  });
})();

// ===== Dante Online Helper (mDNS via lokaler Node-Helper) =====
(function danteOnlineHelper(){
  const noop = ()=>{};
  const setLed = (typeof window.setLed === "function") ? window.setLed : noop;
  const setStatusText = (typeof window.setStatusText === "function") ? window.setStatusText : noop;
  const setSpinner = (typeof window.setSpinner === "function") ? window.setSpinner : noop;
  const setTimestamp = (typeof window.setTimestamp === "function") ? window.setTimestamp : noop;

  const fillOnlineTable = (typeof window.fillOnlineTable === "function")
    ? window.fillOnlineTable
    : function(list){
        const root = document.getElementById("onlineTable") || document.getElementById("online-list");
        if (!root) { console.debug("onlineTable not found; devices:", list); return; }
        const rows = (list||[]).map(d => `<tr><td>${d.name||""}</td><td>${d.ip||""}</td><td>${d.manufacturer||""}</td><td>${d.model||""}</td></tr>`).join("");
        root.innerHTML = `<table><thead><tr><th>Name</th><th>IP</th><th>Hersteller</th><th>Modell</th></tr></thead><tbody>${rows}</tbody></table>`;
      };

  const HELPER = { base: "http://localhost:53535", health: "/health", scan: "/scan" };
    
  // --- Online-Tabellenkopf: Count links, "Stand" rechts ---
function ensureOnlineHead(){
  const tbl = document.getElementById("onlineTable");
  if (!tbl) return {};
  const thead = tbl.tHead || tbl.createTHead();

  let row = document.getElementById("onlineHeadMetrics");
  if (!row) {
    row = document.createElement("tr");
    row.id = "onlineHeadMetrics";

    const thCount = document.createElement("th");
    thCount.id = "onlineCountHeader";
    thCount.colSpan = 3; // Tabelle hat 3 Spalten: Name, IP, Hersteller
    thCount.textContent = "Noch kein Scan";

    row.appendChild(thCount);
    thead.insertBefore(row, thead.firstChild || null);
  }
  return { countEl: document.getElementById("onlineCountHeader") };
}

  try {
    const headers = Array.from(document.querySelectorAll(".card .card-header"));
    const onlineHeader = headers.find(h => (h.querySelector(".card-title")?.textContent || "").trim() === "Online");
    if (onlineHeader) {
      const actions = onlineHeader.querySelector(".card-actions") || onlineHeader.appendChild(document.createElement("div"));
      actions.classList.add("card-actions");
      const btn = document.createElement("button");
      btn.id = "btnOnlineScan"; btn.className = "btn"; btn.textContent = "Scan";
      actions.appendChild(btn);
      const label = document.createElement("label");
      label.className = "chk"; label.style.marginLeft = "8px";
      label.innerHTML = `<input id="chkOnlineAuto" type="checkbox"> Auto`;
      actions.appendChild(label);
    }
  } catch(_){}

    async function health(opts = { silent: false }) {
      try {
        if (!opts.silent) setSpinner(true);
        const r = await fetch(HELPER.base + HELPER.health, { cache: "no-store" });
        if (!r.ok) throw new Error("health " + r.status);
        await r.json();
        setLed("connected");
        setStatusText("Helper verbunden");
        // Wichtig: Stand NICHT hier aktualisieren
        return true;
      } catch {
        setLed("disconnected");
        setStatusText("Offline");
        return false;
      } finally {
        if (!opts.silent) setSpinner(false);
      }
    }

async function scanOnce() {
  const { countEl, standEl } = ensureOnlineHead();

  const ok = await health(); // sichtbarer Ping
  if (!ok) {
    fillOnlineTable([]);
    if (countEl) countEl.textContent = "Noch kein Scan";
    // "Stand" NICHT ändern (nur bei Scan-Erfolg)
    return;
  }

  try {
    setSpinner(true);
    const r = await fetch(`${HELPER.base + HELPER.scan}?timeout=5000&ipver=4`, { cache: "no-store" });
    const j = await r.json();
    const list = Array.isArray(j?.devices) ? j.devices : [];
    fillOnlineTable(list);

    if (countEl) countEl.textContent = `${list.length} Geräte`;
    // "letzter Scan" steht jetzt mittig in der Statuszeile:
    setTimestamp(j.ts || Date.now());
  } catch (e) {
    console.error(e);
    fillOnlineTable([]);
    if (countEl) countEl.textContent = "0 Geräte";
    // "Stand" NICHT ändern
  } finally {
    setSpinner(false);
  }
}

  (function bind(){
    ensureOnlineHead();
    const btn = document.getElementById("btnOnlineScan");
    const chk = document.getElementById("chkOnlineAuto");
    if (btn) btn.addEventListener("click", scanOnce);
    let timer = null;
    if (chk) {
      chk.addEventListener("change", (e) => {
        if (e.target.checked) {
          scanOnce();
          timer = setInterval(scanOnce, 10000);
        } else if (timer) {
          clearInterval(timer); timer = null;
        }
      });
    }
    health();
    // Status (LED/Text) alle 22s aktualisieren – ohne Spinner, ohne Stand
    setInterval(() => health({ silent: true }), 2000);
  })();
})();
// ===== /Dante Online Helper =====

// ---- Bibliothek Sidebar rendern + Wizard binden ----
window.renderLibrarySidebar = function(){
  if (!window.DA_LIB) return;
  var cont = document.getElementById("libSidebarBody"); if(!cont) return;
  window.DA_LIB.renderSidebarInto(cont);
};
try { window.renderLibrarySidebar(); } catch(_){}

(function robustBindLibWizard(){
  function openWizardFromCurrentPreset(){
    var xmlDoc = window.lastXmlDoc;
    if (!xmlDoc) {
      try { var s = sessionStorage.getItem("DA_PRESET_XML"); if(s) xmlDoc = new DOMParser().parseFromString(s, "application/xml"); } catch(_) {}
    }
    if (!xmlDoc) { alert("Kein Preset geladen."); return; }
    if (!window.DA_LIB || !window.DA_LIB.openAdoptWizard) { alert("Library-Modul (Lib.js) nicht geladen."); return; }
    window.DA_LIB.openAdoptWizard(xmlDoc);
  }
  function bindOnce(id){
    var btn = document.getElementById(id);
    if(!btn) return false;
    btn.replaceWith(btn.cloneNode(true));
    btn = document.getElementById(id);
    btn.addEventListener("click", openWizardFromCurrentPreset);
    return true;
  }
  var ok = bindOnce("btnLibWizardSidebar");
  if (!ok) {
    document.addEventListener("DOMContentLoaded", function(){ bindOnce("btnLibWizardSidebar"); }, {once:true});
    var tries=0, t=setInterval(function(){
      tries++; if(bindOnce("btnLibWizardSidebar") && window.DA_LIB){ clearInterval(t); }
      if(tries>10) clearInterval(t);
    },150);
  }
})();

// Rehydrate Preset-Ansicht beim Laden und beim Zurückkehren (History Navigation)
function hydratePresetFromStorage() {
  try {
    var s = readFromSession();
    if (!s) return;
    lastXmlDoc = parseXml(s);
    fillPresetTable(lastXmlDoc);
    decoratePresetTableNames();
  } catch(_){ /* ignore */ }
}

// Beim initialen Laden
hydratePresetFromStorage();

// Wenn man per Browser „zurück“ von der Matrix kommt (bfcache/pageshow)
window.addEventListener("pageshow", function() {
  hydratePresetFromStorage();
});

// Fallback: wenn Tab wieder sichtbar wird
document.addEventListener("visibilitychange", function() {
  if (!document.hidden) hydratePresetFromStorage();
});


// --- Library-Sidebar sicher initial anzeigen ---
(function ensureInitialLibraryRender(){
  function attempt(){
    if (window.DA_LIB && typeof window.DA_LIB.renderSidebarInto === "function") {
      var cont = document.getElementById("libSidebarBody");
      if (cont) window.DA_LIB.renderSidebarInto(cont);
      return true;
    }
    return false;
  }
  if (!attempt()){
    var tries=0, t=setInterval(function(){ tries++; if(attempt()) clearInterval(t); if(tries>10) clearInterval(t); }, 150);
  }
})();

/* ============================================================
   👉 NEU: Drag & Drop auf der PRESET-TABELLE
   - Lib-Einträge sind draggable (in Lib.js gesetzt)
   - Drop auf #presetTable fügt Device ins Preset ein
   - Name über Name-Pattern + eindeutiger [n]-Zähler
   ============================================================ */

   // --- Model-Library → Drop auf Preset-Tabelle ---
(function bindModelLibDropZone(){
  var table = document.getElementById("presetTable");
  if(!table) return;

  function isModelDrag(ev){
    try{
      var types = ev.dataTransfer && ev.dataTransfer.types ? Array.from(ev.dataTransfer.types) : [];
      return types.includes("application/x-da-modellib-id") || types.includes("text/plain");
    }catch(_){}
    return false;
  }
  function getModelIdFromDT(ev){
    var id = "";
    try { id = ev.dataTransfer.getData("application/x-da-modellib-id") || ""; } catch(_){}
    if(!id){
      try {
        var t = ev.dataTransfer.getData("text/plain") || "";
        if (t.indexOf("MODLIB:") === 0) id = t.slice(7);
      } catch(_){}
    }
    return id;
  }

  table.addEventListener("dragover", function(ev){
    if (isModelDrag(ev)){
      ev.preventDefault();
      table.classList.add("drop-target");
      try { ev.dataTransfer.dropEffect = "copy"; } catch(_){}
    }
  });
  ["dragleave","dragend"].forEach(function(evt){
    table.addEventListener(evt, function(){ table.classList.remove("drop-target"); });
  });
  table.addEventListener("drop", function(ev){
    table.classList.remove("drop-target");
    var id = getModelIdFromDT(ev);
    if(!id) return;
    ev.preventDefault();
    spawnModelFromLibById(id);
  });
})();


// Nach Zurück-Navigation (BFCache/pageshow) Preset-Tabelle neu aufbauen
(function restorePresetOnPageShow(){
  window.addEventListener("pageshow", function(){
    try{
      var xml = sessionStorage.getItem("DA_PRESET_XML");
      if (!xml) return;
      if (!window.lastXmlDoc) {
        window.lastXmlDoc = (new DOMParser()).parseFromString(xml, "application/xml");
      }
      if (typeof fillPresetTable === "function") {
        fillPresetTable(window.lastXmlDoc);
      }
    }catch(_){}
  });
})();

// Delegation für Kebab-Menüs in beiden Sidebars (Model- und Device-Lib)
(function wireLibMenus(){
  ["#libSidebarBody", "#devSidebarBody"].forEach(function(sel){
    var host = document.querySelector(sel);
    if(!host) return;
    host.addEventListener("click", function(ev){
      var btn = ev.target.closest(".menu-toggle");
      if(!btn) return;
      ev.stopPropagation();
      closeAllMenus && closeAllMenus();
      var menu = btn.closest(".menu");
      if(menu) menu.classList.toggle("open");
    });
  });
})();

/* === PATCH 1: universelles Menü-Schließen (falls noch nicht vorhanden) === */
if (typeof window.closeAllMenus !== "function"){
  window.closeAllMenus = function(){
    document.querySelectorAll(".menu.open").forEach(m => m.classList.remove("open"));
  };
}
document.addEventListener("click", function(){ window.closeAllMenus(); });

// --- Netzwerkschnittstellen-Auswahl (links neben "Scan" im Header) ---
(function danteIfacesUI(){
  const HELPER = { base: "http://127.0.0.1:53535" };

  function ensureHeaderAndActions() {
    const card = document.getElementById("card-online");
    if (!card) return {};
    const header = card.querySelector(".card-header");
    if (!header) return {};
    let actions = header.querySelector(".card-actions");
    if (!actions) {
      actions = document.createElement("div");
      actions.className = "card-actions";
      header.appendChild(actions);
    }
    // Scan-Button sicherstellen, falls dein anderer Code ihn noch nicht erstellt hat
    let btn = document.getElementById("btnOnlineScan");
    if (!btn) {
      btn = document.createElement("button");
      btn.id = "btnOnlineScan";
      btn.className = "btn";
      btn.textContent = "Scan";
      actions.appendChild(btn);
      // optional: Auto-Checkbox direkt nach Scan
      if (!document.getElementById("chkOnlineAuto")) {
        const label = document.createElement("label");
        label.className = "chk";
        label.style.marginLeft = "8px";
        label.innerHTML = `<input id="chkOnlineAuto" type="checkbox"> Auto`;
        actions.appendChild(label);
      }
    }
    return { actions, btn };
  }

  async function loadIfaces(){
    try {
      const r = await fetch(HELPER.base + "/ifaces", {cache:"no-store"});
      const j = await r.json();
      renderIfaces(j.interfaces || [], j.selected);
    } catch(e){
      console.error("ifaces load failed", e);
    }
  }

  function renderIfaces(list, selected){
    const { actions, btn } = ensureHeaderAndActions();
    if (!actions) return;

    let root = document.getElementById("ifaceSelect");
    if (!root) {
      root = document.createElement("div");
      root.id = "ifaceSelect";
      // vor den Scan-Button einsetzen (links davon)
      if (btn && btn.parentElement === actions) {
        actions.insertBefore(root, btn);
      } else {
        actions.prepend(root);
      }
    }

    let html = `<label class="iface-label">Netzwerkadapter:
      <select id="ifaceDropdown">
        <option value="">Alle Adapter</option>`;
    for (const nic of list) {
      const ips = (nic.ipv4 || []).concat(nic.ipv6 || []);
      for (const ip of ips) {
        const sel = (selected && selected.includes(ip)) ? "selected" : "";
        html += `<option value="${ip}" ${sel}>${nic.name} - ${ip}</option>`;
      }
    }
    html += `</select></label>`;
    root.innerHTML = html;

    const dd = document.getElementById("ifaceDropdown");
    if (dd && !dd._bound) {
      dd.addEventListener("change", async (e)=>{
        const ip = e.target.value;
        try {
          const body = ip ? {ips:[ip]} : {};
          await fetch(HELPER.base + "/ifaces", {
            method:"POST", headers:{"Content-Type":"application/json"},
            body: JSON.stringify(body)
          });
        } catch(err){
          console.error("select iface failed", err);
        }
      });
      dd._bound = true;
    }
  }

  // Initial laden, wenn DOM bereit
  const onReady = (fn) => (document.readyState === "loading")
    ? document.addEventListener("DOMContentLoaded", fn)
    : fn();
  onReady(loadIfaces);
})();

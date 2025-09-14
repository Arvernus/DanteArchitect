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
function setTimestamp(ts){ var el=$("#statusTimestamp"); if(el) el.textContent = ts ? ("Stand: "+new Date(ts).toLocaleTimeString()) : ""; }

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

    var tdName = document.createElement("td");
    tdName.textContent = name;

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
        var xml = new XMLSerializer().serializeToString(lastXmlDoc);
        writePresetToSession(xml);
      }catch(err){ alert(err.message || String(err)); }
    };
    reader.readAsText(f);
  });
})();

// ---- Export ----
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

// ---- Online-Helper (Dummy) ----
(function mockOnline(){
  setLed("disconnected"); setStatusText("Offline"); setSpinner(false);
})();

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
(function enablePresetTableDrop(){
  var table = document.getElementById("presetTable");
  if(!table) return;

  function ensureDoc(){
    if (lastXmlDoc) return lastXmlDoc;
    var s = readFromSession(); if(s){ try{ lastXmlDoc = parseXml(s); }catch(_){ lastXmlDoc=null; } }
    if(!lastXmlDoc){ lastXmlDoc = parseXml("<preset/>"); }
    return lastXmlDoc;
  }

 function generateUniqueNameFromPattern(pattern, doc){
  // 1) Pattern normalisieren (Fallback ohne 'xxxx', damit wir es nicht versehentlich befüllen)
  var pat = String(pattern || "Device-[n]");

  // 2) Prüfen, ob ein [n]-Platzhalter (auch Varianten wie {n} / <n>) enthalten ist
  var hasNToken = /\[(?:n|N)\]|\{(?:n|N)\}|<(?:n|N)>/.test(pat);

  // 3) Helfer zum Ersetzen des Zählers, 'xxxx' bleibt UNVERÄNDERT (Design-Vorgabe)
  function makeName(n){
    var out = pat.replace(/\[(?:n|N)\]|\{(?:n|N)\}|<(?:n|N)>/g, String(n));
    if (!hasNToken) {
      // falls kein n-Token im Pattern vorhanden ist, hänge zur Eindeutigkeit -n an
      out = out + "-" + String(n);
    }
    return out;
  }

  // 4) vorhandene Namen einsammeln
  var existing = new Set(Array.prototype.map.call(
    doc.getElementsByTagName("device"),
    function(d){
      var n = d.querySelector("name");
      return n && n.textContent ? n.textContent.trim() : "";
    }
  ));

  // 5) freie Nummer finden
  var n = 1, candidate = makeName(n);
  while (existing.has(candidate)) {
    n++;
    candidate = makeName(n);
  }
  return candidate;
}


  function addDeviceFromModelId(modelId){
    if(!window.DA_LIB || !window.DA_LIB.makeDeviceXml){ alert("Library-Modul fehlt."); return; }
    var doc = ensureDoc();

modelId = (modelId || '').trim();

    // Primär über Lib-API
    var pattern = (window.DA_LIB && typeof window.DA_LIB.getNamePattern === 'function')
      ? window.DA_LIB.getNamePattern(modelId)
      : '';

    // Fallback: direkt im Modell suchen (ältere Lib-Stände)
    if (!pattern && window.DA_LIB && typeof window.DA_LIB.listModels === 'function') {
      try {
        var models = window.DA_LIB.listModels() || [];
        var m = models.find(x => String(x.id) === modelId || String(x._drag_id||'') === modelId);
        if (m) {
          pattern =
            (m.device_defaults && m.device_defaults.name_pattern) ||
            m.name_pattern ||
            (m.naming && m.naming.pattern) ||
            m.pattern || '';
        }
      } catch(_) {}
    }

    if (!pattern) {
      console.warn('[Architect] Kein Name-Pattern in Lib gefunden – Fallback auf "Device-[n]". modelId=', modelId);
      pattern = 'Device-[n]';
    } else {
      console.debug('[Architect] Name-Pattern aus Lib:', pattern, 'modelId=', modelId);
    }    var deviceName = generateUniqueNameFromPattern(pattern, doc);

    
    // Device-XML erzeugen
    var devXmlStr = window.DA_LIB.makeDeviceXml(modelId, { name: deviceName });

    // in Preset-Dokument übernehmen
    var frag = parseXml(devXmlStr);
    var devEl = frag.documentElement;
    var imported = doc.importNode ? doc.importNode(devEl, true) : devEl;
    var pres = doc.querySelector("preset") || doc.documentElement;
    pres.appendChild(imported);

    // speichern & UI aktualisieren
    lastXmlDoc = doc;
    writePresetToSession(new XMLSerializer().serializeToString(lastXmlDoc));
    fillPresetTable(lastXmlDoc);
  }

  table.addEventListener("dragover", function(e){
    if(!e.dataTransfer) return;
    if(e.dataTransfer.types && e.dataTransfer.types.indexOf("text/plain")>=0){
      e.preventDefault();
      table.classList.add("drop-hover");
      e.dataTransfer.dropEffect = "copy";
    }
  });
  table.addEventListener("dragleave", function(){ table.classList.remove("drop-hover"); });
  table.addEventListener("drop", function(e){
    e.preventDefault();
    table.classList.remove("drop-hover");
    try {
      var modelId = e.dataTransfer.getData("text/plain");
      if(modelId) addDeviceFromModelId(modelId);
    } catch(_) {}
  });
})();
// Apps/Web/Matrix.js  — bereinigte Version mit:
// - stabilem Render (TX- & RX-Kanalüberschriften korrekt)
// - Namenskonzept (Prefix/Suffix Anzeige & Edit nur Suffix, wenn aktiv)
// - Drag-to-Subscribe („Malen“) mit add/erase
// - Einzelklick-Subscribe bleibt erhalten

// --------- Konstanten ----------
var SKEY_XML  = "DA_PRESET_XML";

// --------- Working State ----------
var xmlDoc = null;
var devices = [];
var cols = [];
var rows = [];

var editSubsEnabled  = false;
var editNamesEnabled = false;

var collapsedTx = Object.create(null);
var collapsedRx = Object.create(null);

var frozenCols = null;
var frozenRows = null;

// --- Painting (Drag-to-Subscribe) ---
var isPainting = false;      // aktiv beim gedrückten Ziehen
var paintMode = null;        // "add" | "erase"
var paintVisitedRows = null; // Set von "rdi:rid" -> pro RX nur 1x anwenden
var isOrthoPaint = false;               // rechte Maustaste = Orthogonal-Modus
var orthoStart = null;                  // { rdi,rid,tdi,tid }
var orthoLastHover = null;              // letztes td im RMB-Modus

// --- Ortho (One-Shot) & Long-Press (Touch) ---
var isOrthoArmed = false;         // einmaliger Ortho-Malvorgang „scharf“
var orthoBadgeEl = null;          // visuelles Feedback
var lpTimer = null;               // long-press timer (touch)
var lpFired = false;
var LP_MS = 350;
var pendingStart = null;            // Startzelle, falls Ortho erst per Long-Press kommt

function setOrthoUI(on){
  var btn = document.getElementById('btnOrthoOnce');
  var wrapEl = $("#matrixWrap");
  if (on) {
    if (wrapEl) wrapEl.classList.add("ortho-active");
    if (btn) btn.classList.add('active');
  } else {
    if (wrapEl) wrapEl.classList.remove("ortho-active");
    if (btn) btn.classList.remove('active');
  }
}

function armOrthoOnce(){
  isOrthoArmed = true;
  setOrthoUI(true);
  // Mid-gesture Upgrade: wenn bereits Painting läuft, aber Ortho noch nicht aktiv,
  // übernehme die gemerkte Startzelle als orthoStart.
  if (isPainting && !isOrthoPaint && pendingStart){
    isOrthoPaint = true;
    orthoStart = {
      rdi: pendingStart.rdi, rid: pendingStart.rid,
      tdi: pendingStart.tdi, tid: pendingStart.tid
    };
    var wrapEl = $("#matrixWrap");
    if (wrapEl) wrapEl.classList.add("painting");
  }
}

function disarmOrtho(){
  isOrthoArmed = false;
  setOrthoUI(false);
}

// Kontextmenü während RMB-Painting unterdrücken
document.addEventListener("contextmenu", function(e){
  if (isOrthoPaint) { e.preventDefault(); }
}, true);

// --------- Helpers ----------

// Index-Suche
function rxIndexOf(dev, rxId){ 
  var a = dev && dev.rx || []; 
  for (var i=0;i<a.length;i++){ if(String(a[i].id)===String(rxId)) return i; } 
  return -1; 
}
function txIndexOf(dev, txId){ 
  var a = dev && dev.tx || []; 
  for (var i=0;i<a.length;i++){ if(String(a[i].id)===String(txId)) return i; } 
  return -1; 
}

// --- Enable-Prompts & Preferences ---
var PREF_ENABLE_ON_CLICK_SUBS  = "DA_PREF_ENABLE_ON_CLICK_SUBS";
var PREF_ENABLE_ON_CLICK_NAMES = "DA_PREF_ENABLE_ON_CLICK_NAMES";

function prefGetBool(key){
  try { return localStorage.getItem(key) === "1"; } catch(_){ return false; }
}
function prefSetBool(key, val){
  try { localStorage.setItem(key, val ? "1" : "0"); } catch(_){}
}

function showEnableDialog(kind, onEnable, onEnableRemember){
  // kind: 'subs' | 'names'
  var t = (kind === 'subs')
    ? "Abonnements patchen ist aktuell deaktiviert."
    : "Bearbeiten von Geräte-/Kanalnamen ist aktuell deaktiviert.";

  var overlay = document.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.background = "rgba(0,0,0,0.35)";
  overlay.style.zIndex = "9999";
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";

  var box = document.createElement("div");
  box.style.background = "#fff";
  box.style.border = "1px solid #ccc";
  box.style.borderRadius = "10px";
  box.style.boxShadow = "0 8px 30px rgba(0,0,0,0.25)";
  box.style.width = "min(460px, 92vw)";
  box.style.padding = "16px";
  box.style.fontFamily = "system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Arial";
  box.innerHTML = [
    '<h3 style="margin:0 0 8px 0; font-size:16px;">Aktion aktivieren?</h3>',
    '<p style="margin:0 0 12px 0; font-size:13px; color:#444;">'+t+'</p>',
    '<div style="display:flex; gap:8px; justify-content:flex-end;">',
      '<button id="dlg-cancel"  class="btn" style="padding:6px 10px;">Abbrechen</button>',
      '<button id="dlg-enable"  class="btn" style="padding:6px 10px; background:#2979ff; border:none; color:white; border-radius:6px;">Jetzt aktivieren</button>',
      '<button id="dlg-remember" class="btn" style="padding:6px 10px; background:#01579b; border:none; color:white; border-radius:6px;">Aktivieren & merken</button>',
    '</div>'
  ].join("");

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  function close(){ if(overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay); }
  box.querySelector("#dlg-cancel").addEventListener("click", function(){ close(); });
  box.querySelector("#dlg-enable").addEventListener("click", function(){
    try{ onEnable && onEnable(); }finally{ close(); }
  });
  box.querySelector("#dlg-remember").addEventListener("click", function(){
    try{ onEnableRemember && onEnableRemember(); }finally{ close(); }
  });
}


function $(s){ return document.querySelector(s); }
function cel(tag, cls, txt){ var e=document.createElement(tag); if(cls) e.className=cls; if(txt!=null) e.textContent=txt; return e; }
function norm(s){
  // robuste Normalisierung:
  // - toLower, trim, Spaces kollabieren
  // - NFD + Diakritika entfernen
  // - Umlaute: ä/ö/ü→ae/oe/ue, ß→ss
  var x = (s == null) ? "" : String(s);
  try { x = x.normalize('NFD'); } catch(_){}
  x = x.toLowerCase()
       .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
       .replace(/ß/g, 'ss')
       .replace(/[\u0300-\u036f]/g, '')  // diakritische Zeichen
       .replace(/\s+/g, ' ')
       .trim();
  return x;
}

// Eingabe → Tokenliste (UND-Verknüpfung)
function tokensOf(s){
  // Ergebnis: Array von Gruppen (UND). Jede Gruppe ist ein Array von Alternativen (ODER).
  // Beispiel: "mic in|input out##"
  // → [ ["mic"], ["in","input"], ["out##"] ]
  var n = norm(s);
  if (!n) return [];
  return n.split(' ').filter(Boolean).map(function(group){
    return group.split('|').filter(Boolean);
  });
}
// Prüft: alle tokens kommen in mindestens einem Feld (teilweise) vor
function compileTokenToRegex(t){
  // Wir bekommen t bereits "norm()"alisiert.
  // 1) Platzhalter vorm Escapen einsetzen
  //    ** / *** / ....  → __AST{n}__
  t = t.replace(/(\*{2,})/g, (m)=>`__AST${m.length}__`);
  //    * → __STAR__
  t = t.replace(/\*/g, '__STAR__');
  //    # / ## / ### ... → __HASH{n}__
  t = t.replace(/(#{1,})/g, (m)=>`__HASH${m.length}__`);

  // 2) Rest escapen (RegEx-Meta)
  t = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // 3) Platzhalter zurück in RegEx übersetzen
  t = t
    .replace(/__AST(\d+)__/g, (_,n)=>`.{${n}}`)   // exakt n beliebige Zeichen
    .replace(/__STAR__/g, '.*')                   // beliebig viele Zeichen
    .replace(/__HASH(\d+)__/g, (_,n)=>`\\d{${n}}`); // exakt n Ziffern

  // un-anchored: Teilstring-Match
  return new RegExp(t);
}

// Prüft: alle tokens müssen in mind. einem Feld matchen (Teilstring)
function fieldsMatchTokens(fields, tokenGroups){
  // tokenGroups: Array< Array<string> >
  // AND über Gruppen, OR über Alternativen je Gruppe, OR über Felder
  if (!tokenGroups || tokenGroups.length === 0) return true;

  var nf = fields.map(norm);

  return tokenGroups.every(function(group){
    // min. eine Alternative der Gruppe muss in mind. einem Feld matchen
    var regs = group.map(compileTokenToRegex);
    return regs.some(function(rx){
      return nf.some(function(f){ return rx.test(f); });
    });
  });
}

function colKey(devIndex, chanId){ return chanId ? ("tx:"+devIndex+":"+chanId) : ("txdev:"+devIndex); }
function rowKey(devIndex, chanId){ return chanId ? ("rx:"+devIndex+":"+chanId) : ("rxdev:"+devIndex); }

// === Namenskonzept (global; geteilter Key mit Index/Script.js) ===
var NAME_SCHEME_KEY = "DA_NAME_SCHEME_ENABLED";
function nameConceptEnabled(){ try { return localStorage.getItem(NAME_SCHEME_KEY) === "1"; } catch(_){ return false; } }

// [n]-sicheres Splitten: wir suchen ein rechtes "-<Zahl>" (=Zähler), dem später irgendwo "-<Buchstabe>" folgt.
// Alles danach ist Suffix (kann Bindestriche enthalten). Sonst Fallback letzter Bindestrich.
function splitName(full){
  var s = String(full || "").trim();
  if (!s) return { prefix: "", suffix: "" };

  var idxCandidate = -1;
  var re = /-(\d+)/g, m;
  while ((m = re.exec(s))) {
    var afterNumIdx = re.lastIndex; // Position nach den Ziffern
    var rest = s.slice(afterNumIdx);
    if (/-[A-Za-z]/.test(rest)) {
      idxCandidate = afterNumIdx;
    }
  }
  if (idxCandidate !== -1 && s.charAt(idxCandidate) === '-') {
    return { prefix: s.slice(0, idxCandidate), suffix: s.slice(idxCandidate + 1) };
  }

  // Alternative: einfaches Muster "…-[Zahl](-Suffix optional)"
  var m2 = s.match(/^(.*-\d+)(?:-(.+))?$/);
  if (m2) return { prefix: m2[1], suffix: m2[2] ? m2[2] : "" };

  // Fallback: letzter Bindestrich
  var idx = s.lastIndexOf("-");
  if (idx < 0) return { prefix: s, suffix: "" };
  return { prefix: s.slice(0, idx), suffix: s.slice(idx + 1) };
}
function joinName(prefix, suffix){
  prefix = String(prefix || ""); 
  suffix = String(suffix || "");
  return suffix ? (prefix + "-" + suffix) : prefix;
}

function readFromSession(){
  var xml = null; try { xml = sessionStorage.getItem(SKEY_XML); } catch(_) {}
  return xml;
}
function readFromWindowName(){
  if(!window.name) return null;
  try{
    var payload = JSON.parse(window.name);
    if(payload && payload.type === "DA_PRESET" && payload.xml) return String(payload.xml);
  }catch(_){}
  return null;
}
function writeToSessionAndName(xml){
  try { sessionStorage.setItem(SKEY_XML, xml); } catch(_) {}
  try { window.name = JSON.stringify({ type:"DA_PRESET", xml: xml, ts: Date.now() }); } catch(_) {}
}

function parseXml(text){
  var p = new DOMParser();
  var doc = p.parseFromString(text, "application/xml");
  var err = doc.querySelector("parsererror");
  if(err) throw new Error("XML Parser Error: " + err.textContent);
  return doc;
}

// --------- Init ----------
(function init(){
  try{
    var xml = readFromSession();
    if(!xml || !xml.trim()){
      xml = readFromWindowName();
      if(xml){ writeToSessionAndName(xml); }
    }

    if (!xml || !xml.trim()){
      var hint = $("#hint");
      if(hint) hint.innerHTML = "⚠️ <span class='warn'>Kein Preset gefunden.</span> Bitte zurück zur Übersicht.";
      return;
    }

    xmlDoc = parseXml(xml);

    buildModel();
    renderMatrix();
    bindUI();
    setupFixedHScroll();  // Proxy-Scrollbar initialisieren

    // Safety: beim Verlassen/Verstecken persistieren
    window.addEventListener("beforeunload", persist, {capture:true});
    window.addEventListener("pagehide", persist, {capture:true});

  }catch(e){
    var h = $("#hint");
    if(h) h.textContent = "Init-Fehler: " + (e.message || String(e));
  }
})();

// fixer Horizontal-Scrollbar (Proxy) am Fensterrand
function setupFixedHScroll(){
  var proxy = document.getElementById('hscrollProxy');
  var wrap  = document.getElementById('matrixWrap') || document.querySelector('.matrix-wrap');
  var table = document.getElementById('matrix');
  if(!proxy || !wrap || !table) return;

  try{ wrap.style.overflowX = 'hidden'; }catch(_){}

  function ensureSpacer(){
    var inner = proxy.querySelector('.spacer');
    if(!inner){ inner = document.createElement('div'); inner.className='spacer'; inner.style.height='1px'; proxy.appendChild(inner); }
    return inner;
  }
  function applyBottomOffset(){
    var sb = document.querySelector('.statusbar');
    var h = 0;
    if (sb){
      var cs = getComputedStyle(sb);
      if (cs.display !== 'none' && cs.visibility !== 'hidden'){ h = sb.getBoundingClientRect().height || 0; }
    }
    proxy.style.bottom = (h|0) + 'px';
  }
  function syncSize(){
    var inner = ensureSpacer();
    var vw = document.documentElement ? document.documentElement.clientWidth : 0;
    var w  = Math.max(wrap.scrollWidth, table.scrollWidth, vw);
    inner.style.width = w + 'px';
    if (proxy.scrollLeft !== wrap.scrollLeft) proxy.scrollLeft = wrap.scrollLeft;
  }
  function onProxyScroll(){ if (wrap.scrollLeft !== proxy.scrollLeft) wrap.scrollLeft = proxy.scrollLeft; }
  function onWrapScroll(){  if (proxy.scrollLeft !== wrap.scrollLeft) proxy.scrollLeft = proxy.scrollLeft; }
  function onWheelHorizontal(e){
    if (e.deltaX || e.shiftKey){
      proxy.scrollLeft += (e.deltaX || e.deltaY);
      e.preventDefault();
    }
  }

  proxy.addEventListener('scroll', onProxyScroll, {passive:true});
  wrap .addEventListener('scroll', onWrapScroll,  {passive:true});
  proxy.addEventListener('wheel',  onWheelHorizontal, {passive:false});
  wrap .addEventListener('wheel',  onWheelHorizontal, {passive:false});
  window.addEventListener('resize', function(){ applyBottomOffset(); syncSize(); });

  var ro;
  if ('ResizeObserver' in window){
    ro = new ResizeObserver(syncSize);
    ro.observe(wrap); ro.observe(table);
  }
  var mo = new MutationObserver(syncSize);
  mo.observe(table, {childList:true, subtree:true, attributes:true});

  applyBottomOffset();
  setTimeout(function(){ applyBottomOffset(); syncSize(); }, 0);
}


// --------- Model-Aufbau ----------
function buildModel(){
  devices = []; cols = []; rows = [];

  var devEls = Array.prototype.slice.call(xmlDoc.querySelectorAll("preset > device"));
  if(devEls.length === 0) devEls = Array.prototype.slice.call(xmlDoc.querySelectorAll("device"));

  devEls.forEach(function(de){
    var nEl = de.querySelector("name");
    var name = nEl && nEl.textContent ? nEl.textContent.trim() : "";

    var txEls = Array.prototype.slice.call(de.querySelectorAll("txchannel"));
    var rxEls = Array.prototype.slice.call(de.querySelectorAll("rxchannel"));

    var tx = txEls.map(function(txel){
      var labEl = txel.querySelector("label");
      var label = labEl && labEl.textContent ? labEl.textContent.trim() : "";
      var id = txel.getAttribute("danteId") || "";
      return { el: txel, label: label, id: id };
    });

    var rx = rxEls.map(function(rxel){
      var nEl2 = rxel.querySelector("name");
      var rname = nEl2 && nEl2.textContent ? nEl2.textContent.trim() : "";
      var id = rxel.getAttribute("danteId") || "";
      var sd = rxel.querySelector("subscribed_device");
      var sc = rxel.querySelector("subscribed_channel");
      return {
        el: rxel,
        name: rname,
        id: id,
        subDev: sd && sd.textContent ? sd.textContent.trim() : "",
        subChan: sc && sc.textContent ? sc.textContent.trim() : ""
      };
    });

    devices.push({ name: name, el: de, tx: tx, rx: rx });
  });

  devices.forEach(function(d){
    d.tx.forEach(function(tx){ cols.push({ dev:d, tx:tx }); });
  });
  devices.forEach(function(d){
    d.rx.forEach(function(rx){ rows.push({ dev:d, rx:rx }); });
  });
}

// --------- Sichtbarkeitsbasis + Freeze ----------
function computeVisibleBase(){
  var tTx = tokensOf( $("#fTx") ? $("#fTx").value : "" );
  var tRx = tokensOf( $("#fRx") ? $("#fRx").value : "" );


  function deviceMatchesTx(dev){
    // Felder: Gerätename + alle TX-Labels
    var fields = [dev.name];
    for (var i=0; i<dev.tx.length; i++) { fields.push(dev.tx[i].label); }
    return fieldsMatchTokens(fields, tTx);
  }

  function deviceMatchesRx(dev){
    // Felder: Gerätename + alle RX-Namen
    var fields = [dev.name];
    for (var i=0; i<dev.rx.length; i++) { fields.push(dev.rx[i].name); }
    return fieldsMatchTokens(fields, tRx);
  }
  
  var visCols = [];
  devices.forEach(function(d, di){
    var devNameMatchTx = fieldsMatchTokens([d.name], tTx);
    var txList = (!tTx.length || devNameMatchTx)
      ? (d.tx || []).slice()
      : (d.tx || []).filter(function(tx){ return fieldsMatchTokens([tx.label], tTx); });

    // NUR wenn überhaupt TX-Kanäle existieren (nach Filter)
    if (txList.length === 0) return;

    // Gerätekopf-SPALTE
    visCols.push({ dev:d, devIndex: di, isDevice:true, tx:null });

    // Kanäle anhängen, wenn nicht eingeklappt
    if (!collapsedTx[di]) {
      txList.forEach(function(tx){
        visCols.push({ dev:d, devIndex: di, isDevice:false, tx:tx });
      });
    }
  });

 var visRows = [];
  devices.forEach(function(d, di){
    var devNameMatchRx = fieldsMatchTokens([d.name], tRx);
    var rxList = (!tRx.length || devNameMatchRx)
      ? (d.rx || []).slice()
      : (d.rx || []).filter(function(rx){ return fieldsMatchTokens([rx.name], tRx); });

    // NUR wenn überhaupt RX-Kanäle existieren (nach Filter)
    if (rxList.length === 0) return;

    // Gerätekopf-ZEILE
    visRows.push({ dev:d, devIndex: di, isDevice:true, rx:null });

    // Kanäle anhängen, wenn nicht eingeklappt
    if (!collapsedRx[di]) {
      rxList.forEach(function(rx){
        visRows.push({ dev:d, devIndex: di, isDevice:false, rx:rx });
      });
    }
  });

  return { visCols: visCols, visRows: visRows };
}

function freezeVisible(base){
  var onlyCols = $("#onlyColsWithSubs");
  if(onlyCols && onlyCols.checked){
    var set = new Set();
    base.visCols.forEach(function(c){
      set.add(colKey(c.devIndex, c.isDevice ? null : (c.tx && c.tx.id)));
    });
    frozenCols = set;
  } else { frozenCols = null; }

  var onlyRows = $("#onlyRowsWithSubs");
  if(onlyRows && onlyRows.checked){
    var setR = new Set();
    base.visRows.forEach(function(r){
      setR.add(rowKey(r.devIndex, r.isDevice ? null : (r.rx && r.rx.id)));
    });
    frozenRows = setR;
  } else { frozenRows = null; }
}

// --- Painting-Helpers: raw subscribe/clear ohne sofortiges Re-Render ---
function setRxSubscriptionRaw(rdi, rid, tdi, tid){
  if(isNaN(rdi) || isNaN(tdi)) return;
  var rdev = devices[rdi], tdev = devices[tdi];
  if(!rdev || !tdev) return;

  var rx = null, tx = null, i;
  for(i=0;i<rdev.rx.length;i++){ if(String(rdev.rx[i].id) === String(rid)) { rx = rdev.rx[i]; break; } }
  for(i=0;i<tdev.tx.length;i++){ if(String(tdev.tx[i].id) === String(tid)) { tx = tdev.tx[i]; break; } }
  if(!rx || !tx) return;

  var sd = rx.el.querySelector("subscribed_device");
  var sc = rx.el.querySelector("subscribed_channel");
  if(!sd){ sd = xmlDoc.createElement("subscribed_device"); rx.el.appendChild(sd); }
  if(!sc){ sc = xmlDoc.createElement("subscribed_channel"); rx.el.appendChild(sc); }
  sd.textContent = tdev.name; sc.textContent = tx.label;
  rx.subDev = tdev.name; rx.subChan = tx.label;
}
function clearRxSubscriptionRaw(rdi, rid){
  if(isNaN(rdi)) return;
  var rdev = devices[rdi]; if(!rdev) return;
  var rx = null, i;
  for(i=0;i<rdev.rx.length;i++){ if(String(rdev.rx[i].id) === String(rid)) { rx = rdev.rx[i]; break; } }
  if(!rx) return;

  var sd = rx.el.querySelector("subscribed_device");
  var sc = rx.el.querySelector("subscribed_channel");
  if(sd) sd.textContent = "";
  if(sc) sc.textContent = "";
  rx.subDev = ""; rx.subChan = "";
}

// --------- Render ----------
function renderMatrix(){
  var thead = $("#thead"), tbody = $("#tbody");
  if(!thead || !tbody) return;
  thead.innerHTML = ""; 
  tbody.innerHTML  = "";

  var base = computeVisibleBase();
  var visCols = base.visCols.slice();
  var visRows = base.visRows.slice();

  if(frozenCols){ visCols = visCols.filter(function(c){ return frozenCols.has(colKey(c.devIndex, c.isDevice ? null : (c.tx && c.tx.id))); }); }
  if(frozenRows){ visRows = visRows.filter(function(r){ return frozenRows.has(rowKey(r.devIndex, r.isDevice ? null : (r.rx && r.rx.id))); }); }

  // ----- Kopfzeile 1 (TX-Gerätegruppen) -----
  var tr0 = cel("tr");
  var thRXDev = cel("th","top-left-0","");            thRXDev.style.minWidth="28px";   // schmale Rail
  var thRXChan= cel("th","top-left-1","Empfänger");   thRXChan.style.minWidth="220px"; // breite RX-Kanalspalte
  tr0.appendChild(thRXDev);
  tr0.appendChild(thRXChan);

// TX-Rail-Kopfzeile: genau eine Zelle pro sichtbarer TX-Spalte (analog RX-Rail)
for (var cidx = 0; cidx < visCols.length; cidx++) {
  var c = visCols[cidx];
  var thTxRail = cel("th","tx-railcell");

  // Laufpositions-Klasse pro Gerätegruppe
  var prev = visCols[cidx - 1], next = visCols[cidx + 1];
  if (c.isDevice) {
    // Gerät: start oder single
    if (!next || next.isDevice || next.devIndex !== c.devIndex) {
      thTxRail.classList.add("tx-rail-single","tx-railcell--dev");
    } else {
      thTxRail.classList.add("tx-rail-start","tx-railcell--dev");
    }
  } else {
    // Kanal: last oder mid
    if (!next || next.isDevice || next.devIndex !== c.devIndex) {
      thTxRail.classList.add("tx-rail-last");
    } else {
      thTxRail.classList.add("tx-rail-mid");
    }
  }

  // Bänderung wie bei TX-Headern
  var bandClass = (c.devIndex % 2) ? "tx-band-odd" : "tx-band-even";
  thTxRail.classList.add(bandClass);

  tr0.appendChild(thTxRail);
}


  thead.appendChild(tr0);

// ----- Kopfzeile 2 (TX-Kanäle / Gerätespalten) -----
var tr1 = cel("tr");
tr1.appendChild(cel("th", "rowhead", ""));
tr1.appendChild(cel("th", "rowchan", ""));
for (var i = 0; i < visCols.length; i++) {
  var cc = visCols[i];
  var bandClass = (cc.devIndex % 2) ? "tx-band-odd" : "tx-band-even";
  var thc = cel("th", "tx-chan " + bandClass);

  if (cc.isDevice) {
    // Gerätespalte: Name (vertikal) + Toggle
    thc.classList.add("tx-devcell");
    var wrap = cel("div","tx-devwrap","");
    var tgl = cel("button","btn", collapsedTx[cc.devIndex] ? "+" : "–");
    tgl.dataset.role = "toggle-tx";
    tgl.dataset.devIndex = String(cc.devIndex);

    var parts = splitName(cc.dev.name || "");
    var nameEl = cel("span","tx-devname",
      nameConceptEnabled() ? (parts.suffix || "") : (cc.dev.name || "(ohne Name)")
    );
    if (nameConceptEnabled()) { nameEl.title = parts.prefix || ""; }

    wrap.appendChild(tgl);
    wrap.appendChild(nameEl);
    thc.appendChild(wrap);
  } else {
    // TX-Kanal-Kopf (vertikal)
    var spc = cel("span", "editable", cc.tx.label || "");
    spc.dataset.role = "tx-chan";
    spc.dataset.devIndex = String(cc.devIndex);
    spc.dataset.chanId   = String(cc.tx.id);
    if (editNamesEnabled) { spc.contentEditable = "true"; }
    thc.appendChild(spc);
  }
  tr1.appendChild(thc);
}
thead.appendChild(tr1);
  
// Ortho-Button in die Spalte „Empfänger Kanäle“ (Header-Zelle rowchan) setzen
(function ensureRowchanOrthoButton(){
  var host = tr1.querySelector('th.rowchan');
  if (!host) return;
  if (host.querySelector('#btnOrthoOnce')) return;

  var b = document.createElement('button');
  b.id = 'btnOrthoOnce';
  b.type = 'button';
  b.className = 'ortho-btn';
  b.title = 'Orthogonal zeichnen (einmal)';
  b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
              +   '<rect x="3" y="3" width="18" height="18" rx="3" ry="3" fill="currentColor" opacity="0.2"></rect>'
              +   '<path d="M6 6 H18 M6 6 V18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"></path>'
              +   '<path d="M6 6 L18 18" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"></path>'
              + '</svg>';
  b.addEventListener('click', function(){ armOrthoOnce(); });

  if (!host.style.position) host.style.position = 'relative';
  host.appendChild(b);
})();


  // ----- Tabellenkörper -----

  // Laufgruppen je RX-Gerät vorbereiten (für Rail: start/mid/last/single)
  var rxRunInfo = []; // pro Zeile: {pos:'dev'|'single'|'mid'|'last'}
  (function(){
    var i = 0;
    while (i < visRows.length){
      var row = visRows[i];
      if (row.isDevice){
        // Zähle Kinder
        var j = i + 1, count = 0;
        while (j < visRows.length && !visRows[j].isDevice && visRows[j].devIndex === row.devIndex){ count++; j++; }
        if (count === 0){
          rxRunInfo[i] = { pos: 'single' };
        } else {
          rxRunInfo[i] = { pos: 'dev' };
          for (var k=1; k<=count; k++){
            var pos = (k === count) ? 'last' : 'mid';
            rxRunInfo[i + k] = { pos: pos };
          }
        }
        i = i + 1 + count;
      } else {
        // Sollte nicht passieren (Kanäle ohne Kopf), aber falls doch:
        rxRunInfo[i] = { pos: 'mid' };
        i++;
      }
    }
  })();


  for(var r=0; r<visRows.length; r++){
    var row = visRows[r];
    var tr = cel("tr");

  // Linke Rail: Position streng an Vor-/Nachbarzeile festmachen (dev/single/mid/last)
  var pos = (function rxRailPosAt(idx){
    var row  = visRows[idx];
    var prev = visRows[idx - 1];
    var next = visRows[idx + 1];
    if (row.isDevice){
      // 'single' wenn keine nachfolgende Kanalzeile desselben Geräts sichtbar
      if (!next || next.isDevice || next.devIndex !== row.devIndex) return 'single';
      return 'dev';   // Gerätezeile mit folgenden Kanälen
    }
    // Kanalzeilen: 'last' wenn nächste Zeile anderes Gerät (oder keine)
    if (!next || next.isDevice || next.devIndex !== row.devIndex) return 'last';
    return 'mid';
  })(r);
  var thD = cel("th","rowhead rowhead-narrow rx-railcell","");
  if (pos === 'dev')    thD.classList.add("rx-rail-start","rx-railcell--dev");
  if (pos === 'single') thD.classList.add("rx-rail-single","rx-railcell--dev");
  if (pos === 'mid')    thD.classList.add("rx-rail-mid");
  if (pos === 'last')   thD.classList.add("rx-rail-last");
  tr.appendChild(thD);

  // Gerätezeile markieren (für Gesamtzeilenfärbung)
  if (row.isDevice) tr.classList.add("is-device");

  // RX-Gerätename + Toggle erscheinen in der KANALSPALTE, wenn Gerätezeile
  var toggleRx = cel("button","btn", collapsedRx[row.devIndex] ? "+" : "–");
  toggleRx.dataset.role = "toggle-rx"; 
  toggleRx.dataset.devIndex = String(row.devIndex); 
  toggleRx.style.marginRight = "6px";

  var partsRX = splitName(row.dev.name || "");
  var stackRX = cel("span","name-stack","");
  var topRX = cel("span","name-prefix", partsRX.prefix || "");
  var botRX = cel("span","name-suffix editable", partsRX.suffix || "");

  if (editNamesEnabled){
    if (nameConceptEnabled()){
      botRX.dataset.role = "dev-suffix-rx";
      botRX.dataset.devIndex = String(row.devIndex);
      botRX.contentEditable = "true";
    } else {
      botRX.textContent = row.dev.name || "(ohne Name)";
      botRX.dataset.role = "dev-name-rx";
      botRX.dataset.devIndex = String(row.devIndex);
      botRX.contentEditable = "true";
      topRX.textContent = "";
    }
  } else {
    if (!nameConceptEnabled()){
      botRX.textContent = row.dev.name || "(ohne Name)";
      topRX.textContent = "";
    }
  }
  stackRX.appendChild(topRX);
  stackRX.appendChild(botRX);

  // RX-Kanalspalte
  var thC = cel("th","rowchan");
  if (row.isDevice) {
    thC.classList.add("dev-rowcell");
    var devWrap = cel("div","dev-row","");
    devWrap.appendChild(toggleRx);
    devWrap.appendChild(stackRX);
    thC.appendChild(devWrap);
  } else {
    var cspan = cel("span","editable", row.rx.name || "");
    cspan.dataset.role = "rx-chan"; 
    cspan.dataset.devIndex = String(row.devIndex); 
    cspan.dataset.chanId   = String(row.rx.id);
    if(editNamesEnabled){ cspan.contentEditable = "true"; }
    thC.appendChild(cspan);
  }
  tr.appendChild(thC);

    // Zellen
    for (var x=0; x<visCols.length; x++){
      var col = visCols[x];
      var bandClass = (col.devIndex % 2) ? "tx-band-odd" : "tx-band-even";

    // Gerätespalte: keine TX-Rail im Body (nur normale Zelle)
    if (col.isDevice) {
      var tdDev = cel("td","cell " + bandClass, "");
      if (row.isDevice) tdDev.classList.add("tx-railcell--rowdev");
      tr.appendChild(tdDev);
      continue;
    }

      var cellEditable = (editSubsEnabled && !row.isDevice);
      var td = cel("td", "cell " + bandClass + (cellEditable ? " editable" : ""), "");

      var isSub = (!row.isDevice) &&
                  (row.rx.subDev === col.dev.name && row.rx.subChan === col.tx.label);
      if (isSub){ td.appendChild(cel("span","dot","")); }

      td.dataset.role = "cell";
      td.dataset.rxDevIndex = String(row.devIndex);
      td.dataset.rxChanId   = row.isDevice ? "" : String(row.rx.id);
      td.dataset.txDevIndex = String(col.devIndex);
      td.dataset.txChanId   = String(col.tx.id);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }

  // ----- Delegierte Interaktion (Klicks) -----
  var theadEl = $("#thead"), tbodyEl = $("#tbody");
  theadEl.onclick = tbodyEl.onclick = function(ev){
    var t = ev.target; if(!t || !t.dataset) return;

    if(t.dataset.role === "toggle-tx"){ 
      var di = parseInt(t.dataset.devIndex,10); 
      collapsedTx[di] = !collapsedTx[di]; 
      renderMatrix(); 
      return; 
    }
    if(t.dataset.role === "toggle-rx"){ 
      var di2= parseInt(t.dataset.devIndex,10); 
      collapsedRx[di2] = !collapsedRx[di2]; 
      renderMatrix(); 
      return; 
    }

    if(editNamesEnabled){
      if(t.dataset.role === "dev-name-tx"){ makeEditable(t, function(v){ renameDevice(t,"tx",v); }); return; }
      if(t.dataset.role === "tx-chan"){ makeEditable(t, function(v){ renameTxChannel(t,v); }); return; }
      if(t.dataset.role === "dev-name-rx"){ makeEditable(t, function(v){ renameDevice(t,"rx",v); }); return; }
      if(t.dataset.role === "rx-chan"){ makeEditable(t, function(v){ renameRxChannel(t,v); }); return; }

      // Nur Suffix editieren (Namenskonzept AN)
      if (t.dataset.role === "dev-suffix-tx") {
        makeEditable(t, function(v){
          var di = parseInt(t.dataset.devIndex, 10);
          if (isNaN(di) || !devices[di]) return;
          var dev = devices[di];
          var p = splitName(dev.name || "");
          var newFull = joinName(p.prefix, v);
          renameDevice(t, "tx", newFull);
        });
        return;
      }
      if (t.dataset.role === "dev-suffix-rx") {
        makeEditable(t, function(v){
          var di = parseInt(t.dataset.devIndex, 10);
          if (isNaN(di) || !devices[di]) return;
          var dev = devices[di];
          var p = splitName(dev.name || "");
          var newFull = joinName(p.prefix, v);
          renameDevice(t, "rx", newFull);
        });
        return;
      }
    }

    else {
      // Wenn Bearbeiten aus ist, aber auf Name/Kanal geklickt wird → Dialog
      var roles = ["dev-name-tx", "tx-chan", "dev-name-rx", "rx-chan", "dev-suffix-tx", "dev-suffix-rx"];
      if (t.dataset && roles.indexOf(t.dataset.role) >= 0){
        var tNames = $("#toggleNames");
        var enableNow = function(){
          if (tNames) tNames.checked = true;
          editNamesEnabled = true;
          renderMatrix();
        };
        var enableRemember = function(){
          // beide Präferenzen dauerhaft setzen
          prefSetBool(PREF_ENABLE_ON_CLICK_SUBS,  true);
          prefSetBool(PREF_ENABLE_ON_CLICK_NAMES, true);
          // beide Modi sofort aktivieren (UI toggles mitsynchronisieren)
          var tSubs  = $("#toggleSubs");
          var tNames = $("#toggleNames");
          if (tSubs)  tSubs.checked  = true;
          if (tNames) tNames.checked = true;
          editSubsEnabled  = true;
          editNamesEnabled = true;
          renderMatrix();
       };
      showEnableDialog('names', enableNow, enableRemember);
        return;
      }
    }

    if(editSubsEnabled && t.dataset.role === "cell"){
      if(!t.dataset.rxChanId || !t.dataset.txChanId) return;
      toggleSubscription(t); 
      return;
    }
  };

// Pointer Long-Press → Ortho (einmal)  (funktioniert für Touch, Stift und Maus)
tbodyEl.addEventListener('pointerdown', function(ev){
  // nur innerhalb einer Matrix-Zelle sinnvoll
  var td = ev.target && ev.target.closest ? ev.target.closest('td') : null;
  if (!td || td.dataset.role !== 'cell') return;

  // Long-Press scharf schalten
  lpFired = false;
  clearTimeout(lpTimer);
  lpTimer = setTimeout(function(){
    lpFired = true;
    armOrthoOnce();                    // One-Shot aktivieren + Badge
    if (navigator && navigator.vibrate) { try { navigator.vibrate(10); } catch(_){} }
  }, LP_MS);
}, {passive:true});

function clearPointerLP(){ clearTimeout(lpTimer); }
tbodyEl.addEventListener('pointerup',     clearPointerLP, {passive:true});
tbodyEl.addEventListener('pointercancel', clearPointerLP, {passive:true});
tbodyEl.addEventListener('pointerleave',  clearPointerLP, {passive:true});

// ----- Drag-to-Subscribe („Malen“) -----
var wrapEl = $("#matrixWrap");

// mousedown: Start Painting (LMB = normal, RMB = Orthogonal)
tbodyEl.onmousedown = function(ev){
  var td = ev.target && ev.target.closest ? ev.target.closest("td") : null;

  // Wenn Patchen aus ist → Dialog anbieten (nur bei Klick im Zellenbereich)
  if (!editSubsEnabled){
    if (td && td.dataset && td.dataset.role === "cell"){
      var tSubs = $("#toggleSubs");
      var enableNow = function(){
        if (tSubs) tSubs.checked = true;
        editSubsEnabled = true;
        renderMatrix();
      };
      var enableRemember = function(){
        prefSetBool(PREF_ENABLE_ON_CLICK_SUBS, true);
        enableNow();
      };
      showEnableDialog('subs', enableNow, enableRemember);
    }
    return;
  }

  if (!td || td.dataset.role !== "cell") return;
  if (!td.dataset.rxChanId || !td.dataset.txChanId) return;

  var rdi = parseInt(td.dataset.rxDevIndex, 10);
  var rid = td.dataset.rxChanId;
  var tdi = parseInt(td.dataset.txDevIndex, 10);
  var tid = td.dataset.txChanId;

  // Modus anhand Startzelle (wie bisher)
  var rdev = devices[rdi];
  var rx = (rdev && rdev.rx) ? rdev.rx.find(function(x){ return String(x.id)===String(rid); }) : null;
  var txObj = (devices[tdi] && devices[tdi].tx) ? devices[tdi].tx.find(function(x){ return String(x.id)===String(tid); }) : null;
  var already = !!(rx && txObj && rx.subDev === devices[tdi].name && rx.subChan === txObj.label);
  paintMode = already ? "erase" : "add";

  isPainting = true;
  paintVisitedRows = new Set();
  orthoLastHover = null;
  
  // Ortho-Modus kommt nun von One-Shot (Button) ODER Long-Press (Touch)
  isOrthoPaint = !!isOrthoArmed;
  orthoStart = { rdi:rdi, rid:rid, tdi:tdi, tid:tid };

  // Startzelle immer vormerken – wichtig, wenn Ortho erst per Long-Press kommt
  pendingStart = { rdi:rdi, rid:rid, tdi:tdi, tid:tid };

  // Touch / Pen: nicht sofort anwenden, da Long-Press evtl. gleich Ortho schaltet
  var isTouchLike = (ev.pointerType === 'touch' || ev.pointerType === 'pen');
  // (Falls pointerType nicht vorhanden, bleibt isTouchLike === false)

 if (isOrthoPaint){
    // Ortho sofort „armed“ (Button / bereits ausgelöster Long-Press)
    if (wrapEl) wrapEl.classList.add("painting");
    td.classList.add("painting-hover");
    ev.preventDefault();
    return;
  }

  if (isTouchLike){
    // Bei Touch: noch NICHT anwenden – warte auf Long-Press oder MouseUp
    if (wrapEl) wrapEl.classList.add("painting");
    td.classList.add("painting-hover");
    ev.preventDefault();
    return;
  }

  // Desktop/LMB Normal: Startzelle sofort anwenden
  var rowKeyMark = rdi + ":" + rid;
  paintVisitedRows.add(rowKeyMark);
  if (paintMode === "add"){
    setRxSubscriptionRaw(rdi, rid, tdi, tid);
  } else {
    clearRxSubscriptionRaw(rdi, rid);
  }
  if (wrapEl) wrapEl.classList.add("painting");
  td.classList.add("painting-hover");
  ev.preventDefault();
};

// mouseover: während Painting anwenden
tbodyEl.onmouseover = function(ev){
  if (!isPainting) return;
  var td = ev.target && ev.target.closest ? ev.target.closest("td") : null;
  if (!td || td.dataset.role !== "cell") return;

  var rdi = parseInt(td.dataset.rxDevIndex, 10);
  var rid = td.dataset.rxChanId;
  var tdi = parseInt(td.dataset.txDevIndex, 10);
  var tid = td.dataset.txChanId;
  if (!rid || !tid) return;

  if (!isOrthoPaint){
    // Normal (LMB): pro RX-Reihe nur einmal
    var mark = rdi + ":" + rid;
    if (paintVisitedRows.has(mark)) return;
    paintVisitedRows.add(mark);
    if (paintMode === "add"){
      setRxSubscriptionRaw(rdi, rid, tdi, tid);
    } else {
      clearRxSubscriptionRaw(rdi, rid);
    }
    td.classList.add("painting-hover");
    return;
  }

  // Orthogonal (RMB):
  // Erlaubte Richtungen:
  // 1) Vertikal: gleiches TX (tdi,tid) wie Start -> alle berührten RX bekommen START-TX
  // 2) Diagonal: RX & TX ändern sich gleichzeitig -> jeweils aktuelle Zelle wird gesetzt
  // 3) Horizontal: gleiche RX wie Start -> während Drag NICHT anwenden (nur Endpunkt bei mouseup)
  var sameCol = (tdi===orthoStart.tdi && String(tid)===String(orthoStart.tid));
  var sameRow = (rdi===orthoStart.rdi && String(rid)===String(orthoStart.rid));

  // Horizontal -> ignorieren (Endpunkt wird in mouseup behandelt)
  if (sameRow && !sameCol){
    orthoLastHover = td;
    td.classList.add("painting-hover");
    return;
  }

  var inPairing = (rdi === orthoStart.rdi) && (tdi === orthoStart.tdi);
  if (!inPairing){
    orthoLastHover = td; // für evtl. Endpunktanzeige ohne Aktion
    td.classList.add("painting-hover");
    return;
  }

  // Vertikal (gleiche Spalte): setze START-TX auf jede neue RX-Zeile
  if (sameCol && !sameRow){
    var m1 = rdi + ":" + rid;
    if (!paintVisitedRows.has(m1)){
      paintVisitedRows.add(m1);
      if (paintMode === "add"){
        setRxSubscriptionRaw(rdi, rid, orthoStart.tdi, orthoStart.tid);
      } else {
        clearRxSubscriptionRaw(rdi, rid);
      }
    }
    orthoLastHover = td;
    td.classList.add("painting-hover");
    return;
  }

  // Diagonal innerhalb der Paarung (RX & TX-Kanal ändern sich, Geräte bleiben)
  if (!sameCol && !sameRow){
    var m2 = rdi + ":" + rid;
    if (!paintVisitedRows.has(m2)){
      paintVisitedRows.add(m2);
      if (paintMode === "add"){
        setRxSubscriptionRaw(rdi, rid, tdi, tid);
      } else {
        clearRxSubscriptionRaw(rdi, rid);
      }
    }
    orthoLastHover = td;
    td.classList.add("painting-hover");
    return;
  }
};

// mouseup: Painting beenden, bei RMB ggf. Endpunkt (Horizontal) anwenden
document.onmouseup = function(){
  if (!isPainting) return;

  if (isOrthoPaint && orthoStart){
    var startRDev = devices[orthoStart.rdi];
    var startTDev = devices[orthoStart.tdi];
    if (startRDev && startTDev && orthoLastHover){
      var endRdi = parseInt(orthoLastHover.dataset.rxDevIndex, 10);
      var endRid = orthoLastHover.dataset.rxChanId;
      var endTdi = parseInt(orthoLastHover.dataset.txDevIndex, 10);
      var endTid = orthoLastHover.dataset.txChanId;

      var sameRow = (endRdi===orthoStart.rdi && String(endRid)===String(orthoStart.rid));
      var sameCol = (endTdi===orthoStart.tdi && String(endTid)===String(orthoStart.tid));

      // **Paarungsgrenze**: innerhalb Start-RX-Gerät & Start-TX-Gerät bleiben
      var inPairing = (endRdi===orthoStart.rdi) && (endTdi===orthoStart.tdi);

      // Sichtbarkeit erfassen (nur aktuell angezeigte Kanäle berücksichtigen)
      var base = computeVisibleBase();
      var visRow = new Set();  // Schlüssel: "<rxDevIndex>:<rxId>"
      var visCol = new Set();  // Schlüssel: "<txDevIndex>:<txId>"
      base.visRows.forEach(function(r){
        if (!r.isDevice && r.rx) visRow.add(r.devIndex + ":" + r.rx.id);
      });
      base.visCols.forEach(function(c){
        if (!c.isDevice && c.tx) visCol.add(c.devIndex + ":" + c.tx.id);
      });
      function isVisibleRx(di, rid){ return visRow.has(di + ":" + rid); }
      function isVisibleTx(di, tid){ return visCol.has(di + ":" + tid); }

      // 1) HORIZONTAL: nur Endpunkt
      if (sameRow && !sameCol){
        if (endTdi === orthoStart.tdi){
          // nur wenn RX-Endpunkt & TX-Endpunkt sichtbar sind
          if (isVisibleRx(orthoStart.rdi, orthoStart.rid) && isVisibleTx(endTdi, endTid)){
            if (paintMode === "add"){
              setRxSubscriptionRaw(orthoStart.rdi, orthoStart.rid, endTdi, endTid);
            } else {
              clearRxSubscriptionRaw(orthoStart.rdi, orthoStart.rid);
            }
          }
        }
      }

      // 2) VERTIKAL: gleiche Spalte → von Start bis Geräteende (Richtung des Zugs)
      if (sameCol && !sameRow){
        var aRx = startRDev.rx || [];
        var sIdx = rxIndexOf(startRDev, orthoStart.rid);
        var eIdx = rxIndexOf(startRDev, endRid);
        if (sIdx >= 0 && eIdx >= 0){
          var down = (eIdx > sIdx);
          var first = 0, last = aRx.length - 1;
          // bis zum Geräteende in Zugrichtung
          var stop = down ? last : first;
          var step = down ? 1 : -1;
          for (var i = sIdx; i !== (stop + step); i += step){
            var rid = aRx[i].id;
            // nur sichtbare RX-Zeile & sichtbare Start-TX-Spalte
            if (!isVisibleRx(orthoStart.rdi, rid) || !isVisibleTx(orthoStart.tdi, orthoStart.tid)) continue;

            if (paintMode === "add"){
              setRxSubscriptionRaw(orthoStart.rdi, rid, orthoStart.tdi, orthoStart.tid);
            } else {
              clearRxSubscriptionRaw(orthoStart.rdi, rid);
            }
          }
        }
      }

      // 3) DIAGONAL: RX & TX wechseln → in Zugrichtung bis Geräteende beider Listen
      if (!sameCol && !sameRow && inPairing){
        var aRx2 = startRDev.rx || [];
        var aTx2 = startTDev.tx || [];
        var sR = rxIndexOf(startRDev, orthoStart.rid);
        var sT = txIndexOf(startTDev, orthoStart.tid);
        var eR = rxIndexOf(startRDev, endRid);
        var eT = txIndexOf(startTDev, endTid);
        if (sR>=0 && sT>=0 && eR>=0 && eT>=0){
          var rDown = (eR > sR);
          var tDown = (eT > sT);
          // Nur „saubere“ Diagonale in gleiche Richtung; andernfalls ignoriere
          if ((rDown && tDown) || (!rDown && !tDown)){
            var rFirst = 0, rLast = aRx2.length - 1;
            var tFirst = 0, tLast = aTx2.length - 1;
            var rStop = rDown ? rLast : rFirst;
            var tStop = tDown ? tLast : tFirst;
            var rStep = rDown ? 1 : -1;
            var tStep = tDown ? 1 : -1;

            var r = sR, t = sT;
            // bis zum Ende einer Liste – wer zuerst „zu Ende“ ist, begrenzt
            while (true){
              var rid = aRx2[r].id;
              var tid = aTx2[t].id;

              // nur wenn RX-Zeile & TX-Spalte aktuell sichtbar sind
              if (isVisibleRx(orthoStart.rdi, rid) && isVisibleTx(orthoStart.tdi, tid)){
                if (paintMode === "add"){
                  setRxSubscriptionRaw(orthoStart.rdi, rid, orthoStart.tdi, tid);
                } else {
                  clearRxSubscriptionRaw(orthoStart.rdi, rid);
                }
              }

              if (r === rStop || t === tStop) break;
              r += rStep; t += tStep;
            }
          }
        }
      }
    }
  }

  // Cleanup & persist
  isPainting = false;
  isOrthoPaint = false;
  paintMode = null;
  paintVisitedRows = null;
  orthoStart = null;
  orthoLastHover = null;
  pendingStart = null;   // << wichtig: aufräumen

  // Ortho ist One-Shot
  disarmOrtho();

  var wrapEl = $("#matrixWrap");
  if (wrapEl) wrapEl.classList.remove("painting");
  renderMatrix();
  persist();
};
}

// --------- Edit-Helfer ----------
function makeEditable(span, apply){
  var done = false;
  function finish(){
    if(done) return;
    done = true;
    span.removeEventListener("blur", onBlur);
    span.removeEventListener("keydown", onKey);
    var val = (span.textContent||"").trim();
    apply(val);
  }
  function onBlur(){ finish(); }
  function onKey(e){ if(e.key==="Enter"){ e.preventDefault(); span.blur(); } }
  span.addEventListener("blur", onBlur);
  span.addEventListener("keydown", onKey);
  span.focus();
  if(document.execCommand) try{ document.execCommand("selectAll", false, null); }catch(_){}
}

// --------- Umbenennungen ----------
function renameDevice(span, kind, newName){
  var di = parseInt(span.dataset.devIndex, 10);
  if (isNaN(di) || !devices[di]) return;

  var dev = devices[di];
  var oldName = (dev.name || "").trim();
  newName = (newName || "").trim();
  if (!newName || newName === oldName) return;

  var nameEl = dev.el.querySelector("name");
  if (!nameEl) { nameEl = xmlDoc.createElement("name"); dev.el.insertBefore(nameEl, dev.el.firstChild); }
  nameEl.textContent = newName;
  dev.name = newName;

  // Referenzen in Subscriptions anpassen
  for (var r = 0; r < rows.length; r++) {
    var rxrow = rows[r];
    if ((rxrow.rx.subDev || "").trim() === oldName) {
      var sd = rxrow.rx.el.querySelector("subscribed_device");
      if (!sd) { sd = xmlDoc.createElement("subscribed_device"); rxrow.rx.el.appendChild(sd); }
      sd.textContent = newName;
      rxrow.rx.subDev = newName;
    }
  }

  renderMatrix();
  persist();
}
function renameTxChannel(span, newLabel){
  var di = parseInt(span.dataset.devIndex, 10);
  var cid = span.dataset.chanId || "";
  if(isNaN(di) || !devices[di]) return;
  var dev = devices[di];

  var tx = null;
  for(var i=0;i<dev.tx.length;i++){ if(String(dev.tx[i].id) === String(cid)) { tx = dev.tx[i]; break; } }
  if(!tx) return;

  var oldLabel = tx.label || "";
  var labEl = tx.el.querySelector("label");
  if(!labEl){ labEl = xmlDoc.createElement("label"); tx.el.appendChild(labEl); }
  labEl.textContent = newLabel;
  tx.label = newLabel;

  // RX-Subs, die auf altes Label zeigten, umbiegen
  for(var r=0;r<rows.length;r++){
    var row = rows[r];
    if(row.rx.subDev === dev.name && row.rx.subChan === oldLabel){
      var sc = row.rx.el.querySelector("subscribed_channel");
      if(!sc){ sc = xmlDoc.createElement("subscribed_channel"); row.rx.el.appendChild(sc); }
      sc.textContent = newLabel;
      row.rx.subChan = newLabel;
    }
  }

  renderMatrix();
  persist();
}
function renameRxChannel(span, newName){
  var di = parseInt(span.dataset.devIndex, 10);
  var cid = span.dataset.chanId || "";
  if(isNaN(di) || !devices[di]) return;
  var dev = devices[di];

  var rx = null;
  for(var i=0;i<dev.rx.length;i++){ if(String(dev.rx[i].id) === String(cid)) { rx = dev.rx[i]; break; } }
  if(!rx) return;

  var nEl = rx.el.querySelector("name");
  if(!nEl){ nEl = xmlDoc.createElement("name"); rx.el.insertBefore(nEl, rx.el.firstChild); }
  nEl.textContent = newName;
  rx.name = newName;

  renderMatrix();
  persist();
}

// --------- Subscription Toggle (Einzelklick) ----------
function toggleSubscription(td){
  var rdi = parseInt(td.dataset.rxDevIndex, 10);
  var rid = td.dataset.rxChanId || "";
  var tdi = parseInt(td.dataset.txDevIndex, 10);
  var tid = td.dataset.txChanId || "";

  if(isNaN(rdi) || isNaN(tdi)) return;
  var rdev = devices[rdi], tdev = devices[tdi];
  if(!rdev || !tdev) return;

  var rx = null, tx = null, i;
  for(i=0;i<rdev.rx.length;i++){ if(String(rdev.rx[i].id) === String(rid)) { rx = rdev.rx[i]; break; } }
  for(i=0;i<tdev.tx.length;i++){ if(String(tdev.tx[i].id) === String(tid)) { tx = tdev.tx[i]; break; } }
  if(!rx || !tx) return;

  var already = (rx.subDev === tdev.name && rx.subChan === tx.label);
  if(already){
    var sd = rx.el.querySelector("subscribed_device");
    var sc = rx.el.querySelector("subscribed_channel");
    if(sd) sd.textContent = "";
    if(sc) sc.textContent = "";
    rx.subDev = ""; rx.subChan = "";
  } else {
    var sd2 = rx.el.querySelector("subscribed_device");
    var sc2 = rx.el.querySelector("subscribed_channel");
    if(!sd2){ sd2 = xmlDoc.createElement("subscribed_device"); rx.el.appendChild(sd2); }
    if(!sc2){ sc2 = xmlDoc.createElement("subscribed_channel"); rx.el.appendChild(sc2); }
    sd2.textContent = tdev.name; sc2.textContent = tx.label;
    rx.subDev = tdev.name; rx.subChan = tx.label;
  }

  renderMatrix();
  persist();
}

// --------- Persistenz ----------
function persist(){
  try{
    var s = new XMLSerializer().serializeToString(xmlDoc);
    writeToSessionAndName(s);
  }catch(e){
    var h = $("#hint"); if(h) h.textContent = "Persist-Fehler: " + (e.message || String(e));
  }
}

// --------- UI Bindings ----------
function bindUI(){
var tSubs  = $("#toggleSubs");
  var tNames = $("#toggleNames");

  // Initialzustand aus Präferenzen übernehmen
  var autoSubs  = prefGetBool(PREF_ENABLE_ON_CLICK_SUBS);
  var autoNames = prefGetBool(PREF_ENABLE_ON_CLICK_NAMES);

  if (tSubs){
    if (autoSubs) { tSubs.checked = true; editSubsEnabled = true; }
    tSubs.addEventListener("change", function(e){
      editSubsEnabled = !!e.target.checked;
      renderMatrix();
    });
  }
  if (tNames){
    if (autoNames) { tNames.checked = true; editNamesEnabled = true; }
    tNames.addEventListener("change", function(e){
      editNamesEnabled = !!e.target.checked;
      renderMatrix();
    });
  }

  ["fTx","fRx"].forEach(function(id){
    var el = $("#"+id); if(!el) return;
    el.addEventListener("input", function(){ renderMatrix(); });
  });

  var chkRows = $("#onlyRowsWithSubs");
  var chkCols = $("#onlyColsWithSubs");
if (chkRows) {
  chkRows.addEventListener("change", function (e) {
    if (e.target.checked) {
      // Basis nach aktuellem Textfilter/Collapse
      var base = computeVisibleBase();
      // nur RX-Zeilen mit Subscription (Geräte-Zeilen bleiben)
      var setR = new Set();
      base.visRows.forEach(function (r) {
        if (r.isDevice) {
          setR.add(rowKey(r.devIndex, null));
        } else if (r.rx && r.rx.subDev) {
          setR.add(rowKey(r.devIndex, r.rx.id));
        }
      });
      // nur Rows einfrieren – Cols unberührt lassen
      frozenRows = setR;
    } else {
      frozenRows = null;
    }
    renderMatrix();
  });
}

if (chkCols) {
  chkCols.addEventListener("change", function (e) {
    if (e.target.checked) {
      var base = computeVisibleBase();
      // ermitteln, welche TX-Spalten überhaupt benutzt werden
      var used = new Set();
      base.visRows.forEach(function (r) {
        if (r.isDevice) return;
        var sd = r.rx.subDev, sc = r.rx.subChan;
        if (!sd || !sc) return;
        base.visCols.forEach(function (c) {
          if (c.isDevice) return;
          if (c.dev.name === sd && c.tx.label === sc) {
            used.add(colKey(c.devIndex, c.tx.id));
          }
        });
      });
      // nur Cols einfrieren – Rows unberührt lassen
      var setC = new Set();
      base.visCols.forEach(function (c) {
        var key = colKey(c.devIndex, c.isDevice ? null : (c.tx && c.tx.id));
        if (c.isDevice || used.has(colKey(c.devIndex, c.tx.id))) setC.add(key);
      });
      frozenCols = setC;
    } else {
      frozenCols = null;
    }
    renderMatrix();
  });
}

  // Speichern & zurück
  var back = $("#btnSaveBack");
  if(back){
    back.addEventListener("click", function(){
      persist();  // sicher speichern
      location.href = "./Index.html#via=matrix";
    });
  }

  // Fallback „nur zurück“ (falls vorhanden)
  var back2 = $("#btnBack");
  if(back2){
    back2.addEventListener("click", function(){
      persist();
      location.href = "./Index.html#via=matrix";
    });
  }
}

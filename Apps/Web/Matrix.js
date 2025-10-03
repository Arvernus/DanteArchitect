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

// --------- Helpers ----------
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

    // Safety: beim Verlassen/Verstecken persistieren
    window.addEventListener("beforeunload", persist, {capture:true});
    window.addEventListener("pagehide", persist, {capture:true});

  }catch(e){
    var h = $("#hint");
    if(h) h.textContent = "Init-Fehler: " + (e.message || String(e));
  }
})();

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

    // Kanal-Selektion (wenn kein Dev-Treffer)
    var txList;
    if (!tTx.length || devNameMatchTx) {
      txList = d.tx.slice();
    } else {
      txList = d.tx.filter(function(tx){
        // nur Kanal-Label prüfen (Gerätename traf ja nicht)
        return fieldsMatchTokens([tx.label], tTx);
      });
    }

    // nichts passt → Gerät ausblenden
    if (txList.length === 0 && !devNameMatchTx) return;

    if (collapsedTx[di]) {
      // collapsed: Kopf zeigen, wenn Gerät matcht ODER mind. ein Kanal passt
      visCols.push({ dev:d, devIndex: di, isDevice:true, tx:null });
    } else {
      txList.forEach(function(tx){
        visCols.push({ dev:d, devIndex: di, isDevice:false, tx:tx });
      });
    }
  });

var visRows = [];
  devices.forEach(function(d, di){
    var devNameMatchRx = fieldsMatchTokens([d.name], tRx);

    // Kanal-Selektion (wenn kein Dev-Treffer)
    var rxList;
    if (!tRx.length || devNameMatchRx) {
      rxList = d.rx.slice();
    } else {
      rxList = d.rx.filter(function(rx){
        return fieldsMatchTokens([rx.name], tRx);
      });
    }

    if (rxList.length === 0 && !devNameMatchRx) return;

    if (collapsedRx[di]) {
      visRows.push({ dev:d, devIndex: di, isDevice:true, rx:null });
    } else {
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
  var thRXDev = cel("th","top-left-0","RX Gerät"); thRXDev.style.minWidth="220px";
  var thRXChan= cel("th","top-left-1","RX Kanal");  thRXChan.style.minWidth="180px";
  tr0.appendChild(thRXDev); 
  tr0.appendChild(thRXChan);

  // TX-Spalten nach Geräten gruppieren
  var groupRuns = [], run = null;
  for(var cidx=0;cidx<visCols.length;cidx++){
    var c = visCols[cidx];
    var dIdx = c.devIndex;
    if(!run || run.devIndex !== dIdx){
      run = { name: c.dev.name, dev: c.dev, devIndex: dIdx, cols: [], count: 0 };
      groupRuns.push(run);
    }
    run.cols.push(c); run.count++;
  }

  // TX-Gruppen-Header rendern
  for(var g=0; g<groupRuns.length; g++){
    var grp = groupRuns[g];
    var th = cel("th","group"); 
    th.colSpan = grp.count; 
    th.style.background = "#f0f0f0";

    var toggle = cel("button","btn", collapsedTx[grp.devIndex] ? "+" : "–");
    toggle.dataset.role = "toggle-tx"; 
    toggle.dataset.devIndex = String(grp.devIndex); 
    toggle.style.marginRight = "6px";

    // Namensanzeige: zweizeilig Prefix/Suffix wenn aktiv, sonst einzeilig
    var partsTX = splitName(grp.name || "");
    var stackTX = cel("span","name-stack","");
    var topTX = cel("span","name-prefix", partsTX.prefix || "");
    var botTX = cel("span","name-suffix editable", partsTX.suffix || "");

    if (editNamesEnabled){
      if (nameConceptEnabled()){
        // Nur Suffix editierbar
        botTX.dataset.role = "dev-suffix-tx";
        botTX.dataset.devIndex = String(grp.devIndex);
        botTX.contentEditable = "true";
      } else {
        // Fallback: kompletter Name editierbar
        botTX.textContent = grp.name || "(ohne Name)";
        botTX.dataset.role = "dev-name-tx";
        botTX.dataset.devIndex = String(grp.devIndex);
        botTX.contentEditable = "true";
        topTX.textContent = ""; // keine Zweizeile
      }
    } else {
      if (!nameConceptEnabled()){
        botTX.textContent = grp.name || "(ohne Name)";
        topTX.textContent = "";
      }
    }

    stackTX.appendChild(topTX);
    stackTX.appendChild(botTX);
    th.appendChild(toggle);
    th.appendChild(stackTX);
    tr0.appendChild(th);
  }
  thead.appendChild(tr0);

  // ----- Kopfzeile 2 (TX-Kanäle) -----
  var tr1 = cel("tr");
  tr1.appendChild(cel("th","rowhead","")); // unter RX Gerät
  tr1.appendChild(cel("th","rowchan","")); // unter RX Kanal
  for(var i=0;i<visCols.length;i++){
    var cc = visCols[i];
    var thc = cel("th","tx-chan");
    if (cc.isDevice) {
      thc.style.background = "#f7f7f7";
      thc.textContent = "";
    } else {
      var spc = cel("span","editable", cc.tx.label || "");
      spc.dataset.role = "tx-chan";
      spc.dataset.devIndex = String(cc.devIndex);
      spc.dataset.chanId   = String(cc.tx.id);
      if(editNamesEnabled){ spc.contentEditable = "true"; }
      thc.appendChild(spc);
    }
    tr1.appendChild(thc);
  }
  thead.appendChild(tr1);

  // ----- Tabellenkörper -----
  for(var r=0; r<visRows.length; r++){
    var row = visRows[r];
    var tr = cel("tr");

    var thD = cel("th","rowhead"); 
    thD.style.background = "#f0f0f0";
    var toggleRx = cel("button","btn", collapsedRx[row.devIndex] ? "+" : "–");
    toggleRx.dataset.role = "toggle-rx"; 
    toggleRx.dataset.devIndex = String(row.devIndex); 
    toggleRx.style.marginRight = "6px";

    // RX-Gerätename (Prefix/Suffix)
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
    thD.appendChild(toggleRx);
    thD.appendChild(stackRX);
    tr.appendChild(thD);

    // RX-Kanalspalte
    var thC = cel("th","rowchan");
    if (row.isDevice) { 
      thC.style.background = "#f7f7f7"; 
      thC.textContent = ""; 
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
    for(var x=0; x<visCols.length; x++){
      var col = visCols[x];
      var cellEditable = (editSubsEnabled && !row.isDevice && !col.isDevice);
      var td = cel("td", "cell" + (cellEditable ? " editable" : ""), "");
      var isSub = (!row.isDevice && !col.isDevice) &&
                  (row.rx.subDev === col.dev.name && row.rx.subChan === col.tx.label);
      if(isSub){ td.appendChild(cel("span","dot","")); }
      td.dataset.role = "cell";
      td.dataset.rxDevIndex = String(row.devIndex);
      td.dataset.rxChanId   = row.isDevice ? "" : String(row.rx.id);
      td.dataset.txDevIndex = String(col.devIndex);
      td.dataset.txChanId   = col.isDevice ? "" : String(col.tx.id);
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

    if(editSubsEnabled && t.dataset.role === "cell"){
      if(!t.dataset.rxChanId || !t.dataset.txChanId) return;
      toggleSubscription(t); 
      return;
    }
  };

  // ----- Drag-to-Subscribe („Malen“) -----
  var wrapEl = $("#matrixWrap");

  // mousedown: Start Painting
  tbodyEl.onmousedown = function(ev){
    if (!editSubsEnabled) return;
    if (ev.button !== 0) return; // nur linke Maustaste
    var td = ev.target.closest("td");
    if (!td || td.dataset.role !== "cell") return;
    if (!td.dataset.rxChanId || !td.dataset.txChanId) return;

    isPainting = true;
    paintVisitedRows = new Set();

    var rdi = parseInt(td.dataset.rxDevIndex, 10);
    var rid = td.dataset.rxChanId;
    var tdi = parseInt(td.dataset.txDevIndex, 10);
    var tid = td.dataset.txChanId;

    // Modus bestimmen anhand der Startzelle
    var rdev = devices[rdi];
    var rx = (rdev && rdev.rx) ? rdev.rx.find(function(x){ return String(x.id)===String(rid); }) : null;
    var txObj = (devices[tdi] && devices[tdi].tx) ? devices[tdi].tx.find(function(x){ return String(x.id)===String(tid); }) : null;
    var already = !!(rx && txObj && rx.subDev === devices[tdi].name && rx.subChan === txObj.label);
    paintMode = already ? "erase" : "add";

    // Startzelle anwenden
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
    var td = ev.target.closest("td");
    if (!td || td.dataset.role !== "cell") return;

    var rdi = parseInt(td.dataset.rxDevIndex, 10);
    var rid = td.dataset.rxChanId;
    var tdi = parseInt(td.dataset.txDevIndex, 10);
    var tid = td.dataset.txChanId;
    if (!rid || !tid) return;

    var mark = rdi + ":" + rid;
    if (paintVisitedRows.has(mark)) return;
    paintVisitedRows.add(mark);

    if (paintMode === "add"){
      setRxSubscriptionRaw(rdi, rid, tdi, tid);
    } else {
      clearRxSubscriptionRaw(rdi, rid);
    }

    td.classList.add("painting-hover");
  };

  // mouseup: Painting beenden, einmal rendern & persistieren
  document.onmouseup = function(){
    if (!isPainting) return;
    isPainting = false;
    paintMode = null;
    paintVisitedRows = null;
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
  if(tSubs){ tSubs.addEventListener("change", function(e){ editSubsEnabled = !!e.target.checked; renderMatrix(); }); }
  if(tNames){ tNames.addEventListener("change", function(e){ editNamesEnabled = !!e.target.checked; renderMatrix(); }); }

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

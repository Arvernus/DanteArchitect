// Apps/Web/Matrix.js

// --------- Konstanten / Storage-Key ----------
var LS_KEY = "DA_PRESET_XML"; // Startseite legt hier das geladene Preset ab

// --------- Working State ----------
var xmlDoc = null;
var devices = [];   // {name, el, tx:[{el,label,id}], rx:[{el,name,id,subDev,subChan}]}
var cols = [];      // flache Liste aller TX-Spalten (mit Geräte-Ref)
var rows = [];      // flache Liste aller RX-Reihen (mit Geräte-Ref)

// Edit-States
var editSubsEnabled  = false; // Schalter: Bearbeiten/Abonnements
var editNamesEnabled = false; // Schalter: Bearbeiten/Namen-Labels

// Kollaps-Status für Gruppen (TX=Spalten-Gruppen, RX=Zeilen-Gruppen)
var collapsedTx = Object.create(null);  // key = device index → true/false
var collapsedRx = Object.create(null);

// „Eingefrorene“ Mengen, wenn „Nur … mit Subs“ aktiviert wurde
var frozenCols = null; // Set aus keys "tx:<devIndex>:<chanId>" ODER "txdev:<devIndex>" für kollabierten Device-Platzhalter
var frozenRows = null; // Set aus keys "rx:<devIndex>:<chanId>" ODER "rxdev:<devIndex>"

// --------- Helpers ----------
function $(s){ return document.querySelector(s); }
function cel(tag, cls, txt){ var e=document.createElement(tag); if(cls) e.className=cls; if(txt!=null) e.textContent=txt; return e; }
function norm(s){ return (s||"").toLowerCase(); }
function colKey(devIndex, chanId){ return chanId ? ("tx:"+devIndex+":"+chanId) : ("txdev:"+devIndex); }
function rowKey(devIndex, chanId){ return chanId ? ("rx:"+devIndex+":"+chanId) : ("rxdev:"+devIndex); }
function isFrozenColsMode(){ return !!frozenCols; }
function isFrozenRowsMode(){ return !!frozenRows; }

// Sichtbarkeit (ohne Frozen) einmal berechnen – wird in Render & Freeze genutzt
function computeVisibleBase(){
  var fTxEl = $("#fTx"), fRxEl = $("#fRx");
  var fTx = norm(fTxEl ? fTxEl.value : "");
  var fRx = norm(fRxEl ? fRxEl.value : "");

  function deviceMatchesTx(dev){
    if(!fTx) return true;
    if(norm(dev.name).indexOf(fTx) >= 0) return true;
    for(var i=0;i<dev.tx.length;i++){
      if(norm(dev.tx[i].label).indexOf(fTx) >= 0) return true;
    }
    return false;
  }
  function deviceMatchesRx(dev){
    if(!fRx) return true;
    if(norm(dev.name).indexOf(fRx) >= 0) return true;
    for(var i=0;i<dev.rx.length;i++){
      if(norm(dev.rx[i].name).indexOf(fRx) >= 0) return true;
    }
    return false;
  }

  var visCols = [];
  devices.forEach(function(d, di){
    if(!deviceMatchesTx(d)) return;
    if(collapsedTx[di]) {
      visCols.push({ dev:d, devIndex: di, isDevice:true, tx:null });
    } else {
      d.tx.forEach(function(tx){
        visCols.push({ dev:d, devIndex: di, isDevice:false, tx:tx });
      });
    }
  });

  var visRows = [];
  devices.forEach(function(d, di){
    if(!deviceMatchesRx(d)) return;
    if(collapsedRx[di]) {
      visRows.push({ dev:d, devIndex: di, isDevice:true, rx:null });
    } else {
      d.rx.forEach(function(rx){
        visRows.push({ dev:d, devIndex: di, isDevice:false, rx:rx });
      });
    }
  });

  return { visCols: visCols, visRows: visRows };
}

/** Erzeuge eine „eingefrorene“ Menge basierend auf der momentanen Ansicht (nur beim Aktivieren) */
function freezeVisible(current){
  // Spalten einfrieren?
  var onlyCols = $("#onlyColsWithSubs");
  if(onlyCols && onlyCols.checked){
    var set = new Set();
    current.visCols.forEach(function(c){
      set.add(colKey(c.devIndex, c.isDevice ? null : (c.tx && c.tx.id)));
    });
    frozenCols = set;
  } else {
    frozenCols = null;
  }
  // Zeilen einfrieren?
  var onlyRows = $("#onlyRowsWithSubs");
  if(onlyRows && onlyRows.checked){
    var setR = new Set();
    current.visRows.forEach(function(r){
      setR.add(rowKey(r.devIndex, r.isDevice ? null : (r.rx && r.rx.id)));
    });
    frozenRows = setR;
  } else {
    frozenRows = null;
  }
}

// --------- Init ----------
(function init(){
  try{
    var xml = null, source = "none";

    // 1) zuerst localStorage
    try {
      xml = localStorage.getItem(LS_KEY);
      if (xml && xml.trim()) source = "localStorage";
    } catch(_) { xml = null; }

    // 2) dann sessionStorage
    if (!xml || !xml.trim()){
      try {
        xml = sessionStorage.getItem(LS_KEY);
        if (xml && xml.trim()) source = "sessionStorage";
      } catch(_) { xml = null; }
    }

    // 3) dann window.name (vom Index gesetzt)
    if (!xml || !xml.trim()){
      try{
        if (window.name) {
          var payload = null;
          try { payload = JSON.parse(window.name); } catch(_) {}
          if (payload && payload.type === "DA_PRESET" && payload.xml) {
            xml = String(payload.xml);
            source = "window.name";
            // best effort zurückschreiben
            try { localStorage.setItem(LS_KEY, xml); } catch(_) {}
            try { sessionStorage.setItem(LS_KEY, xml); } catch(_) {}
          }
        }
      }catch(_){ xml = null; }
    }

    if (!xml || !xml.trim()){
      var hint = $("#hint");
      if(hint) hint.innerHTML = "⚠️ <span class='warn'>Kein Preset gefunden.</span> Bitte zur Übersicht zurück und Preset laden.";
      console.warn("Matrix init: no XML found in any source.");
      return;
    }

    console.info("Matrix init: XML loaded from", source);

    // XML parsen
    var p = new DOMParser();
    xmlDoc = p.parseFromString(xml, "application/xml");
    var err = xmlDoc.querySelector("parsererror");
    if(err){
      var hi = $("#hint"); if(hi) hi.textContent = "XML Fehler: " + err.textContent;
      return;
    }

    // Preset-Name in Chip
    var pname = xmlDoc.querySelector("preset > name");
    var chip = $("#presetNameChip");
    if(pname && chip) chip.textContent = "Preset: " + pname.textContent;

    buildModel();
    renderMatrix();
    bindUI();
  }catch(e){
    var h = $("#hint");
    if(h) h.textContent = "Init-Fehler: " + (e.message || String(e));
    console.error("Matrix init error:", e);
  }
})();

// --------- Model-Aufbau ----------
function buildModel(){
  devices = [];
  cols = [];
  rows = [];

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
    d.tx.forEach(function(tx){
      cols.push({ dev:d, tx:tx });
    });
  });
  devices.forEach(function(d){
    d.rx.forEach(function(rx){
      rows.push({ dev:d, rx:rx });
    });
  });
}

// --------- Render ----------
function renderMatrix(){
  var thead = $("#thead"), tbody = $("#tbody");
  if(!thead || !tbody) return;
  thead.innerHTML = "";
  tbody.innerHTML  = "";

  // Basis-Sichtbarkeit berechnen
  var base = computeVisibleBase();
  var visCols = base.visCols.slice();
  var visRows = base.visRows.slice();

  // Falls „eingefroren“ aktiv → auf eingefrorene Teilmengen reduzieren
  if(isFrozenColsMode()){
    visCols = visCols.filter(function(c){
      return frozenCols.has(colKey(c.devIndex, c.isDevice ? null : (c.tx && c.tx.id)));
    });
  }
  if(isFrozenRowsMode()){
    visRows = visRows.filter(function(r){
      return frozenRows.has(rowKey(r.devIndex, r.isDevice ? null : (r.rx && r.rx.id)));
    });
  }

  // --- Header: Gruppe TX-Geräte ---
  var tr0 = cel("tr");
  var thRXDev = cel("th","top-left-0","RX Gerät"); thRXDev.style.minWidth="220px";
  var thRXChan= cel("th","top-left-1","RX Kanal");  thRXChan.style.minWidth="180px";
  tr0.appendChild(thRXDev); tr0.appendChild(thRXChan);

  // device-Runs aus visCols bilden
  var groupRuns = [];
  var run = null;
  for(var cidx=0;cidx<visCols.length;cidx++){
    var c = visCols[cidx];
    var dIdx = c.devIndex;
    if(!run || run.devIndex !== dIdx){
      run = { name: c.dev.name, dev: c.dev, devIndex: dIdx, cols: [], count: 0 };
      groupRuns.push(run);
    }
    run.cols.push(c);
    run.count++;
  }

  for(var g=0; g<groupRuns.length; g++){
    var grp = groupRuns[g];
    var th = cel("th","group");
    th.colSpan = grp.count;
    th.style.background = "#f0f0f0";

    // Toggle Button (kollabieren/aufklappen)
    var toggle = cel("button","btn", collapsedTx[grp.devIndex] ? "+" : "–");
    toggle.dataset.role = "toggle-tx";
    toggle.dataset.devIndex = String(grp.devIndex);
    toggle.style.marginRight = "6px";

    // Name (editable nur im Namen-Modus)
    var span = cel("span","editable", grp.name || "(ohne Name)");
    span.dataset.role = "dev-name-tx";
    span.dataset.devIndex = String(grp.devIndex);
    if(editNamesEnabled){ span.contentEditable = "true"; }

    th.appendChild(toggle);
    th.appendChild(span);
    tr0.appendChild(th);
  }

  // --- Header: TX Kanalzeile ---
  var tr1 = cel("tr");
  tr1.appendChild(cel("th","rowhead",""));
  tr1.appendChild(cel("th","rowchan",""));
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

  thead.appendChild(tr0);
  thead.appendChild(tr1);

  // --- Body: RX Zeilen ---
  for(var r=0; r<visRows.length; r++){
    var row = visRows[r];
    var tr = cel("tr");

    // RX-Gerätename (links, grau, mit Toggle)
    var thD = cel("th","rowhead");
    thD.style.background = "#f0f0f0";
    var toggleRx = cel("button","btn", collapsedRx[row.devIndex] ? "+" : "–");
    toggleRx.dataset.role = "toggle-rx";
    toggleRx.dataset.devIndex = String(row.devIndex);
    toggleRx.style.marginRight = "6px";

    var dspan = cel("span","editable", row.dev.name || "(ohne Name)");
    dspan.dataset.role = "dev-name-rx";
    dspan.dataset.devIndex = String(row.devIndex);
    if(editNamesEnabled){ dspan.contentEditable = "true"; }
    thD.appendChild(toggleRx);
    thD.appendChild(dspan);
    tr.appendChild(thD);

    // RX-Kanalname (nur wenn nicht kollabiert)
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
      if(isSub){
        var dot = cel("span","dot","");
        td.appendChild(dot);
      }
      td.dataset.role = "cell";
      td.dataset.rxDevIndex = String(row.devIndex);
      td.dataset.rxChanId   = row.isDevice ? "" : String(row.rx.id);
      td.dataset.txDevIndex = String(col.devIndex);
      td.dataset.txChanId   = col.isDevice ? "" : String(col.tx.id);
      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  }

  // --- Interaktion (delegiert) ---
  thead.onclick = tbody.onclick = function(ev){
    var t = ev.target;
    if(!t || !t.dataset) return;

    // Kollaps/Expand
    if(t.dataset.role === "toggle-tx"){
      var di = parseInt(t.dataset.devIndex,10);
      collapsedTx[di] = !collapsedTx[di];
      renderMatrix();
      return;
    }
    if(t.dataset.role === "toggle-rx"){
      var di2 = parseInt(t.dataset.devIndex,10);
      collapsedRx[di2] = !collapsedRx[di2];
      renderMatrix();
      return;
    }

    // Namen/Labels bearbeiten (nur wenn erlaubt)
    if(editNamesEnabled){
      if(t.dataset.role === "dev-name-tx"){ makeEditable(t, function(newVal){ renameDevice(t, "tx", newVal); }); return; }
      if(t.dataset.role === "tx-chan"){ makeEditable(t, function(newVal){ renameTxChannel(t, newVal); }); return; }
      if(t.dataset.role === "dev-name-rx"){ makeEditable(t, function(newVal){ renameDevice(t, "rx", newVal); }); return; }
      if(t.dataset.role === "rx-chan"){ makeEditable(t, function(newVal){ renameRxChannel(t, newVal); }); return; }
    }

    // Subscriptions toggeln (nur wenn erlaubt)
    if(editSubsEnabled && t.dataset.role === "cell"){
      // nur echte Kanal-Kombinationen erlauben
      if(!t.dataset.rxChanId || !t.dataset.txChanId) return;
      toggleSubscription(t);
      return;
    }
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
  if(isNaN(di) || !devices[di]) return;
  var dev = devices[di];
  var oldName = dev.name || "";
  if(newName === oldName) return;

  var nameEl = dev.el.querySelector("name");
  if(!nameEl){ nameEl = xmlDoc.createElement("name"); dev.el.insertBefore(nameEl, dev.el.firstChild); }
  nameEl.textContent = newName;

  // nur wenn TX-Gerät umbenannt wird, müssen Subscriptions angepasst werden
  if(kind === "tx"){
    for(var i=0;i<rows.length;i++){
      var r = rows[i];
      if(r.rx.subDev === oldName){
        var sd = r.rx.el.querySelector("subscribed_device");
        if(!sd){ sd = xmlDoc.createElement("subscribed_device"); r.rx.el.appendChild(sd); }
        sd.textContent = newName;
        r.rx.subDev = newName;
      }
    }
  }

  dev.name = newName;
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

  // Subscriptions, die auf (dev.name, oldLabel) zeigen, auf neues Label umbiegen
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

// --------- Subscription Toggle ----------
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
    sd2.textContent = tdev.name;
    sc2.textContent = tx.label;
    rx.subDev = tdev.name; rx.subChan = tx.label;
  }

  renderMatrix();
  persist();
}

// --------- Persistenz ----------
function persist(){
  try{
    var s = new XMLSerializer().serializeToString(xmlDoc);
    try { localStorage.setItem(LS_KEY, s); } catch(_) {}
    try { sessionStorage.setItem(LS_KEY, s); } catch(_) {}
  }catch(e){
    var h = $("#hint"); if(h) h.textContent = "Persist-Fehler: " + (e.message || String(e));
  }
}

// --------- UI Bindings ----------
function bindUI(){
  // Bearbeiten-Toggles
  var tSubs  = $("#toggleSubs");
  var tNames = $("#toggleNames");
  if(tSubs){
    tSubs.addEventListener("change", function(e){
      editSubsEnabled = !!e.target.checked;
      renderMatrix();
    });
  }
  if(tNames){
    tNames.addEventListener("change", function(e){
      editNamesEnabled = !!e.target.checked;
      renderMatrix();
    });
  }

  // Filter live anwenden
  ["fTx","fRx"].forEach(function(id){
    var el = $("#"+id);
    if(!el) return;
    el.addEventListener("input", function(){ renderMatrix(); });
  });

  // „Nur … mit Subs“: Beim Aktivieren aktuelle Sicht EINFRIEREN, beim Deaktivieren aufheben
  var chkRows = $("#onlyRowsWithSubs");
  var chkCols = $("#onlyColsWithSubs");

  if(chkRows){
    chkRows.addEventListener("change", function(e){
      if(e.target.checked){
        var base = computeVisibleBase();
        // aber: auf Zeilen beschränken, die aktuell tatsächlich ein Abo haben
        base.visRows = base.visRows.filter(function(r){
          if(r.isDevice) return true; // Platzhalter mit einfrieren
          return !!(r.rx.subDev);
        });
        freezeVisible(base);
      } else {
        frozenRows = null;
      }
      renderMatrix();
    });
  }

  if(chkCols){
    chkCols.addEventListener("change", function(e){
      if(e.target.checked){
        var base = computeVisibleBase();
        // auf Spalten beschränken, die in den (nicht kollabierten) Zeilen zumindest einmal vorkommen
        var used = new Set();
        base.visRows.forEach(function(r){
          if(r.isDevice) return;
          var sd = r.rx.subDev, sc = r.rx.subChan;
          if(!sd || !sc) return;
          // markiere alle TX-Spalten, die zu (sd,sc) passen
          base.visCols.forEach(function(c){
            if(c.isDevice) return;
            if(c.dev.name === sd && c.tx.label === sc){
              used.add(colKey(c.devIndex, c.tx.id));
            }
          });
        });
        base.visCols = base.visCols.filter(function(c){
          return c.isDevice || used.has(colKey(c.devIndex, c.tx.id));
        });
        freezeVisible(base);
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
      persist();
      location.href = "./Index.html";
    });
  }
}
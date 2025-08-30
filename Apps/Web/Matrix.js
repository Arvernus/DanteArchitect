// Apps/Web/Matrix.js

// --------- Konstanten / Storage-Key ----------
var LS_KEY = "DA_PRESET_XML"; // Startseite legt hier das geladene Preset ab

// --------- Working State ----------
var xmlDoc = null;
var devices = [];   // {name, el, tx:[{el,label,id}], rx:[{el,name,id,subDev,subChan}]}
var cols = [];      // flache Liste aller TX-Spalten (mit Geräte-Ref)
var rows = [];      // flache Liste aller RX-Reihen (mit Geräte-Ref)

var editEnabled = false;   // Freigabe AN/AUS
var editMode = "subs";     // "subs" | "names"

// --------- Helpers ----------
function $(s){ return document.querySelector(s); }
function cel(tag, cls, txt){ var e=document.createElement(tag); if(cls) e.className=cls; if(txt!=null) e.textContent=txt; return e; }
function norm(s){ return (s||"").toLowerCase(); }

// --------- Init ----------
(function init(){
  try{
    var xml = null;

    // 1) zuerst localStorage probieren
    try { xml = localStorage.getItem(LS_KEY); } catch (_) { xml = null; }

    // 2) wenn leer: window.name verwenden (vom Index gesetzt)
    if (!xml || !xml.trim()) {
      try {
        if (window.name) {
          var payload = null;
          try { payload = JSON.parse(window.name); } catch (_) {}
          if (payload && payload.type === "DA_PRESET" && payload.xml) {
            xml = String(payload.xml);
            // zurück in localStorage legen (falls wieder verfügbar)
            try { localStorage.setItem(LS_KEY, xml); } catch (_) {}
          }
        }
      } catch (_) {}
    }

    if (!xml) {
      var hint = $("#hint");
      if(hint) hint.innerHTML = "⚠️ <span class='warn'>Kein Preset gefunden.</span> Bitte zur Übersicht zurück und Preset laden.";
      return;
    }

    var p = new DOMParser();
    xmlDoc = p.parseFromString(xml, "application/xml");
    var err = xmlDoc.querySelector("parsererror");
    if(err){
      var hi = $("#hint"); if(hi) hi.textContent = "XML Fehler: " + err.textContent;
      return;
    }

    var pname = xmlDoc.querySelector("preset > name");
    if(pname && $("#presetNameChip")) $("#presetNameChip").textContent = "Preset: " + pname.textContent;

    buildModel();
    renderMatrix();
    bindUI();
  }catch(e){
    var h = $("#hint"); if(h) h.textContent = "Init-Fehler: " + (e.message || String(e));
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

  // --- kompakte Filter ---
  var fTxEl = $("#fTx"), fRxEl = $("#fRx");
  var fTx = norm(fTxEl ? fTxEl.value : "");
  var fRx = norm(fRxEl ? fRxEl.value : "");
  var onlyRows = $("#onlyRowsWithSubs") && $("#onlyRowsWithSubs").checked;
  var onlyCols = $("#onlyColsWithSubs") && $("#onlyColsWithSubs").checked;

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

  // sichtbare Spalten (TX) und Zeilen (RX)
  var visCols = [];
  devices.forEach(function(d){
    if(!deviceMatchesTx(d)) return;
    d.tx.forEach(function(tx){ visCols.push({ dev:d, tx:tx }); });
  });

  var visRows = [];
  devices.forEach(function(d){
    if(!deviceMatchesRx(d)) return;
    d.rx.forEach(function(rx){
      if(onlyRows && !rx.subDev) return;
      visRows.push({ dev:d, rx:rx });
    });
  });

  if(onlyCols){
    visCols = visCols.filter(function(c){
      for(var i=0;i<visRows.length;i++){
        var r = visRows[i];
        if(r.rx.subDev === c.dev.name && r.rx.subChan === c.tx.label) return true;
      }
      return false;
    });
  }

  // --- Header: Gruppe TX-Geräte ---
  var tr0 = cel("tr");
  var thRXDev = cel("th","top-left-0","RX Gerät"); thRXDev.style.minWidth="220px";
  var thRXChan= cel("th","top-left-1","RX Kanal");  thRXChan.style.minWidth="180px";
  tr0.appendChild(thRXDev); tr0.appendChild(thRXChan);

  // group runs
  var groupRuns = [];
  var lastName = null, run = null;
  for(var cidx=0;cidx<visCols.length;cidx++){
    var c = visCols[cidx];
    if(!run || run.name !== c.dev.name){
      run = { name: c.dev.name, dev: c.dev, cols: [], count: 0 };
      groupRuns.push(run);
    }
    run.cols.push(c);
    run.count++;
  }
  for(var g=0; g<groupRuns.length; g++){
    var grp = groupRuns[g];
    var th = cel("th","group");
    th.colSpan = grp.count;

    var span = cel("span","editable", grp.name || "(ohne Name)");
    span.dataset.role = "dev-name-tx";
    span.dataset.devIndex = String(devices.indexOf(grp.dev));
    if(editEnabled && editMode==="names"){ span.contentEditable = "true"; }

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
    var spc = cel("span","editable", cc.tx.label || "");
    spc.dataset.role = "tx-chan";
    spc.dataset.devIndex = String(devices.indexOf(cc.dev));
    spc.dataset.chanId   = String(cc.tx.id);
    if(editEnabled && editMode==="names"){ spc.contentEditable = "true"; }
    thc.appendChild(spc);
    tr1.appendChild(thc);
  }

  thead.appendChild(tr0);
  thead.appendChild(tr1);

  // --- Body: RX Zeilen ---
  for(var r=0; r<visRows.length; r++){
    var row = visRows[r];
    var tr = cel("tr");

    // RX-Gerätename
    var thD = cel("th","rowhead");
    var dspan = cel("span","editable", row.dev.name || "(ohne Name)");
    dspan.dataset.role = "dev-name-rx";
    dspan.dataset.devIndex = String(devices.indexOf(row.dev));
    if(editEnabled && editMode==="names"){ dspan.contentEditable = "true"; }
    thD.appendChild(dspan);
    tr.appendChild(thD);

    // RX-Kanalname
    var thC = cel("th","rowchan");
    var cspan = cel("span","editable", row.rx.name || "");
    cspan.dataset.role = "rx-chan";
    cspan.dataset.devIndex = String(devices.indexOf(row.dev));
    cspan.dataset.chanId   = String(row.rx.id);
    if(editEnabled && editMode==="names"){ cspan.contentEditable = "true"; }
    thC.appendChild(cspan);
    tr.appendChild(thC);

    // Zellen
    for(var x=0; x<visCols.length; x++){
      var col = visCols[x];
      var cellEditable = (editEnabled && editMode==="subs");
      var td = cel("td", "cell" + (cellEditable ? " editable" : ""), "");
      var isSub = (row.rx.subDev === col.dev.name && row.rx.subChan === col.tx.label);
      if(isSub){
        var dot = cel("span","dot","");
        td.appendChild(dot);
      }
      td.dataset.role = "cell";
      td.dataset.rxDevIndex = String(devices.indexOf(row.dev));
      td.dataset.rxChanId   = String(row.rx.id);
      td.dataset.txDevIndex = String(devices.indexOf(col.dev));
      td.dataset.txChanId   = String(col.tx.id);
      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  }

  // --- Interaktion (delegiert) ---
  thead.onclick = tbody.onclick = function(ev){
    var t = ev.target;
    if(!t || !t.dataset) return;
    if(!editEnabled) return;

    if(editMode === "names"){
      if(t.dataset.role === "dev-name-tx"){ makeEditable(t, function(newVal){ renameDevice(t, "tx", newVal); }); }
      else if(t.dataset.role === "tx-chan"){ makeEditable(t, function(newVal){ renameTxChannel(t, newVal); }); }
      else if(t.dataset.role === "dev-name-rx"){ makeEditable(t, function(newVal){ renameDevice(t, "rx", newVal); }); }
      else if(t.dataset.role === "rx-chan"){ makeEditable(t, function(newVal){ renameRxChannel(t, newVal); }); }
    } else if(editMode === "subs"){
      if(t.dataset.role === "cell"){ toggleSubscription(t); }
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
    localStorage.setItem(LS_KEY, s);
  }catch(e){
    // still ignore, but show hint
    var h = $("#hint"); if(h) h.textContent = "Persist-Fehler: " + (e.message || String(e));
  }
}

// --------- UI Bindings ----------
function bindUI(){
  var toggleEdit = $("#toggleEdit");
  if(toggleEdit){
    toggleEdit.addEventListener("change", function(e){
      editEnabled = !!e.target.checked;
      renderMatrix();
    });
  }
  var modeSelect = $("#modeSelect");
  if(modeSelect){
    modeSelect.addEventListener("change", function(e){
      editMode = (e.target.value === "names") ? "names" : "subs";
      renderMatrix();
    });
  }

  // kompakte Filter
  ["fTx","fRx","onlyRowsWithSubs","onlyColsWithSubs"].forEach(function(id){
    var el = document.getElementById(id);
    if(!el) return;
    var handler = function(){ renderMatrix(); };
    if(el.type === "text"){ el.addEventListener("input", handler); }
    else { el.addEventListener("change", handler); }
  });

  // Speichern & Zurück
  var back = $("#btnSaveBack");
  if(back){
    back.addEventListener("click", function(){
      persist();
      location.href = "./Index.html";
    });
  }
}
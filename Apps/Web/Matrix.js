// Apps/Web/Matrix.js

// --------- Konstanten ----------
var SKEY_XML  = "DA_PRESET_XML";
var SKEY_META = "DA_PRESET_META";

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

// --------- Helpers ----------
function $(s){ return document.querySelector(s); }
function cel(tag, cls, txt){ var e=document.createElement(tag); if(cls) e.className=cls; if(txt!=null) e.textContent=txt; return e; }
function norm(s){ return (s||"").toLowerCase(); }
function colKey(devIndex, chanId){ return chanId ? ("tx:"+devIndex+":"+chanId) : ("txdev:"+devIndex); }
function rowKey(devIndex, chanId){ return chanId ? ("rx:"+devIndex+":"+chanId) : ("rxdev:"+devIndex); }
function isFrozenColsMode(){ return !!frozenCols; }
function isFrozenRowsMode(){ return !!frozenRows; }

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

// --------- Init ----------
(function init(){
  try{
    var xml = readFromSession();
    if(!xml || !xml.trim()){
      xml = readFromWindowName();
      if(xml){
        // Sync zurück in Session (einheitlicher Pfad)
        writeToSessionAndName(xml);
      }
    }

    if (!xml || !xml.trim()){
      var hint = $("#hint");
      if(hint) hint.innerHTML = "⚠️ <span class='warn'>Kein Preset gefunden.</span> Bitte zur Übersicht zurück und Preset laden.";
      return;
    }

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
    d.tx.forEach(function(tx){ cols.push({ dev:d, tx:tx }); });
  });
  devices.forEach(function(d){
    d.rx.forEach(function(rx){ rows.push({ dev:d, rx:rx }); });
  });
}

// --------- Sichtbarkeitsbasis ----------
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

function freezeVisible(current){
  var onlyCols = $("#onlyColsWithSubs");
  if(onlyCols && onlyCols.checked){
    var set = new Set();
    current.visCols.forEach(function(c){
      set.add(colKey(c.devIndex, c.isDevice ? null : (c.tx && c.tx.id)));
    });
    frozenCols = set;
  } else { frozenCols = null; }

  var onlyRows = $("#onlyRowsWithSubs");
  if(onlyRows && onlyRows.checked){
    var setR = new Set();
    current.visRows.forEach(function(r){
      setR.add(rowKey(r.devIndex, r.isDevice ? null : (r.rx && r.rx.id)));
    });
    frozenRows = setR;
  } else { frozenRows = null; }
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

  var tr0 = cel("tr");
  var thRXDev = cel("th","top-left-0","RX Gerät"); thRXDev.style.minWidth="220px";
  var thRXChan= cel("th","top-left-1","RX Kanal");  thRXChan.style.minWidth="180px";
  tr0.appendChild(thRXDev); tr0.appendChild(thRXChan);

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

  for(var g=0; g<groupRuns.length; g++){
    var grp = groupRuns[g];
    var th = cel("th","group"); th.colSpan = grp.count; th.style.background = "#f0f0f0";
    var toggle = cel("button","btn", collapsedTx[grp.devIndex] ? "+" : "–");
    toggle.dataset.role = "toggle-tx"; toggle.dataset.devIndex = String(grp.devIndex); toggle.style.marginRight = "6px";
    var span = cel("span","editable", grp.name || "(ohne Name)");
    span.dataset.role = "dev-name-tx"; span.dataset.devIndex = String(grp.devIndex);
    if(editNamesEnabled){ span.contentEditable = "true"; }
    th.appendChild(toggle); th.appendChild(span); tr0.appendChild(th);
  }

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

  for(var r=0; r<visRows.length; r++){
    var row = visRows[r];
    var tr = cel("tr");

    var thD = cel("th","rowhead"); thD.style.background = "#f0f0f0";
    var toggleRx = cel("button","btn", collapsedRx[row.devIndex] ? "+" : "–");
    toggleRx.dataset.role = "toggle-rx"; toggleRx.dataset.devIndex = String(row.devIndex); toggleRx.style.marginRight = "6px";
    var dspan = cel("span","editable", row.dev.name || "(ohne Name)");
    dspan.dataset.role = "dev-name-rx"; dspan.dataset.devIndex = String(row.devIndex);
    if(editNamesEnabled){ dspan.contentEditable = "true"; }
    thD.appendChild(toggleRx); thD.appendChild(dspan); tr.appendChild(thD);

    var thC = cel("th","rowchan");
    if (row.isDevice) { thC.style.background = "#f7f7f7"; thC.textContent = ""; }
    else {
      var cspan = cel("span","editable", row.rx.name || "");
      cspan.dataset.role = "rx-chan"; cspan.dataset.devIndex = String(row.devIndex); cspan.dataset.chanId   = String(row.rx.id);
      if(editNamesEnabled){ cspan.contentEditable = "true"; }
      thC.appendChild(cspan);
    }
    tr.appendChild(thC);

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

    $("#tbody").appendChild(tr);
  }

  // Delegierte Interaktion
  var theadEl = $("#thead"), tbodyEl = $("#tbody");
  theadEl.onclick = tbodyEl.onclick = function(ev){
    var t = ev.target; if(!t || !t.dataset) return;

    if(t.dataset.role === "toggle-tx"){ var di = parseInt(t.dataset.devIndex,10); collapsedTx[di] = !collapsedTx[di]; renderMatrix(); return; }
    if(t.dataset.role === "toggle-rx"){ var di2= parseInt(t.dataset.devIndex,10); collapsedRx[di2] = !collapsedRx[di2]; renderMatrix(); return; }

    if(editNamesEnabled){
      if(t.dataset.role === "dev-name-tx"){ makeEditable(t, function(v){ renameDevice(t,"tx",v); }); return; }
      if(t.dataset.role === "tx-chan"){ makeEditable(t, function(v){ renameTxChannel(t,v); }); return; }
      if(t.dataset.role === "dev-name-rx"){ makeEditable(t, function(v){ renameDevice(t,"rx",v); }); return; }
      if(t.dataset.role === "rx-chan"){ makeEditable(t, function(v){ renameRxChannel(t,v); }); return; }
    }

    if(editSubsEnabled && t.dataset.role === "cell"){
      if(!t.dataset.rxChanId || !t.dataset.txChanId) return;
      toggleSubscription(t); return;
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
  if (isNaN(di) || !devices[di]) return;

  var dev = devices[di];
  var oldName = (dev.name || "").trim();
  newName = (newName || "").trim();

  if (!newName || newName === oldName) return;

  // 1) Device-Name im eigenen <device> aktualisieren
  var nameEl = dev.el.querySelector("name");
  if (!nameEl) {
    nameEl = xmlDoc.createElement("name");
    dev.el.insertBefore(nameEl, dev.el.firstChild);
  }
  nameEl.textContent = newName;
  dev.name = newName;

  // 2) ALLE Subscriptions im gesamten Preset anpassen:
  //    überall dort, wo subscribed_device == alter Name, auf neuen Namen umbiegen
  for (var r = 0; r < rows.length; r++) {
    var rxrow = rows[r];
    if ((rxrow.rx.subDev || "").trim() === oldName) {
      // XML-Element holen/erzeugen
      var sd = rxrow.rx.el.querySelector("subscribed_device");
      if (!sd) {
        sd = xmlDoc.createElement("subscribed_device");
        rxrow.rx.el.appendChild(sd);
      }
      sd.textContent = newName;

      // Cache aktualisieren
      rxrow.rx.subDev = newName;
    }
  }

  // Hinweis:
  // - Es spielt keine Rolle, ob der Name in TX- oder RX-Header geändert wurde.
  //   Wir sehen das Gerät "dev" als eine Entität und aktualisieren deshalb immer
  //   alle Subscriptions, die auf den alten Namen zeigen.

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
    sd2.textContent = tdev.name; sc2.textContent = tx.label;
    rx.subDev = tdev.name; rx.subChan = tx.label;
  }

  renderMatrix();
  persist();
}

// --------- Persistenz (nur Session + window.name) ----------
function persist(){
  try{
    var s = new XMLSerializer().serializeToString(xmlDoc);
    try { sessionStorage.setItem(SKEY_XML, s); } catch(_) {}
    try { window.name = JSON.stringify({ type:"DA_PRESET", xml: s, ts: Date.now() }); } catch(_) {}
    // Optional: wenn du dauerhaft sichern willst, zusätzlich localStorage:
    // try { localStorage.setItem(SKEY_XML, s); } catch(_) {}
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

  if(chkRows){
    chkRows.addEventListener("change", function(e){
      if(e.target.checked){
        var base = computeVisibleBase();
        base.visRows = base.visRows.filter(function(r){ if(r.isDevice) return true; return !!(r.rx.subDev); });
        freezeVisible(base);
      } else { frozenRows = null; }
      renderMatrix();
    });
  }

  if(chkCols){
    chkCols.addEventListener("change", function(e){
      if(e.target.checked){
        var base = computeVisibleBase();
        var used = new Set();
        base.visRows.forEach(function(r){
          if(r.isDevice) return;
          var sd = r.rx.subDev, sc = r.rx.subChan;
          if(!sd || !sc) return;
          base.visCols.forEach(function(c){
            if(c.isDevice) return;
            if(c.dev.name === sd && c.tx.label === sc){
              used.add(colKey(c.devIndex, c.tx.id));
            }
          });
        });
        base.visCols = base.visCols.filter(function(c){ return c.isDevice || used.has(colKey(c.devIndex, c.tx.id)); });
        freezeVisible(base);
      } else { frozenCols = null; }
      renderMatrix();
    });
  }

  var back = $("#btnSaveBack");
  if(back){
    back.addEventListener("click", function(){
      persist();
      location.href = "./Index.html#via=matrix";
    });
  }
}
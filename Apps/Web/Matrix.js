// Key für LocalStorage
var LS_KEY = "DA_PRESET_XML";

// Working state
var xmlDoc = null;
var devices = [];   // {name, el, tx:[{el,label,id}], rx:[{el,name,id,subDev,subChan}]}
var cols = [];      // flache Liste aller TX-Spalten in Render-Reihenfolge
var rows = [];      // flache Liste aller RX-Reihen in Render-Reihenfolge
var editEnabled = false;

function $(s){ return document.querySelector(s); }
function cel(tag, cls, txt){ var e=document.createElement(tag); if(cls) e.className=cls; if(txt!=null) e.textContent=txt; return e; }
function norm(s){ return (s||"").toLowerCase(); }

// ---------- Load ----------
(function init(){
  var xml = localStorage.getItem(LS_KEY);
  if(!xml){
    $("#hint").innerHTML = "⚠️ <span class='warn'>Kein Preset im Speicher.</span> Geh zurück zur Übersicht und lade ein Preset.";
    return;
  }
  var p = new DOMParser();
  xmlDoc = p.parseFromString(xml, "application/xml");
  var err = xmlDoc.querySelector("parsererror");
  if(err){ $("#hint").textContent="XML Fehler: " + err.textContent; return; }

  // Name für Chip
  var pname = xmlDoc.querySelector("preset > name");
  if(pname) $("#presetNameChip").textContent = "Preset: " + pname.textContent;

  buildModel();
  renderMatrix();
  bindUI();
})();

function buildModel(){
  devices = [];
  cols = [];
  rows = [];

  var devEls = Array.prototype.slice.call(xmlDoc.querySelectorAll("preset > device"));
  if(devEls.length === 0) devEls = Array.prototype.slice.call(xmlDoc.querySelectorAll("device"));

  // Collect devices with tx/rx
  devEls.forEach(function(de){
    var name = (de.querySelector("name") && de.querySelector("name").textContent) ? de.querySelector("name").textContent.trim() : "";
    var txEls = Array.prototype.slice.call(de.querySelectorAll("txchannel"));
    var rxEls = Array.prototype.slice.call(de.querySelectorAll("rxchannel"));

    var tx = txEls.map(function(txel){
      var labEl = txel.querySelector("label");
      var label = labEl && labEl.textContent ? labEl.textContent.trim() : "";
      var id = txel.getAttribute("danteId") || "";
      return { el: txel, label: label, id: id };
    });

    var rx = rxEls.map(function(rxel){
      var nEl = rxel.querySelector("name");
      var name = nEl && nEl.textContent ? nEl.textContent.trim() : "";
      var id = rxel.getAttribute("danteId") || "";
      var sd = rxel.querySelector("subscribed_device");
      var sc = rxel.querySelector("subscribed_channel");
      return {
        el: rxel, name: name, id: id,
        subDev: sd && sd.textContent ? sd.textContent.trim() : "",
        subChan: sc && sc.textContent ? sc.textContent.trim() : ""
      };
    });

    devices.push({ name: name, el: de, tx: tx, rx: rx });
  });

  // columns = all tx channels, with device boundary
  devices.forEach(function(d){
    d.tx.forEach(function(tx){
      cols.push({ dev:d, tx:tx }); // keep refs
    });
  });

  // rows = all rx channels
  devices.forEach(function(d){
    d.rx.forEach(function(rx){
      rows.push({ dev:d, rx:rx });
    });
  });
}

// ---------- Render ----------
function renderMatrix(){
  var thead = $("#thead"); var tbody = $("#tbody");
  thead.innerHTML=""; tbody.innerHTML="";

  // Filters
  var ftDev = norm($("#fTxDev").value);
  var ftChan = norm($("#fTxChan").value);
  var frDev = norm($("#fRxDev").value);
  var frChan = norm($("#fRxChan").value);
  var onlyRows = $("#onlyRowsWithSubs").checked;
  var onlyCols = $("#onlyColsWithSubs").checked;

  // Determine visible columns
  var visCols = cols.filter(function(c){
    var okDev = !ftDev || norm(c.dev.name).indexOf(ftDev) >= 0;
    var okChan = !ftChan || norm(c.tx.label).indexOf(ftChan) >= 0;
    return okDev && okChan;
  });

  // Determine visible rows
  var visRows = rows.filter(function(r){
    var okDev = !frDev || norm(r.dev.name).indexOf(frDev) >= 0;
    var okChan = !frChan || norm(r.rx.name).indexOf(frChan) >= 0;
    if(!okDev || !okChan) return false;
    if(onlyRows) return !!r.rx.subDev; // row has subscription
    return true;
  });

  // if onlyCols, detect which columns actually have any sub
  if(onlyCols){
    visCols = visCols.filter(function(c){
      for(var i=0;i<visRows.length;i++){
        var r = visRows[i];
        if(r.rx.subDev === c.dev.name && r.rx.subChan === c.tx.label) return true;
      }
      return false;
    });
  }

  // Header row 0: two sticky cells at left (RX device / RX channel), then TX device groups
  var tr0 = cel("tr");
  var tl0 = cel("th","top-left-0"); tl0.style.minWidth="220px"; tl0.textContent="RX Gerät";
  var tl1 = cel("th","top-left-1"); tl1.style.minWidth="180px"; tl1.textContent="RX Kanal";
  tr0.appendChild(tl0); tr0.appendChild(tl1);

  // group by device for TX header
  var groupRuns = [];
  var lastName = null, run = null;
  visCols.forEach(function(c){
    if(!run || run.name !== c.dev.name){
      run = { name: c.dev.name, dev:c.dev, count:0, cols:[] };
      groupRuns.push(run);
    }
    run.count++; run.cols.push(c);
  });

  groupRuns.forEach(function(g){
    var th = cel("th","group");
    th.colSpan = g.count;
    // editable device name (TX)
    var span = cel("span","editable", g.name || "(ohne Name)");
    span.dataset.role = "dev-name-tx";
    span.dataset.devIndex = devices.indexOf(g.dev);
    if(editEnabled){ span.contentEditable="true"; }
    th.appendChild(span);
    tr0.appendChild(th);
  });

  // Header row 1: TX channel labels
  var tr1 = cel("tr");
  var h1a = cel("th","rowhead"); h1a.textContent=""; tr1.appendChild(h1a);
  var h1b = cel("th","rowchan"); h1b.textContent=""; tr1.appendChild(h1b);
  visCols.forEach(function(c){
    var th = cel("th","tx-chan");
    var span = cel("span","editable", c.tx.label || "");
    span.dataset.role = "tx-chan";
    span.dataset.devIndex = devices.indexOf(c.dev);
    span.dataset.chanId = c.tx.id;
    if(editEnabled){ span.contentEditable="true"; }
    th.appendChild(span);
    tr1.appendChild(th);
  });

  thead.appendChild(tr0);
  thead.appendChild(tr1);

  // Body rows
  visRows.forEach(function(r, idx){
    var tr = cel("tr");
    // RX device name (editable)
    var tdDev = cel("th","rowhead");
    var dspan = cel("span","editable", r.dev.name || "(ohne Name)");
    dspan.dataset.role = "dev-name-rx";
    dspan.dataset.devIndex = devices.indexOf(r.dev);
    if(editEnabled){ dspan.contentEditable="true"; }
    tdDev.appendChild(dspan);
    tr.appendChild(tdDev);

    // RX channel name (editable)
    var tdChan = cel("th","rowchan");
    var cspan = cel("span","editable", r.rx.name || "");
    cspan.dataset.role = "rx-chan";
    cspan.dataset.devIndex = devices.indexOf(r.dev);
    cspan.dataset.chanId = r.rx.id;
    if(editEnabled){ cspan.contentEditable="true"; }
    tdChan.appendChild(cspan);
    tr.appendChild(tdChan);

    // Cells
    visCols.forEach(function(c){
      var td = cel("td","cell" + (editEnabled ? " editable":""));
      var isSub = r.rx.subDev === c.dev.name && r.rx.subChan === c.tx.label;
      if(isSub){ var dot = cel("span","dot"); td.appendChild(dot); }
      td.dataset.role = "cell";
      td.dataset.rxDevIndex = devices.indexOf(r.dev);
      td.dataset.rxChanId = r.rx.id;
      td.dataset.txDevIndex = devices.indexOf(c.dev);
      td.dataset.txChanId = c.tx.id;
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });

  // Bind contenteditable listeners (delegated)
  thead.onclick = tbody.onclick = function(ev){
    var t = ev.target;
    if(!t || !t.dataset) return;

    // edits allowed only when editEnabled
    if(t.dataset.role === "dev-name-tx" && editEnabled){
      makeEditable(t, function(newVal){
        renameDevice(t, "tx", newVal);
      });
    }
    else if(t.dataset.role === "tx-chan" && editEnabled){
      makeEditable(t, function(newVal){
        renameTxChannel(t, newVal);
      });
    }
    else if(t.dataset.role === "dev-name-rx" && editEnabled){
      makeEditable(t, function(newVal){
        renameDevice(t, "rx", newVal);
      });
    }
    else if(t.dataset.role === "rx-chan" && editEnabled){
      makeEditable(t, function(newVal){
        renameRxChannel(t, newVal);
      });
    }
    else if(t.dataset.role === "cell" && editEnabled){
      toggleSubscription(t);
    }
  };
}

function makeEditable(span, apply){
  // already contentEditable true; apply on Enter/blur
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
  document.execCommand && document.execCommand("selectAll", false, null);
}

function renameDevice(span, kind, newName){
  var di = parseInt(span.dataset.devIndex,10);
  if(isNaN(di) || !devices[di]) return;
  var dev = devices[di];
  var oldName = dev.name || "";

  if(newName === oldName) return;
  // update XML
  var nameEl = dev.el.querySelector("name");
  if(!nameEl){ nameEl = xmlDoc.createElement("name"); dev.el.insertBefore(nameEl, dev.el.firstChild); }
  nameEl.textContent = newName;

  // if TX device renamed -> update ALL rx.subscribed_device that point to oldName
  // if RX device renamed -> no need to touch subscriptions (they point to TX side)
  if(kind === "tx"){
    rows.forEach(function(r){
      if(r.rx.subDev === oldName){
        var sd = r.rx.el.querySelector("subscribed_device");
        if(sd) sd.textContent = newName;
        r.rx.subDev = newName;
      }
    });
  }

  // update local model
  dev.name = newName;
  renderMatrix();
  persist();
}

function renameTxChannel(span, newLabel){
  var di = parseInt(span.dataset.devIndex,10);
  var cid = span.dataset.chanId || "";
  var dev = devices[di]; if(!dev) return;

  // find the tx channel element
  var tx = (dev.tx || []).find(function(x){ return String(x.id)===String(cid); });
  if(!tx) return;

  var labEl = tx.el.querySelector("label");
  if(!labEl){ labEl = xmlDoc.createElement("label"); tx.el.appendChild(labEl); }
  var oldLabel = tx.label || "";
  tx.label = newLabel;
  labEl.textContent = newLabel;

  // update subscriptions that target this TX channel (by device+label)
  rows.forEach(function(r){
    if(r.rx.subDev === dev.name && r.rx.subChan === oldLabel){
      var sc = r.rx.el.querySelector("subscribed_channel");
      if(sc) sc.textContent = newLabel;
      r.rx.subChan = newLabel;
    }
  });

  renderMatrix();
  persist();
}

function renameRxChannel(span, newName){
  var di = parseInt(span.dataset.devIndex,10);
  var cid = span.dataset.chanId || "";
  var dev = devices[di]; if(!dev) return;

  var rx = (dev.rx || []).find(function(x){ return String(x.id)===String(cid); });
  if(!rx) return;

  var nEl = rx.el.querySelector("name");
  if(!nEl){ nEl = xmlDoc.createElement("name"); rx.el.insertBefore(nEl, rx.el.firstChild); }
  rx.name = newName;
  nEl.textContent = newName;

  renderMatrix();
  persist();
}

function toggleSubscription(td){
  var rdi = parseInt(td.dataset.rxDevIndex,10);
  var rid = td.dataset.rxChanId || "";
  var tdi = parseInt(td.dataset.txDevIndex,10);
  var tid = td.dataset.txChanId || "";
  var rdev = devices[rdi], tdev = devices[tdi];
  if(!rdev || !tdev) return;

  var rx = (rdev.rx||[]).find(function(x){ return String(x.id)===String(rid); });
  var tx = (tdev.tx||[]).find(function(x){ return String(x.id)===String(tid); });
  if(!rx || !tx) return;

  // Toggle: if already subscribed to this TX → clear; otherwise set to this TX
  var already = rx.subDev === tdev.name && rx.subChan === tx.label;
  if(already){
    var sd = rx.el.querySelector("subscribed_device");
    var sc = rx.el.querySelector("subscribed_channel");
    if(sd) sd.textContent = "";
    if(sc) sc.textContent = "";
    rx.subDev = ""; rx.subChan = "";
  } else {
    var sd = rx.el.querySelector("subscribed_device");
    var sc = rx.el.querySelector("subscribed_channel");
    if(!sd){ sd = xmlDoc.createElement("subscribed_device"); rx.el.appendChild(sd); }
    if(!sc){ sc = xmlDoc.createElement("subscribed_channel"); rx.el.appendChild(sc); }
    sd.textContent = tdev.name;
    sc.textContent = tx.label;
    rx.subDev = tdev.name; rx.subChan = tx.label;
  }

  renderMatrix();
  persist();
}

function persist(){
  // schreibe XML zurück in localStorage
  var s = new XMLSerializer().serializeToString(xmlDoc);
  localStorage.setItem(LS_KEY, s);
}

// ---------- UI Bindings ----------
function bindUI(){
  // Edit Toggle
  $("#toggleEdit").addEventListener("change", function(e){
    editEnabled = !!e.target.checked;
    renderMatrix();
  });

  // Filters
  ["fTxDev","fTxChan","fRxDev","fRxChan","onlyRowsWithSubs","onlyColsWithSubs"].forEach(function(id){
    var el = $("#"+id);
    if(!el) return;
    var handler = function(){ renderMatrix(); };
    if(el.tagName==="INPUT" && el.type==="text"){
      el.addEventListener("input", handler);
    } else {
      el.addEventListener("change", handler);
    }
  });

  // Save & back
  $("#btnSaveBack").addEventListener("click", function(){
    persist();
    location.href = "./Index.html";
  });
}
// Apps/Web/SettingsMatrix.js
(function(){
  var SKEY_XML = "DA_PRESET_XML";
  var UI = { ipExpanded: {0:false, 1:false}, editingCols: Object.create(null), defaultEditing: Object.create(null) };

  if (typeof writeToSessionAndName !== "function"){
  window.writeToSessionAndName = function(xml){
    try { sessionStorage.setItem(SKEY_XML, xml); } catch(_){}
    try { window.name = JSON.stringify({ type:"DA_PRESET", xml: xml, ts: Date.now() }); } catch(_){}
  };
}

  // Spalten-Definition (erweiterbar)
// Spalten-Definition + Interface-Helper
// Ergänzte Spalten + Helper
// COLS ohne showIf – alle Felder immer sichtbar
var COLS = [
  { id:"samplerate", label:"Sample Rate", type:"select", options:[44100,48000,88200,96000] },
  { id:"unicast_latency_ms", label:"Unicast Latency (ms)", type:"select", options:[0.25,0.5,1,2,4,5,6,10] },
  { id:"preferred_master", label:"Preferred Master", type:"select", options:["false","true"] },
  { id:"external_word_clock", label:"External Word Clock", type:"select", options:["false","true"] },
  { id:"redundancy", label:"Redundancy Enabled", type:"select", options:["false","true"] },
  { id:"encoding_bits", label:"Encoding (bit)", type:"select", options:[16,24,32] },
  { id:"switch_vlan", label:"Switch VLAN", type:"number", min:1, max:4094, step:1 },
  { id:"ip0_mode",   label:"IP Mode (P)", type:"select", options:["dynamic","static"] },
  { id:"ip0_addr",   label:"IP Address (P)", type:"text" },
  { id:"ip0_mask",   label:"Netmask (P)",   type:"text" },
  { id:"ip0_gw",     label:"Gateway (P)",   type:"text" },
  { id:"ip0_dns",    label:"DNS (P)",       type:"text" },
  { id:"ip1_mode",   label:"IP Mode (S)",   type:"select", options:["dynamic","static"] },
  { id:"ip1_addr",   label:"IP Address (S)", type:"text" },
  { id:"ip1_mask",   label:"Netmask (S)",    type:"text" },
  { id:"ip1_gw",     label:"Gateway (S)",    type:"text" },
  { id:"ip1_dns",    label:"DNS (S)",        type:"text" }
];

// Sichtbarkeitsprüfung pro Spalte: alle Spalten sind sichtbar
function columnVisibleForDevice(col, devObj){
  return true;
}


  var devices = [];      // [{name}]
  var state   = {};      // { colId: { default: any, touched: { [name]: true } } }

  function $(s){ return document.querySelector(s); }

  function readFromSession(){
    try { return sessionStorage.getItem(SKEY_XML) || ""; } catch(_) { return ""; }
  }
  function parseXml(text){
    var p = new DOMParser();
    var doc = p.parseFromString(text, "application/xml");
    var err = doc.querySelector("parsererror");
    if (err) throw new Error(err.textContent || "XML Parser Error");
    return doc;
  }
function loadDevicesFromPreset(xmlText){
  var list = [];
  var doc = null;
  try { doc = parseXml(xmlText); } catch(_){ return list; }
  var devEls = Array.prototype.slice.call(doc.querySelectorAll("preset > device"));
  if (devEls.length === 0) devEls = Array.prototype.slice.call(doc.querySelectorAll("device"));
  devEls.forEach(function(de){
    var nEl = de.querySelector("name");
    var name = nEl && nEl.textContent ? nEl.textContent.trim() : "";
    if (name) list.push({ name:name, el:de });
  });
  return list;
}


  function defaultValue(col){
    // Vorgabe: Felder, die im Preset fehlen, bleiben NULL (leer)
    return null;
  }
function ensureState(){
  COLS.forEach(function(c){
    if (!state[c.id]) state[c.id] = { default: null, touched: Object.create(null) };
  });
}
  // PATCH (Insert) at: SettingsMatrix.js
  // Anchor: directly AFTER the existing ensureState() function

  // --- Schutz-Mechanik: initial sind alle Zellen geschützt, bis sie 1x editiert wurden ---
  function ensureProtection(col){
    if (!col.protected){
      col.protected = Object.create(null); // { [deviceName]: true }
      if (Array.isArray(devices)){
        devices.forEach(d => { col.protected[d.name] = true; });
      }
    }
  }
  function isProtected(colId, devName){
    var col = state[colId]; if (!col) return false;
    ensureProtection(col);
    return !!col.protected[devName];
  }
  function clearProtection(colId, devName){
    var col = state[colId]; if (!col) return;
    ensureProtection(col);
    delete col.protected[devName]; // ab jetzt nicht mehr durch Standard-Zeile überschreiben
  }


  function valueFor(colId, devName){
    var c = state[colId]; if (!c) return null;
    return c.default;
  }

  function resolved(colId, devName){
    return valueFor(colId, devName);
  }
  // Berührungs-Helper
  function columnTouched(colId, devName){
    var c = state[colId]; if (!c) return false;
    return !!(c.touched && c.touched[devName]);
}

function anyTouched(colIds, devName){
    for (var i=0;i<colIds.length;i++){
      if (columnTouched(colIds[i], devName)) return true;
    }
    return false;
  }


    // -------- XML-Helfer --------
  // <tagName> unter parent sicherstellen, optional Attribute setzen
  function ensureEl(parent, tagName, attrs){
    var el = parent.querySelector(tagName);
    if (!el){
      el = parent.ownerDocument.createElement(tagName);
      parent.appendChild(el);
    }
    if (attrs && typeof attrs === "object"){
      Object.keys(attrs).forEach(function(k){
        if (attrs[k] != null) el.setAttribute(k, String(attrs[k]));
      });
    }
    return el;
  }

  // Fallback, falls ensureInterface nicht global definiert ist
  if (typeof ensureInterface !== "function"){
    function ensureInterface(parent, idx){
      var sel = 'interface[network="'+idx+'"]';
      var el  = parent.querySelector(sel);
      if (!el){
        el = parent.ownerDocument.createElement("interface");
        el.setAttribute("network", String(idx));
        parent.appendChild(el);
      }
      return el;
    }
  }


function isUniform(colId){
  if (!devices || !devices.length) return true;
  var firstSet=false, firstVal=null;
  for (var i=0;i<devices.length;i++){
    var v = readCellValue(colId, devices[i].name);
    if (!firstSet){ firstVal=v; firstSet=true; continue; }
    if (String(v) !== String(firstVal)) return false;
  }
  return true;
}

 // Read per-device settings from preset XML and fold into defaults/overrides
// Werte aus PRESET XML lesen
function loadValuesFromPreset(xmlText){
  if (!xmlText) return;
  var doc; try { doc = parseXml(xmlText); } catch(_) { return; }

  var devMap = {};
  var devEls = Array.prototype.slice.call(doc.querySelectorAll("preset > device"));
  if (devEls.length === 0) devEls = Array.prototype.slice.call(doc.querySelectorAll("device"));
  devEls.forEach(function(de){
    var nEl = de.querySelector("name");
    var name = nEl && nEl.textContent ? nEl.textContent.trim() : "";
    if (name) devMap[name] = de;
  });

  COLS.forEach(function(c){
    var vals = [], perDev = new Map();
    devices.forEach(function(d){
      var de = devMap[d.name]; if (!de) return;
      var v = null;

      if (c.id === "samplerate"){
        var el = de.querySelector("samplerate");
        if (el && el.textContent) v = Number(el.textContent.trim());
      } else if (c.id === "unicast_latency_ms"){
        var ul = de.querySelector("unicast_latency");
        if (ul && ul.textContent){
          var micros = Number(ul.textContent.trim());
          if (!isNaN(micros)) v = micros/1000.0;
        }
      } else if (c.id === "preferred_master"){
        var pm = de.querySelector("preferred_master");
        if (pm && pm.getAttribute("value") != null) v = String(pm.getAttribute("value"));
      } else if (c.id === "external_word_clock"){
        var ew = de.querySelector("external_word_clock");
        if (ew && ew.getAttribute("value") != null) v = String(ew.getAttribute("value"));
      } else if (c.id === "redundancy"){
        var r = de.querySelector("redundancy");
        if (r && r.getAttribute("value") != null) v = String(r.getAttribute("value"));
      } else if (c.id === "encoding_bits"){
        var enc = de.querySelector("encoding");
        if (enc && enc.textContent) v = Number(enc.textContent.trim());
      } else if (c.id === "switch_vlan"){
        var sv = de.querySelector("switch_vlan");
        if (sv && sv.getAttribute("value") != null) v = Number(sv.getAttribute("value"));
      } else if (c.id.startsWith("ip")){
        var net = c.id[2];
        var iface = de.querySelector('interface[network="'+net+'"]');
        if (iface){
          var ipv4 = iface.querySelector("ipv4_address");
          if (c.id.endsWith("_mode")){
            if (ipv4 && ipv4.getAttribute("mode")) v = String(ipv4.getAttribute("mode"));
          } else {
            var key = c.id.split("_")[1];
            if (key === "addr"){ var a = iface.querySelector("address");   if (a) v = (a.textContent||"").trim(); }
            if (key === "mask"){ var m = iface.querySelector("netmask");   if (m) v = (m.textContent||"").trim(); }
            if (key === "gw"){   var g = iface.querySelector("gateway");   if (g) v = (g.textContent||"").trim(); }
            if (key === "dns"){  var dS= iface.querySelector("dnsserver"); if (dS) v = (dS.textContent||"").trim(); }
          }
        }
      }

      perDev.set(d.name, v);
      if (v != null) vals.push(String(v));
    });

    if (vals.length){
    var freq = {}, best=null, bestN=-1;
    vals.forEach(function(s){ freq[s]=(freq[s]||0)+1; });
    Object.keys(freq).forEach(function(k){ if (freq[k]>bestN){ best=k; bestN=freq[k]; }});
    var bestVal = (c.type === "number" || c.id==="unicast_latency_ms") ? Number(best) : best;
    state[c.id].default = bestVal;
    state[c.id].initial = Object.create(null);
    devices.forEach(function(d){
      if (perDev.has(d.name)) state[c.id].initial[d.name] = perDev.get(d.name);
    });
    }
  });
}
 

  function buildHead(){
    var thead = $("#sHead"); if (!thead) return;
    thead.innerHTML = "";
    var tr1 = document.createElement("tr");
    // linke Rail Header
    var thRail = document.createElement("th");
    thRail.className = "top-left-0";
    thRail.textContent = "#";
    tr1.appendChild(thRail);

    COLS.forEach(function(c, idx){
      var th = document.createElement("th");
      th.className = "tx-chan" + (idx%2 ? " tx-band-odd" : " tx-band-even");
      th.textContent = c.label;
      tr1.appendChild(th);
    });
    thead.appendChild(tr1);

    var trDefault = document.createElement("tr");
    var thName = document.createElement("th");
    thName.className = "rowchan top-left-1";
    thName.textContent = "Standard";
    trDefault.appendChild(thName);

COLS.forEach(function(c, idx){
  var td = document.createElement("th");
  td.className = (idx%2 ? "tx-band-odd":"tx-band-even");
  if (c && (c.title === "#" || c.id === "idx" || c.id === "index")) {
    td.classList.add("col-narrow");
  }

var input = makeEditor(c, consensusValue(c.id), function(v){
  applyStandardToAll(c.id, input, v);
  refreshUniformMarks();
});
  input.dataset.scope = "default";
  input.addEventListener("focus", function(){
    input.dataset._armed = "1";
    input.dataset._editing = "1";
    UI.defaultEditing[c.id] = true;
  });
  input.addEventListener("blur", function(){
    var wasArmed = (input.dataset._armed === "1");
    delete input.dataset._editing;
    input.dataset._armed = "";
    if (wasArmed){
      applyStandardToAll(c.id, input);
      refreshUniformMarks();
    }
    UI.defaultEditing[c.id] = false;
    refreshDefaultRowDisplay();
  });
  td.appendChild(input);
  trDefault.appendChild(td);
});
    thead.appendChild(trDefault)
    attachIpToggle(0);
    attachIpToggle(1);
    updateIpModeSVisibility();
  }
    // Einmalige Verteilung des Default-Werts auf Geräte ohne Override
function applyDefaultAsOverrides(colId, value){
  ensureState();
  var col = state[colId]; if (!col) return;
  var v = (value === "" ? null : value);
  if (!col.overrides) col.overrides = new Map();
  devices.forEach(function(d){
    col.overrides.set(d.name, v);
  });
  var cdef = COLS.find(function(x){ return x.id === colId; });
  var tbody = $("#sBody");
if (tbody && cdef){
  var inputs = tbody.querySelectorAll('input[data-col-id="'+colId+'"], select[data-col-id="'+colId+'"]');
  inputs.forEach(function(ed){
    var devName = ed && ed.dataset ? ed.dataset.dev : null;
    if (!devName) return;
    setEditorControl(cdef, ed, v);
    if (!state[colId].touched) state[colId].touched = Object.create(null);
    state[colId].touched[devName] = true;
  });
}
}

  // Editor-Wert einer Zelle setzen (UI, ohne Override)
  function setEditorControl(col, ed, value){
    var v = (value == null ? "" : value);
    if (!ed) return;
    if (col.type === "select"){
      ed.value = String(v);
      if (v !== "" && !Array.prototype.some.call(ed.options||[], function(o){ return o.value == String(v); })){
        var opt = document.createElement("option");
        opt.value = String(v); opt.textContent = String(v);
        ed.appendChild(opt);
        ed.value = String(v);
      }
    } else if (col.type === "number"){
      ed.value = (v === "" ? "" : String(v));
    } else {
      ed.value = String(v);
    }
  }

  function getColDef(colId){
  for (var i=0;i<COLS.length;i++) if (COLS[i].id === colId) return COLS[i];
  return null;
  }
  function getCellEditor(colId, devName){
    var tbody = $("#sBody"); if (!tbody) return null;
    return tbody.querySelector('[data-scope="cell"][data-col-id="'+colId+'"][data-dev="'+devName+'"]');
  }

function isEditorVisible(ed){
  if (!ed) return false;
  var st = window.getComputedStyle ? getComputedStyle(ed) : ed.style;
  if (st && (st.display === "none" || st.visibility === "hidden")) return false;
  var td = ed.closest ? ed.closest("td") : ed.parentElement;
  if (td){
    var tdSt = window.getComputedStyle ? getComputedStyle(td) : td.style;
    if (tdSt && tdSt.display === "none") return false;
  }
  var tr = td && (td.parentElement && td.parentElement.tagName === "TR") ? td.parentElement : null;
  if (tr){
    var trSt = window.getComputedStyle ? getComputedStyle(tr) : tr.style;
    if (trSt && trSt.display === "none") return false;
  }
  if (ed.offsetParent === null) return false;
  return true;
}


function toggleCellEditor(colId, devName, show){
  var ed = getCellEditor(colId, devName); if (!ed) return;
  ed.style.display = show ? "" : "none";
  ed.disabled = show ? false : true;
}


  function readCellValue(colId, devName){
    var ed = getCellEditor(colId, devName); if (!ed) return null;
    var c  = getColDef(colId); if (!c) return null;
    return readEditorValue(c, ed);
  }

  // Default -> Zellen ohne Override live updaten
function applyDefaultToColumn(colId){
  var c = COLS.find(function(x){ return x.id === colId; }); if (!c) return;
  var tbody = $("#sBody"); if (!tbody) return;
  var editors = tbody.querySelectorAll('[data-scope="cell"][data-col-id="'+colId+'"]');
  editors.forEach(function(ed){
    if (!isEditorVisible(ed)) return;
    var devName = ed.dataset && ed.dataset.dev ? ed.dataset.dev : null;
    if (!devName) return;
    if (!state[colId].touched[devName]){ setEditorControl(c, ed, state[colId].default); }
  });
  refreshDefaultRowDisplay();
}
  // Konsenswert über alle Geräte (effektive Werte)
  function consensusValue(colId){
    var firstSet = false, firstVal = null;
    for (var i=0;i<devices.length;i++){
      var dn = devices[i].name;
      var v = readCellValue(colId, dn);
      if (!firstSet){ firstVal = v; firstSet = true; }
      if (String(v) !== String(firstVal)) return null;
    }
    return firstVal;
  }
  // Standardzeile nur als Anzeige des Konsenses (oder NULL) aktualisieren
function refreshDefaultRowDisplay(){
  var thead = $("#sHead"); if (!thead) return;
  var row2 = thead.rows[1]; if (!row2) return;
  COLS.forEach(function(c, idx){
    var cell = row2.cells[idx+1]; if (!cell) return;
    var ed   = cell.querySelector('select,input'); if (!ed) return;
    if (ed.dataset._editing === "1") return;
    if (UI.defaultEditing && UI.defaultEditing[c.id]) return;
    if (UI.editingCols && UI.editingCols[c.id]) return;
    var cv = consensusValue(c.id);
    setEditorControl(c, ed, cv);
  });
}

function ipCols(idx){
  return idx === 0
    ? ["ip0_addr","ip0_mask","ip0_gw","ip0_dns"]
    : ["ip1_addr","ip1_mask","ip1_gw","ip1_dns"];
}
function isStaticModeValue(v){
  var s = String(v==null? "": v).toLowerCase();
  return s === "static" || s === "manual";
}
function anyDeviceStatic(idx){
  var modeId = idx===0? "ip0_mode":"ip1_mode";
  for (var i=0;i<(devices||[]).length;i++){
    var dn = devices[i].name;
    var mv = readCellValue(modeId, dn);
    if (isStaticModeValue(mv)) return true;
  }
  return false;
}

function getStdEditor(colId){
  var thead = $("#sHead"); if (!thead) return null;
  var row2 = thead.rows[1]; if (!row2) return null;
  // +1 weil erste Kopfspalte „Standard“-Label ist
  var idx = COLS.findIndex(x=>x.id===colId); if (idx<0) return null;
  var cell = row2.cells[idx+1]; if (!cell) return null;
  return cell.querySelector('select,input');
}

function toggleStdEditor(colId, show){
  var ed = getStdEditor(colId); if (!ed) return;
  ed.style.display = show ? "" : "none";
  ed.disabled = show ? false : true;
}
function isRedundancyEnabled(v){
  var s = String(v==null? "": v).toLowerCase();
  return s === "true" || s === "enabled" || s === "1";
}
function anyDeviceRedundancyEnabled(){
  for (var i=0;i<(devices||[]).length;i++){
    var dn = devices[i].name;
    if (isRedundancyEnabled(readCellValue("redundancy", dn))) return true;
  }
  return false;
}


function getHeaderCell(colId){
  var thead = $("#sHead"); if (!thead) return null;
  var row1 = thead.rows[0]; if (!row1) return null;
  var idx = COLS.findIndex(x=>x.id===colId); if (idx<0) return null;
  return row1.cells[idx+1] || null;
}
function getBodyEditorsFor(colId){
  var tbody = $("#sBody"); if (!tbody) return [];
  return Array.prototype.slice.call(
    tbody.querySelectorAll('[data-scope="cell"][data-col-id="'+colId+'"]')
  );
}
function setColCellValue(colId, devName, value){
  var ed = getCellEditor(colId, devName); if (!ed) return;
  var c  = getColDef(colId); if (!c) return;
  setEditorControl(c, ed, value);
  ensureState();
  if (!state[colId].touched) state[colId].touched = Object.create(null);
  state[colId].touched[devName] = true;
}
function setColDefault(colId, value){
  ensureState();
  if (!state[colId]) state[colId] = { default:null, touched:Object.create(null) };
  state[colId].default = value;
}
function collapseIpGroup(idx, reasonDynamic){
  UI.ipExpanded[idx] = false;
  var cols = ipCols(idx);
  // Spalten im Kopf & Body verstecken
  cols.forEach(function(cid){
    toggleColumnVisibility(cid, false);
  });
  // Wenn dynamisch: alle IP-Werte auf NULL setzen (Standard + alle Devices)
  if (reasonDynamic){
    setColDefault(cols[0], null); setColDefault(cols[1], null);
    setColDefault(cols[2], null); setColDefault(cols[3], null);
    (devices||[]).forEach(function(d){
      cols.forEach(function(cid){ setColCellValue(cid, d.name, null); });
    });
  }
  refreshUniformMarks();
  refreshDefaultRowDisplay();
}
function expandIpGroup(idx){
  UI.ipExpanded[idx] = true;
  ipCols(idx).forEach(function(cid){
    toggleColumnVisibility(cid, true);
  });
  refreshUniformMarks();
  refreshDefaultRowDisplay();
}
// Sichtbarkeit einer Spalte toggeln (Kopf + Body)
function toggleColumnVisibility(colId, show){
  var thead = $("#sHead"), tbody = $("#sBody");
  var colIndex = COLS.findIndex(x=>x.id===colId);
  if (colIndex>=0 && thead){
    var h1 = thead.rows[0], h2 = thead.rows[1];
    var i = colIndex+1; // +1 wegen erster Beschriftungsspalte
    if (h1 && h1.cells[i]) h1.cells[i].style.display = show ? "" : "none";
    if (h2 && h2.cells[i]) h2.cells[i].style.display = show ? "" : "none";
  }
  if (tbody){
    for (var r=0; r<tbody.rows.length; r++){
      var row = tbody.rows[r];
      var i = colIndex+1;
      if (row && row.cells[i]) row.cells[i].style.display = show ? "" : "none";
    }
  }
}
function attachIpToggle(idx){
  var colId = idx===0? "ip0_mode":"ip1_mode";
  var th = getHeaderCell(colId); if (!th) return;
  var btn = document.createElement("button");
  btn.type="button"; btn.className="ip-toggle";
  btn.title="IP-Details ein/aus";
  btn.textContent = UI.ipExpanded[idx] ? "▾" : "▸";
  btn.style.marginLeft = "6px";
  btn.addEventListener("click", function(){
    UI.ipExpanded[idx] = !UI.ipExpanded[idx];
    updateIpGroupVisibility(idx);
    btn.textContent = UI.ipExpanded[idx] ? "▾" : "▸";
    queueAdjustColumnWidths();
  });
  th.appendChild(btn);
}

function onIpModeChanged(idx){
  var colId = idx===0? "ip0_mode":"ip1_mode";
  updateIpGroupVisibility(idx);
}

function updateIpGroupVisibility(idx){
  var modeId = idx===0? "ip0_mode":"ip1_mode";
  var cols   = ipCols(idx);
  var showGroup = UI.ipExpanded[idx] && anyDeviceStatic(idx);
  cols.forEach(function(cid){ toggleColumnVisibility(cid, showGroup); });
  (devices||[]).forEach(function(d){
    var isStatic = isStaticModeValue(readCellValue(modeId, d.name));
    cols.forEach(function(cid){
      toggleCellEditor(cid, d.name, showGroup && isStatic);
      if (!isStatic) setColCellValue(cid, d.name, null);
    });
  });
  refreshUniformMarks();
  refreshDefaultRowDisplay();
  queueAdjustColumnWidths();

}

function updateIpModeSVisibility(){
  var showStd = anyDeviceRedundancyEnabled();
  toggleStdEditor("ip1_mode", showStd);
  if (!showStd){ setColDefault("ip1_mode", null); }
  (devices||[]).forEach(function(d){
    var enabled = isRedundancyEnabled(readCellValue("redundancy", d.name));
    toggleCellEditor("ip1_mode", d.name, enabled);
    if (!enabled) setColCellValue("ip1_mode", d.name, null);
  });
  refreshUniformMarks();
  refreshDefaultRowDisplay();
  queueAdjustColumnWidths();
}


function writeIfTouched(colId, devName, de, xmlKey, options){
  if (!columnTouched(colId, devName)) return;
  var v = readCellValue(colId, devName);
  if (v == null){
    var el = de.querySelector(xmlKey); if (el) el.remove();
    return;
  }
  if (options && options.valueAttr){
    ensureEl(de, xmlKey, {value:String(v)});
  } else if (options && options.transform){
    ensureEl(de, xmlKey).textContent = options.transform(v);
  } else {
    ensureEl(de, xmlKey).textContent = String(v);
  }
}

function writeIpIfTouched(devName, devEl, netIdx){
  var modeId = "ip"+netIdx+"_mode";
  var addrId = "ip"+netIdx+"_addr";
  var maskId = "ip"+netIdx+"_mask";
  var gwId   = "ip"+netIdx+"_gw";
  var dnsId  = "ip"+netIdx+"_dns";

  var any =
    columnTouched(modeId, devName) ||
    columnTouched(addrId, devName) ||
    columnTouched(maskId, devName) ||
    columnTouched(gwId,   devName) ||
    columnTouched(dnsId,  devName);
  if (!any) return;

  var iface = ensureInterfaceEl(devEl, netIdx);
  var ipv4  = iface.querySelector("ipv4_address") || iface.ownerDocument.createElement("ipv4_address");
  if (!ipv4.parentNode) iface.appendChild(ipv4);

  if (columnTouched(modeId, devName)){
    var mv = readCellValue(modeId, devName);
    if (mv == null) ipv4.removeAttribute("mode");
    else ipv4.setAttribute("mode", String(mv));
  }
  if (columnTouched(addrId, devName)){
    var v = readCellValue(addrId, devName);
    if (v == null){ var el = iface.querySelector("address"); if (el) el.remove(); }
    else ensureEl(iface, "address").textContent = String(v);
  }
  if (columnTouched(maskId, devName)){
    var v = readCellValue(maskId, devName);
    if (v == null){ var el = iface.querySelector("netmask"); if (el) el.remove(); }
    else ensureEl(iface, "netmask").textContent = String(v);
  }
  if (columnTouched(gwId, devName)){
    var v = readCellValue(gwId, devName);
    if (v == null){ var el = iface.querySelector("gateway"); if (el) el.remove(); }
    else ensureEl(iface, "gateway").textContent = String(v);
  }
  if (columnTouched(dnsId, devName)){
    var v = readCellValue(dnsId, devName);
    if (v == null){ var el = iface.querySelector("dnsserver"); if (el) el.remove(); }
    else ensureEl(iface, "dnsserver").textContent = String(v);
  }
}



// Anwenden des Standardwerts auf ALLE Devices, ausgelöst durch User-Interaktion (Focus->Blur)
function applyStandardToAll(colId, stdEditor, explicitValue){
  ensureState();
  var cdef = COLS.find(function(x){ return x.id === colId; }); if (!cdef) return;
  var v = (arguments.length >= 3) ? explicitValue : readEditorValue(cdef, stdEditor);
  state[colId].default = v;
  var tbody = $("#sBody"); if (!tbody) return;
  var editors = tbody.querySelectorAll('[data-scope="cell"][data-col-id="'+colId+'"]');
  editors.forEach(function(ed){
    if (!isEditorVisible(ed)) return;
    var devName = ed.dataset && ed.dataset.dev ? ed.dataset.dev : null;
    if (!devName) return;
    setEditorControl(cdef, ed, v);
    if (!state[colId].touched) state[colId].touched = Object.create(null);
    state[colId].touched[devName] = true;
  });
  refreshUniformMarks();
  refreshDefaultRowDisplay();
}


// makeEditor(): Select bekommt (null)-Option; Number/Text erlauben leere Eingaben -> null
function makeEditor(col, value, onChange){
  var el;
  if (col.type === "select"){
    el = document.createElement("select");
    var nullOpt = document.createElement("option");
    nullOpt.value = ""; nullOpt.textContent = "";
    el.appendChild(nullOpt);
    (col.options||[]).forEach(function(opt){
      var o = document.createElement("option");
      o.value = String(opt); o.textContent = String(opt);
      el.appendChild(o);
    });
    el.value = (value == null ? "" : String(value));
    el.addEventListener("change", function(){
      var v = el.value;
      onChange(v === "" ? null : v);
    });
  } else if (col.type === "number"){
    el = document.createElement("input");
    el.type = "number";
    if (col.min != null) el.min = String(col.min);
    if (col.max != null) el.max = String(col.max);
    if (col.step!= null) el.step= String(col.step);
    el.value = (value == null ? "" : String(value));
    el.addEventListener("input", function(){
      var v = el.value;
      onChange(v === "" ? null : Number(v));
    });
  } else {
    el = document.createElement("input");
    el.type = "text";
    el.value = (value == null ? "" : String(value));
    el.addEventListener("input", function(){
      var v = el.value;
      onChange(v === "" ? null : v);
    });
  }
  return el;
}

function readEditorValue(col, ed){
  if (!ed) return null;
  if (col.type === "select"){
    return ed.value === "" ? null : ed.value;
  } else if (col.type === "number"){
    var t = ed.value; if (t === "") return null;
    var n = Number(t); return isNaN(n) ? null : n;
  } else {
    return ed.value === "" ? null : ed.value;
  }
}

function buildBody(){
  var tbody = $("#sBody"); if (!tbody) return;
  tbody.innerHTML = "";
  devices.forEach(function(rowDev, rix){
    var tr = document.createElement("tr");

    var th = document.createElement("td");
    th.className = "rowchan";
    th.textContent = rowDev.name || "";
    tr.appendChild(th);

// buildBody(): Spalten mit showIf=false als Platzhalter rendern (visibility:hidden)
COLS.forEach(function(c, idx){
  var td = document.createElement("td");
  if (c && (c.title === "#" || c.id === "idx" || c.id === "index")) {
  td.classList.add("col-narrow"); 
  }

  td.className = (idx%2 ? "tx-band-odd":"tx-band-even") + " cell";

  if (!columnVisibleForDevice(c, rowDev)) {
    td.className += " col-hidden";
    td.style.visibility = "hidden"; // Platz beibehalten, aber unsichtbar
    tr.appendChild(td);
    return;
  }

  td.className += " editable";
var val = (state[c.id] && state[c.id].initial && (rowDev.name in state[c.id].initial))
          ? state[c.id].initial[rowDev.name]
          : valueFor(c.id, rowDev.name);
  var ed  = makeEditor(c, val, function(v){
    ensureState();
    state[c.id].touched[rowDev.name] = true;
    refreshUniformMarks();
    if (c.id==="ip0_mode") onIpModeChanged(0);
    if (c.id==="ip1_mode") onIpModeChanged(1);
    if (c.id==="redundancy") updateIpModeSVisibility();
  });
  ed.dataset.scope = "cell";
  ed.dataset.colId = c.id;
  ed.dataset.dev   = rowDev.name;
  td.appendChild(ed);

  td.addEventListener("contextmenu", function(ev){
    ev.preventDefault();
    var colId = ed.dataset.colId;
    var name  = ed.dataset.dev;
    var v = readEditorValue(c, ed);
    copyDown(colId, name, v);
    refreshUniformMarks();
  });
  
  ed.addEventListener("focus", function(){ UI.editingCols[c.id] = true; });
  ed.addEventListener("blur", function(){
  delete UI.editingCols[c.id];
  refreshDefaultRowDisplay();
});
  tr.appendChild(td);
});
    tbody.appendChild(tr);
  }); // devices.forEach schließen
}     // buildBody schließen

function copyDown(colId, fromName, value){
  var start = devices.findIndex(function(x){ return x.name === fromName; });
  if (start < 0) return;
  for (var i=start; i<devices.length; i++){
    var dn = devices[i].name;
    var ed = getCellEditor(colId, dn);
    var c  = getColDef(colId);
    if (ed && c){
      setEditorControl(c, ed, value);
      if (state[colId] && state[colId].touched) state[colId].touched[dn] = true;
    }
  }
}

function refreshUniformMarks(){
  var thead = $("#sHead"); if(!thead) return;
  COLS.forEach(function(c, idx){
    var row2 = thead.rows[1];
    if (!row2) return;
    var cell = row2.cells[idx+1];
    if (!cell) return;
    var color = "";
    if (c.id !== "external_word_clock"){
      if (isUniform(c.id)) color = "#e6ffe6";
    } else {
      var cnt = 0;
    devices.forEach(function(d){
      if (String(readCellValue(c.id, d.name)) === "true") cnt++;
    });
      if (cnt === 1) color = "#e6ffe6";
    }
    cell.style.background = color;
  });
  // Am Ende von refreshUniformMarks():
  refreshDefaultRowDisplay(); // nur UI, keine State-Änderung
}



  function filterDevices(text){
    text = (text||"").toLowerCase().trim();
    if (!text) return devices.slice();
    return devices.filter(function(d){ return (d.name||"").toLowerCase().indexOf(text) !== -1; });
  }

  function renderAll(){
    // vor dem Rendern sicherstellen, dass state initialisiert ist
    ensureState();
    buildHead();
    buildBody();
    refreshUniformMarks();
    setupFixedHScrollSettings();
    queueFixedHScrollSettings();  
    queueAdjustColumnWidths();
    }

  function init(){
    var xml = readFromSession();
    if (!xml){
      var hint = $("#hint"); if (hint) hint.textContent = "Kein Preset gefunden. Bitte zurück zur Übersicht.";
      return;
    }
devices = loadDevicesFromPreset(xml);
ensureState();
loadValuesFromPreset(xml);
renderAll();

    var inp = $("#filterDev");
    if (inp){
      inp.addEventListener("input", function(){
        var list = filterDevices(inp.value);
        var keep = new Set(list.map(function(x){ return x.name; }));
        var tbody = $("#sBody");
        if (!tbody) return;
        Array.prototype.forEach.call(tbody.rows, function(row, idx){
          var name = (idx < devices.length) ? devices[idx].name : "";
          row.style.display = keep.has(name) ? "" : "none";
        });
        refreshDefaultRowDisplay();
      });
    }
    UI.ipExpanded[0] = false;
    UI.ipExpanded[1] = false;
    updateIpGroupVisibility(0);
    updateIpGroupVisibility(1);
    updateIpModeSVisibility();

    queueAdjustColumnWidths();
    window.addEventListener("resize", queueAdjustColumnWidths, {passive:true});
  }

// --- Spaltenbreiten-Logik ---
var _adjRAF = 0;
function queueAdjustColumnWidths(){
  if (_adjRAF) return;
  _adjRAF = requestAnimationFrame(function(){
    _adjRAF = 0;
    try { adjustColumnWidths(); } catch(_){}
  });
}
function adjustColumnWidths(){
  var wrap = document.getElementById("settingsWrap");
  var table = document.getElementById("settingsMatrix");
  var thead = document.getElementById("sHead");
  var tbody = document.getElementById("sBody");
  if (!wrap || !table || !thead || !tbody) return;

  var railW = 0;
  if (thead.rows[0] && thead.rows[0].cells[0]){
    railW = Math.ceil(thead.rows[0].cells[0].getBoundingClientRect().width);
  }
  var wrapW = Math.floor(wrap.clientWidth);
  if (!wrapW) return;

  var N = COLS.length;
  if (!N) return;

  var minW = new Array(N).fill(0);
  for (var i=0;i<N;i++){
    var headCell = (thead.rows[0] && thead.rows[0].cells[i+1]) ? thead.rows[0].cells[i+1] : null;
    var defCell  = (thead.rows[1] && thead.rows[1].cells[i+1]) ? thead.rows[1].cells[i+1] : null;
    var bodyCell = (tbody.rows[0] && tbody.rows[0].cells[i+1]) ? tbody.rows[0].cells[i+1] : null;
    var w = 0;
    if (headCell){
      var prev = headCell.style.width; headCell.style.width = "auto";
      w = Math.max(w, Math.ceil(headCell.scrollWidth));
      headCell.style.width = prev;
    }
    if (defCell){
      var ed = defCell.querySelector("select,input");
      if (ed){
        var prevW = ed.style.width; ed.style.width = "auto";
        w = Math.max(w, Math.ceil(ed.scrollWidth)+10);
        ed.style.width = prevW;
      }
    }
    if (bodyCell){
      var edb = bodyCell.querySelector("select,input");
      if (edb){
        var pW = edb.style.width; edb.style.width = "auto";
        w = Math.max(w, Math.ceil(edb.scrollWidth)+10);
        edb.style.width = pW;
      }else{
        w = Math.max(w, Math.ceil(bodyCell.scrollWidth));
      }
    }
    minW[i] = Math.max(w, 90);
  }

  var available = Math.max(wrapW - railW, 0);
  var sumMin = minW.reduce((a,b)=>a+b, 0);
  var target = 0;
  if (available > sumMin){
    target = Math.floor((available) / N);
  }

  for (var i2=0;i2<N;i2++){
    var widthPx = Math.max(minW[i2], target);
    applyColWidth(i2, widthPx);
  }
}
function applyColWidth(colIdx, px){
  var thead = document.getElementById("sHead");
  var tbody = document.getElementById("sBody");
  var i = colIdx + 1;
  if (thead){
    if (thead.rows[0] && thead.rows[0].cells[i]) thead.rows[0].cells[i].style.width = px+"px";
    if (thead.rows[1] && thead.rows[1].cells[i]) thead.rows[1].cells[i].style.width = px+"px";
  }
  if (tbody){
    for (var r=0;r<tbody.rows.length;r++){
      var cell = tbody.rows[r].cells[i];
      if (cell) cell.style.width = px+"px";
    }
  }
}


// writeValuesToPreset jetzt top-level (außerhalb von init), wie im Diff
function ensureInterface(parent, idx){
  var sel = 'interface[network="'+idx+'"]';
  var el  = parent.querySelector(sel);
  if (!el){
    el = parent.ownerDocument.createElement("interface");
    el.setAttribute("network", String(idx));
    parent.appendChild(el);
  }
  return el;
}
function writeValuesToPreset(doc){
  var devMap = {};
  Array.prototype.forEach.call(doc.querySelectorAll("device"), function(el){
    var n = el.querySelector("name");
    var name = n && n.textContent ? n.textContent.trim() : "";
    if (name) devMap[name] = el;
  });
  devices.forEach(function(d){
    var de = devMap[d.name]; if (!de) return;
    writeIfTouched("samplerate",          d.name, de, "samplerate",      { transform: v => String(v|0) });
    writeIfTouched("unicast_latency_ms",  d.name, de, "unicast_latency", { transform: v => String(Math.round(Number(v)*1000)) });
    writeIfTouched("preferred_master",    d.name, de, "preferred_master",{ valueAttr: true });
    writeIfTouched("external_word_clock", d.name, de, "external_word_clock",{ valueAttr: true });
    writeIfTouched("redundancy",          d.name, de, "redundancy",      { valueAttr: true });
    writeIfTouched("encoding_bits",       d.name, de, "encoding",        { transform: v => String(v|0) });
    writeIfTouched("switch_vlan",         d.name, de, "switch_vlan",     { valueAttr: true });
    writeIpIfTouched(d.name, de, 0, ensureInterface);
    writeIpIfTouched(d.name, de, 1, ensureInterface);
    placeSettingsBeforeChannels(de);
  });
}

// ---------- Platzierung & Reihenfolge der Settings vor den Channels ----------
var SETTINGS_ORDER = [
  {type:"tag", sel:"switch_vlan"},
  {type:"tag", sel:"preferred_master"},
  {type:"tag", sel:"external_word_clock"},
  {type:"tag", sel:"samplerate"},
  {type:"tag", sel:"encoding"},
  {type:"tag", sel:"unicast_latency"},
  {type:"iface", idx:0},
  {type:"iface", idx:1}
];

function firstChannelRef(devEl){
  return devEl.querySelector("txchannel, rxchannel");
}
function moveBefore(node, ref){
  if (!node || !ref || node === ref) return;
  ref.parentNode.insertBefore(node, ref);
}
function ensureInterfaceEl(devEl, idx){
  var sel = 'interface[network="'+idx+'"]';
  var el  = devEl.querySelector(sel);
  if (!el){
    el = devEl.ownerDocument.createElement("interface");
    el.setAttribute("network", String(idx));
    devEl.appendChild(el); // Einsortierung erfolgt danach in placeSettingsBeforeChannels
  }
  return el;
}
function placeSettingsBeforeChannels(devEl){
  var ref = firstChannelRef(devEl);
  if (!ref) return; // keine Channels -> nichts zu tun
  SETTINGS_ORDER.forEach(function(item){
    var node = null;
    if (item.type === "tag"){
      node = devEl.querySelector(item.sel);
    } else if (item.type === "iface"){
      node = devEl.querySelector('interface[network="'+item.idx+'"]');
    }
    if (node) moveBefore(node, ref);
  });
}


// Aktuelle Settings in das Preset-XML aus der Session übernehmen und wieder speichern
function writePresetToSession(xml){
  try { sessionStorage.setItem("DA_PRESET_XML", xml); } catch(_) {}
  try { window.name = JSON.stringify({ type:"DA_PRESET", xml: xml, ts: Date.now() }); } catch(_) {}
}
function persistSettingsToSession(){
  try{
    var s = (typeof readFromSession === "function") ? readFromSession() : null;
    if (!s) return;
    var doc = parseXml(s);
    try { if (typeof ensurePresetEnvelope === "function") ensurePresetEnvelope(doc); } catch(_){}
    writeValuesToPreset(doc);
    var xml = new XMLSerializer().serializeToString(doc);
    if (typeof writeToSession === "function") writeToSession(xml);
    else writeToSessionAndName(xml);
    writePresetToSession(xml);
  }catch(e){
    // still: Export/Navi nicht blockieren
  }
}
  window.addEventListener("visibilitychange", function(){
    if (document.visibilityState === "hidden") persistSettingsToSession();
  }, {passive:true});
  window.addEventListener("pagehide", persistSettingsToSession, {passive:true});
["btnBack","btnSettingsBack","btnSaveBack","btnSaveSettings"].forEach(function(id){
  var el = document.getElementById(id);
  if (el && !el.__settingsPersistBound){
    el.addEventListener("click", persistSettingsToSession);
    el.__settingsPersistBound = true;
  }
});

// S&B: Nach dem Persistieren sicher zurück zur Übersicht navigieren
(function bindSaveBack(){
  var el = document.getElementById("btnSaveBack");
  if (el && !el.__saveBackNavBound){
    el.addEventListener("click", function(){
      try { persistSettingsToSession(); } catch(_){}
      location.href = "./Index.html#via=settings-matrix";
    });
    el.__saveBackNavBound = true;
  }
})();


  try { init(); } catch(e){
    var hint = $("#hint");
    if (hint) hint.textContent = "Init-Fehler: " + (e.message || String(e));
  }
// Fixe horizontale Scroll-Leiste (Proxy) für Settings-Matrix
// Fixe horizontale Scroll-Leiste (Proxy) – konsolidiert
var __settingsHScrollInited = false;
function setupFixedHScrollSettings(){
  var proxy = document.getElementById('hscrollProxy');
  var wrap  = document.getElementById('settingsWrap') || document.querySelector('.matrix-wrap');
  var table = document.getElementById('settingsMatrix');
  if(!proxy || !wrap || !table) return;

  try{ wrap.style.overflowX = 'hidden'; }catch(_){}

function onWheelHorizontal(e){
  if (e.deltaX || e.shiftKey){
    var delta = (e.deltaX || e.deltaY || 0);
    proxy.scrollLeft += delta;
    e.preventDefault();
  }
}
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
  function getHead(){
    var h = document.getElementById('sHead');
    if (!h && table && table.tHead) h = table.tHead;
    return h || null;
  }
function syncSize(){
  var inner = ensureSpacer();
  var wrapScrollW  = wrap.scrollWidth  || 0;
  var wrapClientW  = wrap.clientWidth  || 0;
  var proxyClientW = proxy.clientWidth || 0;
  var wrapMaxScroll = Math.max(0, wrapScrollW - wrapClientW);
  var spacerW = Math.max(1, proxyClientW + wrapMaxScroll);
  if (inner.style.width !== spacerW + 'px'){
    inner.style.width = spacerW + 'px';
  }
  proxy.style.display = wrapMaxScroll > 0 ? 'block' : 'none';
  if (proxy.scrollLeft !== wrap.scrollLeft) proxy.scrollLeft = wrap.scrollLeft;
}

  if (!__settingsHScrollInited){
    proxy.addEventListener('scroll', function(){
      if (wrap.scrollLeft !== proxy.scrollLeft) wrap.scrollLeft = proxy.scrollLeft;
    }, {passive:true});
    wrap.addEventListener('scroll', function(){
      if (proxy.scrollLeft !== wrap.scrollLeft) proxy.scrollLeft = wrap.scrollLeft;
    }, {passive:true});
    proxy.addEventListener('wheel',  onWheelHorizontal, {passive:false});
    wrap .addEventListener('wheel',  onWheelHorizontal, {passive:false});
    window.addEventListener('resize', function(){ applyBottomOffset(); syncSize(); }, {passive:true});
    __settingsHScrollInited = true;
  }

  if ('ResizeObserver' in window){
    var ro = new ResizeObserver(syncSize);
    ro.observe(wrap); ro.observe(table);
    var headEl = getHead(); if (headEl) ro.observe(headEl);
  }
  var mo = new MutationObserver(syncSize);
  mo.observe(table, {childList:true, subtree:true, attributes:true});
  var headEl2 = getHead(); if (headEl2) mo.observe(headEl2, {childList:true, subtree:true, attributes:true});

  applyBottomOffset();
  setTimeout(function(){ applyBottomOffset(); syncSize(); }, 0);
  setTimeout(syncSize, 80);
  setTimeout(syncSize, 160);
  window.__refreshFixedHScrollSettings = syncSize;
}

// // globaler Block ENTFERNT – nur der Hook bleibt bestehen
function queueFixedHScrollSettings(){
  if (typeof window.__refreshFixedHScrollSettings === 'function'){
    setTimeout(window.__refreshFixedHScrollSettings, 0);
    setTimeout(window.__refreshFixedHScrollSettings, 80);
  }
}


})();

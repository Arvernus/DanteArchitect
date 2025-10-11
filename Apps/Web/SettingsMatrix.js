// Apps/Web/SettingsMatrix.js
(function(){
  var SKEY_XML = "DA_PRESET_XML";

  // Spalten-Definition (erweiterbar)
// Spalten-Definition + Interface-Helper
// Ergänzte Spalten + Helper
var COLS = [
  { id:"samplerate", label:"Sample Rate", type:"select", options:[44100,48000,88200,96000] },
  { id:"unicast_latency_ms", label:"Unicast Latency (ms)", type:"select", options:[0.25,0.5,1,2,4,5,6,10] },
  { id:"preferred_master", label:"Preferred Master", type:"select", options:["false","true"] },
  { id:"external_word_clock", label:"External Word Clock", type:"select", options:["false","true"] },
  { id:"redundancy", label:"Redundancy Enabled", type:"select", options:["false","true"],
    showIf:function(d){ return hasInterface(d,1) && hasDevEl(d,'redundancy'); } },
  { id:"encoding_bits", label:"Encoding (bit)", type:"select", options:[16,24,32],
    showIf:function(d){ return hasDevEl(d,'encoding'); } },
  { id:"switch_vlan", label:"Switch VLAN", type:"number", min:1, step:1,
    showIf:function(d){ return hasDevEl(d,'switch_vlan'); } },
  { id:"ip0_mode",   label:"IP Mode (P)", type:"select", options:["dynamic","static"] },
  { id:"ip0_addr",   label:"IP Address (P)", type:"text",  showIf:function(d){ return hasInterface(d,0); } },
  { id:"ip0_mask",   label:"Netmask (P)",   type:"text",  showIf:function(d){ return hasInterface(d,0); } },
  { id:"ip0_gw",     label:"Gateway (P)",   type:"text",  showIf:function(d){ return hasInterface(d,0); } },
  { id:"ip0_dns",    label:"DNS (P)",       type:"text",  showIf:function(d){ return hasInterface(d,0); } },
  { id:"ip1_mode",   label:"IP Mode (S)",   type:"select", options:["dynamic","static"], showIf:function(d){ return hasInterface(d,1); } },
  { id:"ip1_addr",   label:"IP Address (S)", type:"text", showIf:function(d){ return hasInterface(d,1); } },
  { id:"ip1_mask",   label:"Netmask (S)",    type:"text", showIf:function(d){ return hasInterface(d,1); } },
  { id:"ip1_gw",     label:"Gateway (S)",    type:"text", showIf:function(d){ return hasInterface(d,1); } },
  { id:"ip1_dns",    label:"DNS (S)",        type:"text", showIf:function(d){ return hasInterface(d,1); } }
];


function hasInterface(d, idx){
  if (!d || !d.el) return idx === 0;
  var sel = 'interface[network="'+idx+'"]';
  return d.el.querySelector(sel) != null;
}

// Sichtbarkeitsprüfung pro Spalte robust kapseln
function columnVisibleForDevice(col, devObj){
  try {
    if (typeof col.showIf !== "function") return true;
    return !!col.showIf(devObj);
  } catch(e){
    return true;
  }
}

function hasDevEl(d, selector){
  return !!(d && d.el && d.el.querySelector(selector));
}


  var devices = [];      // [{name}]
  var state   = {};      // { colId: { default: any, overrides: Map<name,any> } }

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
    if (col.type === "select") return (col.options && col.options[0]) || "";
    if (col.type === "number") return 0;
    return "";
  }
  function ensureState(){
  COLS.forEach(function(c){
    if (!state[c.id]) state[c.id] = { default: defaultValue(c), overrides: new Map() };
  });
}


  function valueFor(colId, devName){
    var c = state[colId]; if (!c) return "";
    if (c.overrides.has(devName)) return c.overrides.get(devName);
    return c.default;
  }
  function isUniform(colId){
    var c = state[colId]; if (!c) return false;
    var val = c.default;
    for (var i=0;i<devices.length;i++){
      var dn = devices[i].name;
      var v  = c.overrides.has(dn) ? c.overrides.get(dn) : val;
      if (String(v) !== String(val)) return false;
    }
    return true;
  }

 // Read per-device settings from preset XML and fold into defaults/overrides
// Werte aus PRESET XML lesen
function loadValuesFromPreset(xmlText){
  if (!xmlText) return;
  var doc;
  try { doc = parseXml(xmlText); } catch(_) { return; }

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
      var de = devMap[d.name], v = null;
      if (!de) return;

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
      // Ergänzung in loadValuesFromPreset():
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

      if (v != null){ perDev.set(d.name, v); vals.push(String(v)); }
    });

    if (vals.length){
      var freq = {}, best=null, bestN=-1;
      vals.forEach(function(s){ freq[s]=(freq[s]||0)+1; });
      Object.keys(freq).forEach(function(k){ if (freq[k]>bestN){ best=k; bestN=freq[k]; }});
      var bestVal = (c.type === "number") ? Number(best) : (c.id==="unicast_latency_ms" ? Number(best) : best);
      state[c.id].default = bestVal;
      devices.forEach(function(d){
        var vv = perDev.has(d.name) ? perDev.get(d.name) : bestVal;
        if (String(vv) !== String(bestVal)) state[c.id].overrides.set(d.name, vv);
        else state[c.id].overrides.delete(d.name);
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
      var input = makeEditor(c, state[c.id].default, function(v){
        state[c.id].default = v;
        refreshUniformMarks();
      });
      input.dataset.scope = "default";
      td.appendChild(input);
      trDefault.appendChild(td);
    });
    thead.appendChild(trDefault);
  }

  function makeEditor(col, value, onChange){
    var el;
    if (col.type === "select"){
      el = document.createElement("select");
      (col.options||[]).forEach(function(opt){
        var o = document.createElement("option");
        o.value = opt; o.textContent = opt;
        el.appendChild(o);
      });
      el.value = String(value||"");
    } else if (col.type === "number"){
      el = document.createElement("input");
      el.type = "number";
      if (col.min != null)  el.min = col.min;
      if (col.step != null) el.step = col.step;
      el.value = String(value);
    } else {
      el = document.createElement("input");
      el.type = "text";
      el.value = String(value||"");
    }
    el.addEventListener("change", function(){ onChange && onChange(readEditorValue(col, el)); });
    el.addEventListener("input",  function(){ onChange && onChange(readEditorValue(col, el)); });
    el.style.width = "160px";
    return el;
  }
  function readEditorValue(col, el){
    if (col.type === "number") return Number(el.value);
    return el.value;
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
  td.className = (idx%2 ? "tx-band-odd":"tx-band-even") + " cell";

  if (!columnVisibleForDevice(c, rowDev)) {
    td.className += " col-hidden";
    td.style.visibility = "hidden"; // Platz beibehalten, aber unsichtbar
    tr.appendChild(td);
    return;
  }

  td.className += " editable";
  var val = valueFor(c.id, rowDev.name);
  var ed  = makeEditor(c, val, function(v){
    state[c.id].overrides.set(rowDev.name, v);
    refreshUniformMarks();
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
      state[colId].overrides.set(dn, value);
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
        if (String(valueFor(c.id, d.name)) === "true") cnt++;
      });
      if (cnt === 1) color = "#e6ffe6";
    }
    cell.style.background = color;
  });
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
      });
    }

// Save & Back: schreibt XML und geht zurück
var back = $("#btnSaveBack");
if (back){
  back.addEventListener("click", function(){
    try {
      var doc = parseXml(xml);
      writeValuesToPreset(doc);
      var out = new XMLSerializer().serializeToString(doc);
      try { sessionStorage.setItem(SKEY_XML, out); } catch(_){}
    } catch(e) {
      alert("Fehler beim Schreiben: " + (e.message||e));
    }
    location.href = "./Index.html#via=settings-matrix";
  });
}

// Werte ins PRESET XML schreiben
function writeValuesToPreset(doc){
  var devMap = {};
  var devEls = Array.prototype.slice.call(doc.querySelectorAll("preset > device"));
  if (devEls.length === 0) devEls = Array.prototype.slice.call(doc.querySelectorAll("device"));
  devEls.forEach(function(de){
    var nEl = de.querySelector("name");
    var name = nEl && nEl.textContent ? nEl.textContent.trim() : "";
    if (name) devMap[name] = de;
  });

  function resolved(colId, devName){
    var c = state[colId];
    return (c && c.overrides.has(devName)) ? c.overrides.get(devName) : (c ? c.default : null);
  }
  function ensureEl(parent, tag, attrs){
    var el = parent.querySelector(tag);
    if (!el){ el = parent.ownerDocument.createElement(tag); parent.appendChild(el); }
    if (attrs){ Object.keys(attrs).forEach(function(k){ el.setAttribute(k, attrs[k]); }); }
    return el;
  }
  function ensureInterface(de, idx){
    var sel = 'interface[network="'+idx+'"]';
    var it = de.querySelector(sel);
    if (!it){
      it = de.ownerDocument.createElement("interface");
      it.setAttribute("network", String(idx));
      de.appendChild(it);
    }
    return it;
  }

  devices.forEach(function(d){
    var de = devMap[d.name]; if (!de) return;

    var sr = resolved("samplerate", d.name);
    if (sr != null){ var el = ensureEl(de, "samplerate"); el.textContent = String(sr|0); }

    var lat = resolved("unicast_latency_ms", d.name);
    if (lat != null){ var ul = ensureEl(de, "unicast_latency"); ul.textContent = String(Math.round(Number(lat)*1000)); }

    var pm = resolved("preferred_master", d.name);
    if (pm != null){ ensureEl(de, "preferred_master", {value:String(pm)}); }

    var ew = resolved("external_word_clock", d.name);
    if (ew != null){ ensureEl(de, "external_word_clock", {value:String(ew)}); }

    var rEl = de.querySelector("redundancy");
    if (rEl){
    var rv = resolved("redundancy", d.name);
    if (rv != null) rEl.setAttribute("value", String(rv));
    }
    var encEl = de.querySelector("encoding");
    if (encEl){
    var ev = resolved("encoding_bits", d.name);
    if (ev != null) encEl.textContent = String(ev|0);
    }
    var vlanEl = de.querySelector("switch_vlan");
    if (vlanEl){
    var vv = resolved("switch_vlan", d.name);
    if (vv != null) vlanEl.setAttribute("value", String(Math.max(1, Math.min(4094, parseInt(vv,10)||0))));
    }

    var mode0 = resolved("ip0_mode", d.name) || "dynamic";
    var if0 = ensureInterface(de, 0);
    ensureEl(if0, "ipv4_address", {mode:String(mode0)});
    if (mode0 === "static"){
      ensureEl(if0, "address").textContent   = String(resolved("ip0_addr", d.name) || "");
      ensureEl(if0, "netmask").textContent   = String(resolved("ip0_mask", d.name) || "");
      ensureEl(if0, "gateway").textContent   = String(resolved("ip0_gw", d.name)   || "");
      ensureEl(if0, "dnsserver").textContent = String(resolved("ip0_dns", d.name)  || "");
    }

    if (hasInterface({el:de},1) || state["ip1_mode"]){
      var mode1 = resolved("ip1_mode", d.name);
      if (mode1 != null){
        var if1 = ensureInterface(de, 1);
        ensureEl(if1, "ipv4_address", {mode:String(mode1||"dynamic")});
        if (mode1 === "static"){
          ensureEl(if1, "address").textContent   = String(resolved("ip1_addr", d.name) || "");
          ensureEl(if1, "netmask").textContent   = String(resolved("ip1_mask", d.name) || "");
          ensureEl(if1, "gateway").textContent   = String(resolved("ip1_gw", d.name)   || "");
          ensureEl(if1, "dnsserver").textContent = String(resolved("ip1_dns", d.name)  || "");
        }
      }
    }
  });
}
  }

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

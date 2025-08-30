// ---- Config ----
var HELPER = { base: "http://localhost:53535", health: "/health", scan: "/scan" };

// ---- State ----
var lastXmlDoc = null;
var helperState = "disconnected";   // "connected" | "connecting" | "disconnected"
var lastHelperState = null;
var backoff = 1000, maxBackoff = 30000, timer = null;

// Spinner-Handling (robust, auch bei parallelen Checks)
var activeChecks = 0;
function beginCheck(){ activeChecks++; setSpinner(true); }
function endCheck(){ activeChecks = Math.max(0, activeChecks - 1); if(activeChecks === 0) setSpinner(false); }

// ---- DOM helpers ----
function $(sel){ return document.querySelector(sel); }
function rowHtml(cols){ return "<tr>" + cols.map(function(c){ return "<td>"+c+"</td>"; }).join("") + "</tr>"; }

// ---- Statusbar helpers ----
function setLed(state){
  var led = $("#statusLed"); if(!led) return;
  led.classList.remove("green","yellow","red");
  if(state === "connected") led.classList.add("green");
  else if(state === "connecting") led.classList.add("yellow");
  else led.classList.add("red");
}
function setStatusText(txt){ var t = $("#statusText"); if(t) t.textContent = txt; }
function setSpinner(active){ var sp = $("#statusSpinner"); if(sp){ if(active) sp.classList.add("active"); else sp.classList.remove("active"); } }
function setTimestamp(ts){ var el = $("#statusTimestamp"); if(el){ el.textContent = ts ? ("Stand: " + new Date(ts).toLocaleTimeString()) : ""; } }

function setState(newState, options){
  options = options || { announceWhenDone:true };
  if(newState !== lastHelperState){
    if(options.announceWhenDone){
      setLed(newState);
      if(newState === "connected") setStatusText("Online-Scan aktiv");
      else if(newState === "connecting") setStatusText("Verbinde…");
      else setStatusText("Offline");
      lastHelperState = newState;
    }
  }
  helperState = newState;
}

// ---- XML helpers ----
function parseXml(text){
  var p = new DOMParser();
  var xml = p.parseFromString(text, "application/xml");
  var err = xml.querySelector("parsererror");
  if(err) throw new Error("XML Parser Error: " + err.textContent);
  return xml;
}
function serializeWithHeader(xml){
  var s = new XMLSerializer().serializeToString(xml).replace(/^<\?xml[^>]*\?>\s*/i,"");
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + s;
}

// ---- Tables ----
function fillPresetTable(xml){
  var tbody = $("#presetTable tbody"); if(!tbody) return;
  tbody.innerHTML = "";

  var devices = Array.prototype.slice.call(xml.querySelectorAll("preset > device"));
  if(devices.length === 0) devices = Array.prototype.slice.call(xml.querySelectorAll("device"));

  devices.forEach(function(d){
    var nameEl = d.querySelector("name");
    var name = nameEl && nameEl.textContent ? nameEl.textContent.trim() : "(ohne Name)";
    var tx = d.querySelectorAll("txchannel").length;
    var rx = d.querySelectorAll("rxchannel").length;
    tbody.insertAdjacentHTML("beforeend", rowHtml([name, tx, rx]));
  });

  var btn = $("#btnExport");
  if(btn) btn.disabled = devices.length === 0;
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

function fillLibTable(){
  var tbody = $("#libTable tbody"); if(!tbody) return;
  tbody.innerHTML="";
  var lib = [
    { model:"Generic-32x16", tx:32, rx:16 },
    { model:"Generic-16x16", tx:16, rx:16 }
  ];
  lib.forEach(function(m){ tbody.insertAdjacentHTML("beforeend", rowHtml([m.model, m.tx, m.rx])); });
}

// ---- File handlers ----
var fi = document.getElementById("fileInput");
if (fi) {
  fi.addEventListener("change", function (e) {
    try {
      var f = e.target && e.target.files ? e.target.files[0] : null;
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function (ev) {
        try {
          var t = String(ev.target.result || "");
          var doc = new DOMParser().parseFromString(t, "application/xml");
          var err = doc.querySelector("parsererror");
          if (err) throw new Error("XML Parser Error: " + err.textContent);
          // intern halten
          lastXmlDoc = doc;
          fillPresetTable(lastXmlDoc);
          // **WICHTIG**: sauber serialisieren und im localStorage ablegen (Matrix liest von dort)
          var serialized = new XMLSerializer().serializeToString(lastXmlDoc);
          localStorage.setItem("DA_PRESET_XML", serialized);
          // Matrix-Button aktivieren
          var bm = document.getElementById("btnMatrix");
          if (bm) { bm.disabled = false; }
        } catch (err) { alert(err.message || String(err)); }
      };
      reader.readAsText(f);
    } catch (err) { alert(err.message || String(err)); }
  });
}

var be = $("#btnExport");
if(be){
  be.addEventListener("click", function(){
    if(!lastXmlDoc){ alert("Bitte zuerst ein Preset laden."); return; }
    var content = serializeWithHeader(lastXmlDoc);
    var blob = new Blob([content], {type:"application/xml"});
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "ArchitectExport.xml";
    document.body.appendChild(a);
    a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 0);
  });
}

// ---- Helper discovery (optional, resilient) ----
function ping(timeout){
  if(typeof timeout!=="number") timeout=600;
  beginCheck();
  var ctrl = new AbortController();
  var to = setTimeout(function(){ try{ ctrl.abort(); }catch(e){} }, timeout);
  return fetch(HELPER.base+HELPER.health, {signal: ctrl.signal, cache:"no-store"})
    .then(function(r){ return r.ok ? r.json() : {ok:false}; })
    .then(function(j){ return j && j.ok === true; })
    .catch(function(){ return false; })
    .finally(function(){ clearTimeout(to); endCheck(); });
}

function scan(timeout){
  if(typeof timeout!=="number") timeout=1200;
  beginCheck();
  var ctrl = new AbortController();
  var to = setTimeout(function(){ try{ ctrl.abort(); }catch(e){} }, timeout);
  return fetch(HELPER.base+HELPER.scan, {signal: ctrl.signal, cache:"no-store"})
    .then(function(r){ if(!r.ok) return null; return r.json(); })
    .then(function(j){ if(j) { fillOnlineTable(j); setTimestamp(Date.now()); } })
    .catch(function(){ /* noop */ })
    .finally(function(){ clearTimeout(to); endCheck(); });
}

function scheduleRetry(){
  clearTimeout(timer);
  var jitter = Math.floor(Math.random()*0.25*backoff);
  var wait = Math.min(backoff+jitter, maxBackoff);
  timer = setTimeout(connect, wait);
  backoff = Math.min(backoff*2, maxBackoff);
}

function connect(){
  setState("connecting", {announceWhenDone:false});
  ping(600).then(function(ok){
    if(ok){
      setState("connected");
      backoff = 1000;
      return scan(1200).then(function(){
        clearTimeout(timer);
        timer = setTimeout(loop, 4000);
      });
    }else{
      setState("disconnected");
      scheduleRetry();
    }
  });
}

function loop(){
  if(helperState!=="connected") return;
  ping(600).then(function(ok){
    if(!ok){ setState("disconnected"); return scheduleRetry(); }
    scan(1000).then(function(){
      clearTimeout(timer);
      timer = setTimeout(loop, 4000);
    });
  });
}

// Re-Checks bei Sichtbarkeitswechsel/Fokus/Netzwechsel
window.addEventListener("focus", function(){ if(helperState==="connected") scan(800); else connect(); }, {passive:true});
document.addEventListener("visibilitychange", function(){
  if(document.visibilityState==="visible"){
    if(helperState==="connected") scan(800); else connect();
  }
}, {passive:true});
window.addEventListener("online", function(){ connect(); }, {passive:true});

// ---- Init ----
try { fillLibTable(); } catch(e) {}
try { connect(); } catch(e) {}
// Matrix-Button initial aktivieren, wenn schon ein Preset im Speicher liegt
(function () {
  var bm = document.getElementById("btnMatrix");
  if (!bm) return;

  function getSerializedXml() {
    try {
      // 1) bevorzugt: frisch aus lastXmlDoc
      if (typeof lastXmlDoc !== "undefined" && lastXmlDoc) {
        return new XMLSerializer().serializeToString(lastXmlDoc);
      }
      // 2) fallback: aus localStorage (falls vorhanden)
      var s = localStorage.getItem("DA_PRESET_XML");
      return s || "";
    } catch (_) { return ""; }
  }

  // Button ist aktiv, wenn irgendeine Quelle da ist
  bm.disabled = !getSerializedXml();

  bm.onclick = function () {
    var xml = getSerializedXml();
    if (!xml) { alert("Kein Preset geladen."); return; }

    // WICHTIG: XML tab-weit mitgeben
    // window.name ist pro Tab persistent (auch über Navigations hinweg)
    window.name = JSON.stringify({ type: "DA_PRESET", xml: xml });

    // optional zusätzlich in localStorage schreiben (falls erlaubt)
    try { localStorage.setItem("DA_PRESET_XML", xml); } catch (_) {}

    // navigieren
    location.href = "./Matrix.html#via=windowname";
  };
})();
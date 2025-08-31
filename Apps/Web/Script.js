// Apps/Web/Script.js

// ---- Config & Keys ----
var HELPER = { base: "http://localhost:53535", health: "/health", scan: "/scan" };
var SKEY_XML  = "DA_PRESET_XML";
var SKEY_META = "DA_PRESET_META";

function $(s){ return document.querySelector(s); }
function rowHtml(cols){ return "<tr>" + cols.map(function(c){ return "<td>"+c+"</td>"; }).join("") + "</tr>"; }
function parseXml(text){
  var p = new DOMParser(); var xml = p.parseFromString(text, "application/xml");
  var err = xml.querySelector("parsererror"); if(err) throw new Error("XML Parser Error: " + err.textContent);
  return xml;
}
function serializeWithHeader(xml){
  var s = new XMLSerializer().serializeToString(xml).replace(/^<\?xml[^>]*\?>\s*/i,"");
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + s;
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

  var devs = Array.prototype.slice.call(xml.querySelectorAll("preset > device"));
  if(devs.length === 0) devs = Array.prototype.slice.call(xml.querySelectorAll("device"));

  devs.forEach(function(d){
    var nameEl = d.querySelector("name");
    var name = nameEl && nameEl.textContent ? nameEl.textContent.trim() : "(ohne Name)";
    var tx = d.querySelectorAll("txchannel").length;
    var rx = d.querySelectorAll("rxchannel").length;
    tbody.insertAdjacentHTML("beforeend", rowHtml([name, tx, rx]));
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
(function bindExport(){
  var be = $("#btnExport"); if(!be) return;
  be.addEventListener("click", function(){
    if(!lastXmlDoc){
      var s = readFromSession(); if(s){ try{ lastXmlDoc = parseXml(s); }catch(_){} }
    }
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
  var cont = $("#libSidebarBody"); if(!cont) return;
  window.DA_LIB.renderSidebarInto(cont);
};
try { window.renderLibrarySidebar(); } catch(_){}

(function robustBindLibWizard(){
  function openWizardFromCurrentPreset(){
    var xmlDoc = window.lastXmlDoc;
    if (!xmlDoc) {
      try { var s = readFromSession(); if(s) xmlDoc = new DOMParser().parseFromString(s, "application/xml"); } catch(_) {}
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
  var ok1 = bindOnce("btnLibWizard");
  var ok2 = bindOnce("btnLibWizardSidebar");
  if (!ok1 || !ok2) {
    document.addEventListener("DOMContentLoaded", function(){ bindOnce("btnLibWizard"); bindOnce("btnLibWizardSidebar"); }, {once:true});
    var tries=0, t=setInterval(function(){
      tries++; var a=bindOnce("btnLibWizard"), b=bindOnce("btnLibWizardSidebar");
      if((a||b) && window.DA_LIB){ clearInterval(t); }
      if(tries>10) clearInterval(t);
    },150);
  }
})();

// ---- Safe Autoload nach Rücksprung (#via=matrix) ----
(function safeAutoloadAfterBack(){
  try{
    var via = (location.hash||"").indexOf("via=matrix") >= 0;
    if(!via) return;
    var s = readFromSession();
    if(!s) return;
    var doc = parseXml(s);
    lastXmlDoc = doc;
    fillPresetTable(lastXmlDoc);
    var be = $("#btnExport"); if(be) be.disabled = false;
    var bm = $("#btnMatrix"); if(bm) bm.disabled = false;
  }catch(e){
    console.warn("safeAutoloadAfterBack:", e);
  }
})();
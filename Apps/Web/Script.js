// ---- Config ----
const HELPER = { base: "http://localhost:53535", health: "/health", scan: "/scan" };

// ---- State ----
let lastXmlDoc = null;
let helperState = "disconnected";
let backoff = 1000, maxBackoff = 30000, timer = null;

// ---- DOM helpers ----
function $(sel){ return document.querySelector(sel); }
function rowHtml(cols){ return "<tr>" + cols.map(c=>`<td>${c}</td>`).join("") + "</tr>"; }

function setStatus(state){
  helperState = state;
  const el = $("#helperStatus");
  if(!el) return;
  if(state==="connected"){ el.textContent="Online-Scan aktiv"; }
  else if(state==="connecting"){ el.textContent="Verbinde…"; }
  else { el.textContent="Offline"; const oi=$("#onlineInfo"); if(oi) oi.textContent="Helper nicht verbunden – arbeite offline"; }
}

// ---- XML helpers ----
function parseXml(text){
  const p = new DOMParser();
  const xml = p.parseFromString(text, "application/xml");
  const err = xml.querySelector("parsererror");
  if(err) throw new Error("XML Parser Error: " + err.textContent);
  return xml;
}
function serializeWithHeader(xml){
  const s = new XMLSerializer().serializeToString(xml).replace(/^<\?xml[^>]*\?>\s*/i,"");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` + s;
}

// ---- Tables ----
function fillPresetTable(xml){
  const tbody = $("#presetTable tbody");
  if(!tbody) return;
  tbody.innerHTML = "";

  // robust: finde Geräte überall unterhalb von <preset>
  let devices = Array.from(xml.querySelectorAll("preset > device"));
  if(devices.length === 0) {
    // Fallback: falls Struktur leicht abweicht (ältere Exporte)
    devices = Array.from(xml.querySelectorAll("device"));
  }
  devices.forEach(d=>{
    const name = d.querySelector("name")?.textContent?.trim() || "(ohne Name)";
    const tx = d.querySelectorAll("txchannel").length;
    const rx = d.querySelectorAll("rxchannel").length;
    tbody.insertAdjacentHTML("beforeend", rowHtml([name, tx, rx]));
  });

  // Export-Button aktivieren, wenn mindestens 1 Gerät vorhanden ist
  const btn = $("#btnExport");
  if(btn) btn.disabled = devices.length === 0;
}

function fillOnlineTable(list){
  const tbody = $("#onlineTable tbody");
  if(!tbody) return;
  tbody.innerHTML="";
  list.forEach(dev=>{
    tbody.insertAdjacentHTML("beforeend", rowHtml([dev.name||"", dev.ip||"", dev.manufacturer||""]));
  });
  const oi=$("#onlineInfo");
  if(oi) oi.textContent = "Stand: " + new Date().toLocaleTimeString();
}

function fillLibTable(){
  const tbody = $("#libTable tbody");
  if(!tbody) return;
  tbody.innerHTML="";
  // Platzhalter – später aus Bibliothek.json
  const lib = [
    { model:"Generic-32x16", tx:32, rx:16 },
    { model:"Generic-16x16", tx:16, rx:16 }
  ];
  lib.forEach(m=> tbody.insertAdjacentHTML("beforeend", rowHtml([m.model, m.tx, m.rx])));
}

// ---- File handlers ----
$("#fileInput")?.addEventListener("change", async (e)=>{
  try{
    const f = e.target.files?.[0];
    if(!f) return;
    const t = await f.text();
    lastXmlDoc = parseXml(t);
    fillPresetTable(lastXmlDoc);
  }catch(err){
    alert(err.message || String(err));
  }
});

$("#btnExport")?.addEventListener("click", ()=>{
  if(!lastXmlDoc) { alert("Bitte zuerst ein Preset laden."); return; }
  const content = serializeWithHeader(lastXmlDoc);
  const blob = new Blob([content], {type:"application/xml"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "ArchitectExport.xml";
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 0);
});

// ---- Helper discovery (optional, resilient) ----
async function ping(timeout=600){
  const ctrl = new AbortController(); const to = setTimeout(()=>ctrl.abort(), timeout);
  try{
    const r = await fetch(HELPER.base+HELPER.health, {signal: ctrl.signal, cache:"no-store"});
    clearTimeout(to);
    if(!r.ok) return false;
    const j = await r.json();
    return j?.ok===true;
  }catch(e){ clearTimeout(to); return false; }
}
async function scan(timeout=1200){
  const ctrl = new AbortController(); const to = setTimeout(()=>ctrl.abort(), timeout);
  try{
    const r = await fetch(HELPER.base+HELPER.scan, {signal: ctrl.signal, cache:"no-store"});
    clearTimeout(to);
    if(!r.ok) return;
    const j = await r.json();
    fillOnlineTable(j);
  }catch(e){ clearTimeout(to); }
}
function scheduleRetry(){
  clearTimeout(timer);
  const jitter = Math.floor(Math.random()*0.25*backoff);
  const wait = Math.min(backoff+jitter, maxBackoff);
  timer = setTimeout(connect, wait);
  backoff = Math.min(backoff*2, maxBackoff);
}
async function connect(){
  setStatus("connecting");
  const ok = await ping(600);
  if(ok){
    setStatus("connected"); backoff = 1000;
    await scan(1200);
    clearTimeout(timer);
    timer = setTimeout(loop, 4000);
  }else{
    setStatus("disconnected");
    scheduleRetry();
  }
}
async function loop(){
  if(helperState!=="connected") return;
  const ok = await ping(600);
  if(!ok){ setStatus("disconnected"); return scheduleRetry(); }
  await scan(1000);
  clearTimeout(timer);
  timer = setTimeout(loop, 4000);
}

window.addEventListener("focus", ()=> helperState==="connected" ? scan(800) : connect(), {passive:true});
document.addEventListener("visibilitychange", ()=> document.visibilityState==="visible" ? (helperState==="connected" ? scan(800) : connect()) : null, {passive:true});
window.addEventListener("online", ()=> connect(), {passive:true});

// ---- Init ----
fillLibTable();
connect();
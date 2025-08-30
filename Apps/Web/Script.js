// ---- Config ----
const HELPER = { base: "http://localhost:53535", health: "/health", scan: "/scan" };

// ---- State ----
let lastXmlDoc = null;
let helperState = "disconnected";   // "connected" | "connecting" | "disconnected"
let lastHelperState = null;         // um nur bei echtem Wechsel die LED zu ändern
let backoff = 1000, maxBackoff = 30000, timer = null;
let isChecking = false;

// ---- DOM helpers ----
function $(sel){ return document.querySelector(sel); }
function rowHtml(cols){ return "<tr>" + cols.map(c=>`<td>${c}</td>`).join("") + "</tr>"; }

// ---- Statusbar helpers ----
function setLed(state){
  const led = $("#statusLed");
  led.classList.remove("green","yellow","red");
  if(state === "connected") led.classList.add("green");
  else if(state === "connecting") led.classList.add("yellow");
  else led.classList.add("red");
}
function setStatusText(txt){
  const t = $("#statusText"); if(t) t.textContent = txt;
}
function setSpinner(active){
  const sp = $("#statusSpinner");
  if(!sp) return;
  if(active) sp.classList.add("active"); else sp.classList.remove("active");
}
function setTimestamp(ts){
  const el = $("#statusTimestamp");
  if(!el) return;
  el.textContent = ts ? ("Stand: " + new Date(ts).toLocaleTimeString()) : "";
}

function setState(newState, options={ announceWhenDone:true }){
  // LED/Status nur ändern, wenn sich der Zustand wirklich geändert hat
  if(newState !== lastHelperState){
    if(options.announceWhenDone){
      // Wechsel erst NACH abgeschlossener Prüfung anzeigen (soll heißen: hier sind wir bereits sicher)
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

  let devices = Array.from(xml.querySelectorAll("preset > device"));
  if(devices.length === 0) devices = Array.from(xml.querySelectorAll("device"));

  devices.forEach(d=>{
    const name = d.querySelector("name")?.textContent?.trim() || "(ohne Name)";
    const tx = d.querySelectorAll("txchannel").length;
    const rx = d.querySelectorAll("rxchannel").length;
    tbody.insertAdjacentHTML("beforeend", rowHtml([name, tx, rx]));
  });

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
  if(oi) oi.textContent = list?.length ? "Gefundene Geräte" : "Keine Geräte gefunden";
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
    setSpinner(true); isChecking = true;
    const r = await fetch(HELPER.base+HELPER.health, {signal: ctrl.signal, cache:"no-store"});
    clearTimeout(to);
    return r.ok && (await r.json())?.ok === true;
  }catch(e){
    clearTimeout(to);
    return false;
  } finally {
    // Spinner bleibt aktiv, bis wir ggf. noch scan() gemacht haben
  }
}
async function scan(timeout=1200){
  const ctrl = new AbortController(); const to = setTimeout(()=>ctrl.abort(), timeout);
  try{
    const r = await fetch(HELPER.base+HELPER.scan, {signal: ctrl.signal, cache:"no-store"});
    clearTimeout(to);
    if(!r.ok) return;
    const j = await r.json();
    fillOnlineTable(j);
    setTimestamp(Date.now());
  }catch(e){
    clearTimeout(to);
  } finally {
    setSpinner(false); isChecking = false;
  }
}
function scheduleRetry(){
  clearTimeout(timer);
  const jitter = Math.floor(Math.random()*0.25*backoff);
  const wait = Math.min(backoff+jitter, maxBackoff);
  timer = setTimeout(connect, wait);
  backoff = Math.min(backoff*2, maxBackoff);
}
async function connect(){
  // wir zeigen erst gelb, updaten LED aber wirklich nur beim bestätigten Wechsel
  setState("connecting", {announceWhenDone:false});
  const ok = await ping(600);
  if(ok){
    setState("connected"); backoff = 1000;
    await scan(1200);
    clearTimeout(timer);
    timer = setTimeout(loop, 4000);
  }else{
    setState("disconnected");
    scheduleRetry();
  }
}
async function loop(){
  if(helperState!=="connected") return;
  const ok = await ping(600);
  if(!ok){ setState("disconnected"); return scheduleRetry(); }
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
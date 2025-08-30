// ---- Config ----
const HELPER = { base: "http://localhost:53535", health: "/health", scan: "/scan" };

// ---- State ----
let lastXmlDoc = null;
let helperState = "disconnected";   // "connected" | "connecting" | "disconnected"
let lastHelperState = null;
let backoff = 1000, maxBackoff = 30000, timer = null;

// Spinner-Handling (robust, auch bei parallelen Checks)
let activeChecks = 0;
function beginCheck(){ activeChecks++; setSpinner(true); }
function endCheck(){ activeChecks = Math.max(0, activeChecks - 1); if(activeChecks === 0) setSpinner(false); }

// ---- DOM helpers ----
function $(sel){ return document.querySelector(sel); }
function rowHtml(cols){ return "<tr>" + cols.map(c=>`<td>${c}</td>`).join("") + "</tr>"; }

// ---- Statusbar helpers ----
function setLed(state){
  const led = $("#statusLed");
  if(!led) return;
  led.classList.remove("green","yellow","red");
  if(state === "connected") led.classList.add("green");
  else if(state === "connecting") led.classList.add("yellow");
  else led.classList.add("red");
}
function setStatusText(txt){ const t = $("#statusText"); if(t) t.textContent = txt; }
function setSpinner(active){ const sp = $("#statusSpinner"); if(sp){ sp.classList.toggle("active", !!active); } }
function setTimestamp(ts){ const el = $("#statusTimestamp"); if(el){ el.textContent = ts ? ("Stand: " + new Date(ts).toLocaleTimeString()) : ""; } }

function setState(newState, options={ announceWhenDone:true }){
  // LED/Status nur bei tatsächlichem Wechsel ändern
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
  const tbody = $("#presetTable tbody"); if(!tbody) return;
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
  const tbody = $("#onlineTable tbody"); if(!tbody) return;
  tbody.innerHTML="";
  list.forEach(dev=>{
    tbody.insertAdjacentHTML("beforeend", rowHtml([dev.name||"", dev.ip||"", dev.manufacturer||""]));
  });
  const oi=$("#onlineInfo"); if(oi) oi.textContent = list?.length ? "Gefundene Geräte"
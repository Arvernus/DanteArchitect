// Apps/Web/Lib.js
// Model-Library: JSON Storage, Wizard (Adopt), Edit/Delete-Modal, Sidebar-Render
// Jetzt mit XSD-basiertem Vendor/Model-Parsing (harte XSD-Tags zuerst, dann weiche Fallbacks)

window.DA_LIB = (function(){
  var LKEY = "DA_MODEL_LIBRARY_V1";

  // -------- Storage --------
  function load(){
    try {
      var raw = localStorage.getItem(LKEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch(_){ return []; }
  }
  function save(list){
    try { localStorage.setItem(LKEY, JSON.stringify(list || [])); } catch(_){}
  }
  function exportJson(){
    return JSON.stringify({ version:1, models: load() }, null, 2);
  }
  function importJson(jsonText){
    var parsed = JSON.parse(jsonText);
    if (parsed && Array.isArray(parsed.models)) { save(parsed.models); return parsed.models.length; }
    if (Array.isArray(parsed)) { save(parsed); return parsed.length; }
    throw new Error("Ungültiges JSON-Format für Model Library.");
  }

  // -------- XML helpers (namespace-robust) --------
  // find first descendant element whose localName matches one of names[]
  function findByLocalNames(root, names){
    if (!root) return null;
    var all = root.getElementsByTagName("*");
    for (var i=0; i<all.length; i++){
      var ln = all[i].localName || all[i].nodeName; // nodeName for older engines
      if (!ln) continue;
      for (var j=0; j<names.length; j++){
        if (ln === names[j]) return all[i];
      }
    }
    return null;
  }
  function readFirstTextByLocalNames(root, names){
    var el = findByLocalNames(root, names);
    return (el && el.textContent) ? el.textContent.trim() : "";
  }

  // -------- XSD-gesteuerte Tags --------
  // Harte XSD-Zuweisungen (unser Preset-Schema):
  var XSD_VENDOR = ["manufacturer"];
  var XSD_MODEL  = ["model_name"];
  var XSD_NAME   = ["name"];        // Gerätename

  // Weiche Fallbacks (für alte/abweichende Presets):
  var FB_VENDOR = ["vendor","brand","maker","manufacturer_name","manufacturerName","vendor_name","vendorName","company","make"];
  var FB_MODEL  = ["model","product_name","productName","product"];

  // -------- Fingerprint aus <device> --------
  function fingerprintDevice(deviceEl){
    // Name (aus XSD)
    var devName = readFirstTextByLocalNames(deviceEl, XSD_NAME);

    // Vendor: zuerst XSD, dann weich
    var vendor = readFirstTextByLocalNames(deviceEl, XSD_VENDOR);
    if (!vendor) vendor = readFirstTextByLocalNames(deviceEl, FB_VENDOR);

    // Model: zuerst XSD, dann weich
    var model  = readFirstTextByLocalNames(deviceEl, XSD_MODEL);
    if (!model) model = readFirstTextByLocalNames(deviceEl, FB_MODEL);

    // Kanäle + Labels
    // (wir matchen auf localName, um prefix-agnostisch zu bleiben)
    function qAllLocal(root, local){
      var out = [];
      var all = root.getElementsByTagName("*");
      for (var i=0;i<all.length;i++){
        if ((all[i].localName || all[i].nodeName) === local) out.push(all[i]);
      }
      return out;
    }
    var tx = qAllLocal(deviceEl, "txchannel");
    var rx = qAllLocal(deviceEl, "rxchannel");

    function lbl(list, childLocal){
      var arr = [];
      for (var i=0;i<Math.min(list.length,16);i++){
        var ch = findByLocalNames(list[i], [childLocal]);
        arr.push(ch && ch.textContent ? ch.textContent.trim() : "");
      }
      return arr;
    }

    return {
      txCount: tx.length,
      rxCount: rx.length,
      txLabels: lbl(tx, "label"),   // XSD: txchannel/label
      rxLabels: lbl(rx, "name"),    // XSD: rxchannel/name
      devNameHint: devName,
      vendorHint: vendor,
      modelHint: model
    };
  }

  function matchesModel(fp, m){
    if (!m) return false;
    // Primär: Kanal-Anzahlen (so bleiben wir unempfindlich gegenüber Freitext)
    return fp.txCount === m.txCount && fp.rxCount === m.rxCount;
  }
  function findMatchingModelId(fp){
    var list = load();
    for (var i=0;i<list.length;i++){
      if (matchesModel(fp, list[i])) return list[i].id;
    }
    return null;
  }

  function addModelFromFingerprint(modelName, vendor, fp, notes){
    var list = load();
    var id = "mdl_" + Math.random().toString(36).slice(2,10) + Date.now().toString(36);
    var model = {
      id,
      modelName: String(modelName||"").trim() || ("Model-"+fp.txCount+"x"+fp.rxCount),
      vendor: vendor ? String(vendor).trim() : "",
      txCount: fp.txCount, rxCount: fp.rxCount,
      txLabels: fp.txLabels || [],
      rxLabels: fp.rxLabels || [],
      notes: notes || "",
      createdAt: Date.now()
    };
    list.push(model);
    save(list);
    return model;
  }

  // -------- Adopt Wizard --------
  function openAdoptWizard(xmlDoc){
    var modal = document.getElementById("libWizardModal");
    if (!modal){ alert("Modal-Container #libWizardModal fehlt."); return; }
    modal.style.display = "flex";

    var closeBtn = modal.querySelector("[data-role='libwiz-close']");
    if (closeBtn) closeBtn.onclick = function(){ modal.style.display = "none"; };
    modal.addEventListener("click", function(ev){ if (ev.target === modal) modal.style.display = "none"; });

    // Devices einsammeln
    // (XSD: <preset><device>… oder direkt <device>…)
    function qAllDevices(doc){
      var out = [];
      var p = findByLocalNames(doc, ["preset"]);
      if (p){
        var all = p.getElementsByTagName("*");
        for (var i=0;i<all.length;i++){
          if ((all[i].localName || all[i].nodeName) === "device") out.push(all[i]);
        }
      }
      if (out.length === 0){
        var all2 = doc.getElementsByTagName("*");
        for (var j=0;j<all2.length;j++){
          if ((all2[j].localName || all2[j].nodeName) === "device") out.push(all2[j]);
        }
      }
      return out;
    }
    var devices = qAllDevices(xmlDoc);

    var rows = devices.map(function(de, idx){
      var fp = fingerprintDevice(de);
      var matchId = findMatchingModelId(fp);

      var devName = fp.devNameHint || ("Device-"+(idx+1));
      var vendor  = fp.vendorHint || "";
      var mName   = fp.modelHint || (devName.split(/\s|-/)[0] || ("Model-"+fp.txCount+"x"+fp.rxCount));

      return { fp, devName, modelId: matchId, modelNameDefault: mName, vendor: vendor };
    });

    var filterInput = document.getElementById("libwizFilter");
    var onlyUnknown = document.getElementById("libwizUnknown");
    var tbody = document.getElementById("libwizTbody");
    var countSpan = document.getElementById("libwizCount");

    function render(){
      var txt = (filterInput.value||"").toLowerCase();
      var unk = !!onlyUnknown.checked;
      tbody.innerHTML = ""; var shown = 0;

      rows.forEach(function(row){
        var isUnknown = !row.modelId;
        if (unk && !isUnknown) return;

        var hay = [
          row.devName, row.modelNameDefault, row.vendor || "",
          (row.fp.txLabels||[]).join(" "),
          (row.fp.rxLabels||[]).join(" "),
          String(row.fp.txCount)+"x"+String(row.fp.rxCount)
        ].join(" ").toLowerCase();
        if (txt && hay.indexOf(txt) < 0) return;

        shown++;
        var tr = document.createElement("tr");

        var tdKnown=document.createElement("td"); tdKnown.style.textAlign="center"; tdKnown.textContent = isUnknown ? "—" : "✓";
        var tdDev  =document.createElement("td"); tdDev.textContent = row.devName;
        var tdCnt  =document.createElement("td"); tdCnt.textContent = row.fp.txCount + "×" + row.fp.rxCount;
        var tdLbl  =document.createElement("td");
        var txs=(row.fp.txLabels||[]).filter(Boolean).slice(0,6).join(", ");
        var rxs=(row.fp.rxLabels||[]).filter(Boolean).slice(0,6).join(", ");
        tdLbl.textContent = (txs||"(keine)") + " | " + (rxs||"(keine)");

        var tdVendor=document.createElement("td");
        var vin = document.createElement("input");
        vin.type="text"; vin.placeholder="Vendor (optional)";
        vin.value = row.vendor || "";
        vin.oninput = function(){ row.vendor = vin.value; };
        tdVendor.appendChild(vin);

        var tdName=document.createElement("td");
        var nin = document.createElement("input");
        nin.type="text"; nin.placeholder="Modelname";
        nin.value = row.modelNameDefault || "";
        nin.oninput = function(){ row.modelNameDefault = nin.value; };
        tdName.appendChild(nin);

        var tdAct=document.createElement("td");
        var btn = document.createElement("button");
        btn.className = "btn";
        btn.textContent = isUnknown ? "Übernehmen" : "Schon in Lib";
        btn.disabled = !isUnknown;
        btn.onclick = function(){
          var model = addModelFromFingerprint(row.modelNameDefault, row.vendor, row.fp, "");
          row.modelId = model.id;
          render();
          requestRenderSidebar();
        };
        tdAct.appendChild(btn);

        [tdKnown, tdDev, tdCnt, tdLbl, tdVendor, tdName, tdAct].forEach(function(td){ tr.appendChild(td); });
        tbody.appendChild(tr);
      });

      countSpan.textContent = String(shown);
    }

    filterInput.oninput = render;
    onlyUnknown.onchange = render;

    var expBtn = document.getElementById("libwizExport");
    var impBtn = document.getElementById("libwizImport");
    var impFile= document.getElementById("libwizImportFile");

    expBtn.onclick = function(){
      var content = exportJson();
      var blob = new Blob([content], {type:"application/json"});
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "DanteArchitect_ModelLibrary.json";
      document.body.appendChild(a);
      a.click();
      setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 0);
    };
    impBtn.onclick = function(){ impFile.value=""; impFile.click(); };
    impFile.onchange = function(e){
      var f = e.target.files && e.target.files[0]; if(!f) return;
      var reader = new FileReader();
      reader.onload = function(ev){
        try{
          var num = importJson(String(ev.target.result||""));
          alert("Import erfolgreich: "+num+" Modelle übernommen.");
          render();
          requestRenderSidebar();
        }catch(err){
          alert(err.message || String(err));
        }
      };
      reader.readAsText(f);
    };

    render();
  }

  // -------- Sidebar Render + Edit/Delete --------
  function renderSidebarInto(container){
    var list = load();
    container.innerHTML = "";
    if (!list.length){
      container.innerHTML = "<div class='muted'>Keine Modelle in der Bibliothek.</div>";
      return;
    }
    list.slice().sort(function(a,b){
      var ax=(a.vendor||"")+a.modelName, bx=(b.vendor||"")+b.modelName;
      return ax.localeCompare(bx);
    }).forEach(function(m){
      var row = document.createElement("div");
      row.className = "lib-item";
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.justifyContent = "space-between";
      row.style.gap = "8px";

      var text = document.createElement("div");
      var vh = m.vendor ? (m.vendor+" / ") : "";
      text.textContent = vh + m.modelName + " ("+m.txCount+"×"+m.rxCount+")";

      var actions = document.createElement("div");
      var btnEdit = document.createElement("button"); btnEdit.className="btn"; btnEdit.textContent="Bearbeiten";
      btnEdit.onclick = function(){ openEditModal(m.id); };
      actions.appendChild(btnEdit);

      row.appendChild(text);
      row.appendChild(actions);
      container.appendChild(row);
    });
  }

  var sidebarPending = false;
  function requestRenderSidebar(){
    if (sidebarPending) return;
    sidebarPending = true;
    requestAnimationFrame(function(){
      sidebarPending = false;
      var cont = document.getElementById("libSidebarBody");
      if (cont) renderSidebarInto(cont);
    });
  }

  // -------- Edit/Delete Modal --------
  function openEditModal(modelId){
    var list = load();
    var idx = list.findIndex(function(x){ return x.id === modelId; });
    if (idx < 0){ alert("Eintrag nicht gefunden."); return; }
    var m = list[idx];

    var modal = document.getElementById("libEditModal");
    if (!modal){ alert("Modal-Container #libEditModal fehlt."); return; }

    var fVendor = modal.querySelector("#libEditVendor");
    var fName   = modal.querySelector("#libEditName");
    var fTx     = modal.querySelector("#libEditTx");
    var fRx     = modal.querySelector("#libEditRx");
    var fTxLbl  = modal.querySelector("#libEditTxLabels");
    var fRxLbl  = modal.querySelector("#libEditRxLabels");
    var fNotes  = modal.querySelector("#libEditNotes");

    fVendor.value = m.vendor || "";
    fName.value   = m.modelName || "";
    fTx.value     = String(m.txCount || 0);
    fRx.value     = String(m.rxCount || 0);
    fTxLbl.value  = (m.txLabels||[]).join(", ");
    fRxLbl.value  = (m.rxLabels||[]).join(", ");
    fNotes.value  = m.notes || "";

    modal.style.display = "flex";

    var btnClose = modal.querySelector("[data-role='libedit-close']");
    if (btnClose) btnClose.onclick = function(){ modal.style.display="none"; };
    modal.addEventListener("click", function(ev){ if(ev.target === modal) modal.style.display="none"; });

    var btnSave = modal.querySelector("#libEditSave");
    btnSave.onclick = function(){
      var txN = Math.max(0, parseInt(fTx.value || "0", 10) || 0);
      var rxN = Math.max(0, parseInt(fRx.value || "0", 10) || 0);

      m.vendor = (fVendor.value||"").trim();
      m.modelName = (fName.value||"").trim() || ("Model-"+txN+"x"+rxN);
      m.txCount = txN;
      m.rxCount = rxN;
      m.txLabels = (fTxLbl.value||"").split(",").map(function(s){ return s.trim(); }).filter(function(s){ return s.length || s === ""; });
      m.rxLabels = (fRxLbl.value||"").split(",").map(function(s){ return s.trim(); }).filter(function(s){ return s.length || s === ""; });
      m.notes = (fNotes.value||"").trim();

      list[idx] = m;
      save(list);
      modal.style.display = "none";
      requestRenderSidebar();
    };

    var btnDel = modal.querySelector("#libEditDelete");
    btnDel.onclick = function(){
      if (!confirm("Eintrag wirklich löschen?")) return;
      list.splice(idx, 1);
      save(list);
      modal.style.display = "none";
      requestRenderSidebar();
    };
  }

  // -------- Public API --------
  return {
    openAdoptWizard,
    renderSidebarInto,
    openEditModal,
    _forceRenderSidebar: requestRenderSidebar
  };
})();
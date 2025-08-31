// Apps/Web/Lib.js
// Library-Engine für Modelle + Übernahme-Wizard
// JSON in localStorage, optional Export/Import, Wizard mit Filter & "Nur unbekannte"

// Namespace
window.DA_LIB = (function(){
  var LKEY = "DA_MODEL_LIBRARY_V1"; // Versionsbump hier, falls Format geändert wird

  // -------- Datenschema --------
  // Ein Modell-Objekt:
  // {
  //   id: "auto-uuid",
  //   modelName: "Generic-32x16",
  //   vendor: "Audinate" | "Allen&Heath" | "...",   // optional
  //   txCount: 32,
  //   rxCount: 16,
  //   txLabels: ["Ch1","Ch2", ...],                 // optional sample
  //   rxLabels: ["In1","In2", ...],                 // optional sample
  //   notes: "",                                    // optional
  //   createdAt: 1735678123456
  // }

  // -------- Storage --------
  function load(){
    try{
      var raw = localStorage.getItem(LKEY);
      if(!raw) return [];
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    }catch(_){ return []; }
  }
  function save(list){
    try{
      localStorage.setItem(LKEY, JSON.stringify(list || []));
    }catch(_){}
  }

  function exportJson(){
    var list = load();
    return JSON.stringify({ version:1, models:list }, null, 2);
  }
  function importJson(jsonText){
    var parsed = JSON.parse(jsonText);
    if(parsed && Array.isArray(parsed.models)){
      save(parsed.models);
      return parsed.models.length;
    } else if (Array.isArray(parsed)) {
      // ältere/nackte Arrays erlauben
      save(parsed);
      return parsed.length;
    } else {
      throw new Error("Ungültiges JSON-Format für Model Library.");
    }
  }

  // -------- Fingerprint aus Preset-Device --------
  // Ziel: robustes Matching für "unbekannte" vs. "bekannte" Modelle
  function fingerprintDevice(deviceEl){
    var nameEl = deviceEl.querySelector("name");
    var devName = nameEl && nameEl.textContent ? nameEl.textContent.trim() : "";

    var tx = Array.prototype.slice.call(deviceEl.querySelectorAll("txchannel"));
    var rx = Array.prototype.slice.call(deviceEl.querySelectorAll("rxchannel"));
    var txCount = tx.length, rxCount = rx.length;

    // optional Labels einsammeln (nur die ersten n, um JSON klein zu halten)
    function getLabels(list, sel){
      var arr = [];
      for(var i=0;i<Math.min(list.length, 16);i++){
        var el = list[i].querySelector(sel);
        if(el && el.textContent) arr.push(el.textContent.trim());
        else arr.push("");
      }
      return arr;
    }
    var txLabels = getLabels(tx, "label");
    var rxLabels = getLabels(rx, "name");

    // vendor nicht sicher aus XML, daher leer lassen (kann manuell ergänzt werden)
    return {
      txCount: txCount,
      rxCount: rxCount,
      txLabels: txLabels,
      rxLabels: rxLabels,
      devNameHint: devName
    };
  }

  // "Gleichheit" zweier Fingerprints vs. Model-Eintrag
  function matchesModel(fp, model){
    if(!model) return false;
    if(fp.txCount !== model.txCount) return false;
    if(fp.rxCount !== model.rxCount) return false;
    // Labels sind optional/informativ – nicht hart matchen, nur wenn vorhanden ein soften Check:
    // (vollständiges Label-Matching wäre zu streng; wir nutzen Counts als Primärschlüssel)
    return true;
  }

  function findMatchingModelId(fp){
    var list = load();
    for(var i=0;i<list.length;i++){
      if(matchesModel(fp, list[i])) return list[i].id;
    }
    return null;
  }

  function addModelFromFingerprint(modelName, vendor, fp, notes){
    var list = load();
    var id = "mdl_" + Math.random().toString(36).slice(2,10) + Date.now().toString(36);
    var model = {
      id: id,
      modelName: String(modelName||"").trim() || ("Model-"+fp.txCount+"x"+fp.rxCount),
      vendor: vendor ? String(vendor).trim() : "",
      txCount: fp.txCount,
      rxCount: fp.rxCount,
      txLabels: fp.txLabels || [],
      rxLabels: fp.rxLabels || [],
      notes: notes ? String(notes) : "",
      createdAt: Date.now()
    };
    list.push(model);
    save(list);
    return model;
  }

  // -------- Wizard UI --------
  // Öffnet Modal mit Geräten aus aktuellem Preset (xmlDoc),
  // bietet "Übernehmen in Library" an (mit Defaultname), Filter, "nur Unbekannte", Import/Export.
  function openAdoptWizard(xmlDoc){
    var modal = document.getElementById("libWizardModal");
    if(!modal){ alert("Modal-Container #libWizardModal fehlt in Index.html"); return; }

    // Modal sichtbar machen
    modal.style.display = "flex";

    var closeBtn = modal.querySelector("[data-role='libwiz-close']");
    if(closeBtn){
      closeBtn.onclick = function(){ modal.style.display = "none"; };
    }
    modal.addEventListener("click", function(ev){
      if(ev.target === modal){ modal.style.display = "none"; }
    });

    // Liste aus Preset
    var devices = Array.prototype.slice.call(xmlDoc.querySelectorAll("preset > device"));
    if(devices.length === 0) devices = Array.prototype.slice.call(xmlDoc.querySelectorAll("device"));

    // Daten vorbereiten: rows = { fp, modelId, modelNameDefault, devName }
    var rows = devices.map(function(de, idx){
      var fp = fingerprintDevice(de);
      var matchId = findMatchingModelId(fp);
      var devName = fp.devNameHint || ("Device-"+(idx+1));
      // Default-Modelname: Versuch aus devName Vorsilbe (bis erstes Leerzeichen oder '-'), fallback auf "tx x rx"
      var mn = (devName.split(/\s|-/)[0] || "").trim();
      if(!mn) mn = "Model-"+fp.txCount+"x"+fp.rxCount;
      return {
        fp: fp,
        devName: devName,
        modelId: matchId,     // null = unbekannt
        modelNameDefault: mn,
        vendor: ""            // optional frei editierbar
      };
    });

    // UI-Elemente
    var filterInput = modal.querySelector("#libwizFilter");
    var onlyUnknown = modal.querySelector("#libwizUnknown");
    var tbody = modal.querySelector("#libwizTbody");
    var countSpan = modal.querySelector("#libwizCount");

    // Render-Funktion
    function render(){
      var txt = (filterInput.value||"").toLowerCase();
      var unk = !!onlyUnknown.checked;
      var lib = load();

      tbody.innerHTML = "";
      var shown = 0;

      rows.forEach(function(row, idx){
        var isUnknown = !row.modelId;
        if(unk && !isUnknown) return;

        // Filter wirkt auf nützliche Labels/Infos
        var hay = [
          row.devName,
          row.modelNameDefault,
          (row.fp.txLabels||[]).join(" "),
          (row.fp.rxLabels||[]).join(" "),
          String(row.fp.txCount)+"x"+String(row.fp.rxCount)
        ].join(" ").toLowerCase();

        if(txt && hay.indexOf(txt) < 0) return;

        shown++;

        var tr = document.createElement("tr");

        var tdKnown = document.createElement("td");
        tdKnown.textContent = isUnknown ? "—" : "✓";
        tdKnown.style.textAlign = "center";

        var tdDev = document.createElement("td");
        tdDev.textContent = row.devName;

        var tdCounts = document.createElement("td");
        tdCounts.textContent = row.fp.txCount + "×" + row.fp.rxCount;

        var tdLabels = document.createElement("td");
        var txs = (row.fp.txLabels||[]).filter(Boolean).slice(0,6).join(", ");
        var rxs = (row.fp.rxLabels||[]).filter(Boolean).slice(0,6).join(", ");
        tdLabels.textContent = (txs||"(keine)") + "  |  " + (rxs||"(keine)");

        var tdVendor = document.createElement("td");
        var vin = document.createElement("input");
        vin.type = "text";
        vin.placeholder = "Vendor (optional)";
        vin.value = row.vendor || "";
        vin.oninput = function(){ row.vendor = vin.value; };
        tdVendor.appendChild(vin);

        var tdName = document.createElement("td");
        var nin = document.createElement("input");
        nin.type = "text";
        nin.placeholder = "Modelname";
        nin.value = row.modelNameDefault || "";
        nin.oninput = function(){ row.modelNameDefault = nin.value; };
        tdName.appendChild(nin);

        var tdAct = document.createElement("td");
        var btn = document.createElement("button");
        btn.textContent = isUnknown ? "Übernehmen" : "Schon in Lib";
        btn.disabled = !isUnknown;
        btn.onclick = function(){
          var model = addModelFromFingerprint(row.modelNameDefault, row.vendor, row.fp, "");
          row.modelId = model.id;           // jetzt bekannt
          render();
          // Sidebar kurz aktualisieren
          if(typeof window.renderLibrarySidebar === "function"){
            window.renderLibrarySidebar();
          }
        };
        tdAct.appendChild(btn);

        tr.appendChild(tdKnown);
        tr.appendChild(tdDev);
        tr.appendChild(tdCounts);
        tr.appendChild(tdLabels);
        tr.appendChild(tdVendor);
        tr.appendChild(tdName);
        tr.appendChild(tdAct);

        tbody.appendChild(tr);
      });

      countSpan.textContent = String(shown);
    }

    // Events
    filterInput.oninput = render;
    onlyUnknown.onchange = render;

    // Import/Export
    var expBtn = modal.querySelector("#libwizExport");
    var impBtn = modal.querySelector("#libwizImport");
    var impFile= modal.querySelector("#libwizImportFile");

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

    impBtn.onclick = function(){
      impFile.value = "";
      impFile.click();
    };
    impFile.onchange = function(e){
      var f = e.target.files && e.target.files[0];
      if(!f) return;
      var reader = new FileReader();
      reader.onload = function(ev){
        try{
          var num = importJson(String(ev.target.result||""));
          alert("Import erfolgreich: "+num+" Modelle übernommen.");
          render();
          if(typeof window.renderLibrarySidebar === "function"){
            window.renderLibrarySidebar();
          }
        }catch(err){
          alert(err.message || String(err));
        }
      };
      reader.readAsText(f);
    };

    // initial render
    render();
  }

  // -------- Sidebar-Renderer (klein, für Übersicht) --------
  function renderSidebarInto(container){
    var list = load();
    container.innerHTML = "";
    if(!list.length){
      container.innerHTML = "<div style='color:#666;font-size:13px'>Keine Modelle in der Bibliothek.</div>";
      return;
    }
    // kleine Liste
    list.slice().sort(function(a,b){
      var ax = (a.vendor||"") + a.modelName;
      var bx = (b.vendor||"") + b.modelName;
      return ax.localeCompare(bx);
    }).forEach(function(m){
      var div = document.createElement("div");
      div.className = "lib-item";
      div.style.padding = "4px 0";
      div.style.borderBottom = "1px dashed #eee";
      var vh = m.vendor ? (m.vendor+" / ") : "";
      div.textContent = vh + m.modelName + "  ("+m.txCount+"×"+m.rxCount+")";
      container.appendChild(div);
    });
  }

  return {
    openAdoptWizard,
    renderSidebarInto
  };
})();
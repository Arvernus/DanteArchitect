// Apps/Web/Lib.js
// Library-Engine für Modelle + Übernahme-Wizard (JSON in localStorage)

window.DA_LIB = (function(){
  var LKEY = "DA_MODEL_LIBRARY_V1";

  function load(){
    try{ var raw = localStorage.getItem(LKEY); if(!raw) return []; var arr = JSON.parse(raw); return Array.isArray(arr)?arr:[]; }
    catch(_){ return []; }
  }
  function save(list){
    try{ localStorage.setItem(LKEY, JSON.stringify(list||[])); }catch(_){}
  }
  function exportJson(){
    return JSON.stringify({ version:1, models: load() }, null, 2);
  }
  function importJson(jsonText){
    var parsed = JSON.parse(jsonText);
    if(parsed && Array.isArray(parsed.models)){ save(parsed.models); return parsed.models.length; }
    if(Array.isArray(parsed)){ save(parsed); return parsed.length; }
    throw new Error("Ungültiges JSON-Format für Model Library.");
  }

  // Hilfsfunktion: ersten vorhandenen Tag aus Liste lesen
  function readFirstText(el, tagNames){
    for(var i=0;i<tagNames.length;i++){
      var t = el.querySelector(tagNames[i]);
      if(t && t.textContent) return t.textContent.trim();
    }
    return "";
  }

  // Fingerprint + Vendor/Model aus Device-XML
  function fingerprintDevice(deviceEl){
    var devName = readFirstText(deviceEl, ["name"]);
    var vendor  = readFirstText(deviceEl, ["manufacturer", "vendor", "brand", "maker"]);
    var model   = readFirstText(deviceEl, ["model_name", "model", "product_name", "product"]);

    var tx = Array.prototype.slice.call(deviceEl.querySelectorAll("txchannel"));
    var rx = Array.prototype.slice.call(deviceEl.querySelectorAll("rxchannel"));

    function lbl(list, sel){
      var arr=[]; for(var i=0;i<Math.min(list.length,16);i++){ var el=list[i].querySelector(sel); arr.push(el&&el.textContent?el.textContent.trim():""); } return arr;
    }

    return {
      txCount: tx.length, rxCount: rx.length,
      txLabels: lbl(tx,"label"), rxLabels: lbl(rx,"name"),
      devNameHint: devName,
      vendorHint: vendor,
      modelHint: model
    };
  }

  function matchesModel(fp, m){
    if(!m) return false;
    // Primärschlüssel: TX/RX-Count; Vendor/Model sind informativ (optional variabel)
    return (fp.txCount===m.txCount) && (fp.rxCount===m.rxCount);
  }
  function findMatchingModelId(fp){
    var list = load(); for(var i=0;i<list.length;i++){ if(matchesModel(fp,list[i])) return list[i].id; } return null;
  }
  function addModelFromFingerprint(modelName, vendor, fp, notes){
    var list = load();
    var id = "mdl_" + Math.random().toString(36).slice(2,10) + Date.now().toString(36);
    var model = {
      id,
      modelName: String(modelName||"").trim() || ("Model-"+fp.txCount+"x"+fp.rxCount),
      vendor: vendor ? String(vendor).trim() : "",
      txCount: fp.txCount, rxCount: fp.rxCount,
      txLabels: fp.txLabels||[], rxLabels: fp.rxLabels||[],
      notes: notes||"", createdAt: Date.now()
    };
    list.push(model); save(list); return model;
  }

  function openAdoptWizard(xmlDoc){
    var modal = document.getElementById("libWizardModal");
    if(!modal){ alert("Modal-Container #libWizardModal fehlt."); return; }
    modal.style.display="flex";
    var closeBtn = modal.querySelector("[data-role='libwiz-close']");
    if(closeBtn) closeBtn.onclick = function(){ modal.style.display="none"; };
    modal.addEventListener("click", function(ev){ if(ev.target===modal) modal.style.display="none"; });

    var devices = Array.prototype.slice.call(xmlDoc.querySelectorAll("preset > device"));
    if(devices.length===0) devices = Array.prototype.slice.call(xmlDoc.querySelectorAll("device"));

    var rows = devices.map(function(de, idx){
      var fp = fingerprintDevice(de);
      var matchId = findMatchingModelId(fp);

      // Defaults aus echten Tags
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
      tbody.innerHTML=""; var shown=0;

      rows.forEach(function(row){
        var isUnknown = !row.modelId;
        if(unk && !isUnknown) return;

        var hay = [
          row.devName, row.modelNameDefault, row.vendor || "",
          (row.fp.txLabels||[]).join(" "),
          (row.fp.rxLabels||[]).join(" "),
          String(row.fp.txCount)+"x"+String(row.fp.rxCount)
        ].join(" ").toLowerCase();
        if(txt && hay.indexOf(txt)<0) return;

        shown++;
        var tr=document.createElement("tr");

        var tdKnown=document.createElement("td"); tdKnown.style.textAlign="center"; tdKnown.textContent=isUnknown?"—":"✓";
        var tdDev=document.createElement("td"); tdDev.textContent=row.devName;
        var tdCounts=document.createElement("td"); tdCounts.textContent=row.fp.txCount+"×"+row.fp.rxCount;
        var tdLabels=document.createElement("td");
        var txs=(row.fp.txLabels||[]).filter(Boolean).slice(0,6).join(", ");
        var rxs=(row.fp.rxLabels||[]).filter(Boolean).slice(0,6).join(", ");
        tdLabels.textContent=(txs||"(keine)")+" | "+(rxs||"(keine)");

        var tdVendor=document.createElement("td"); var vin=document.createElement("input");
        vin.type="text"; vin.placeholder="Vendor (optional)"; vin.value=row.vendor||""; vin.oninput=function(){row.vendor=vin.value;}; tdVendor.appendChild(vin);

        var tdName=document.createElement("td"); var nin=document.createElement("input");
        nin.type="text"; nin.placeholder="Modelname"; nin.value=row.modelNameDefault||""; nin.oninput=function(){row.modelNameDefault=nin.value;}; tdName.appendChild(nin);

        var tdAct=document.createElement("td"); var btn=document.createElement("button");
        btn.className="btn"; btn.textContent=isUnknown?"Übernehmen":"Schon in Lib"; btn.disabled=!isUnknown;
        btn.onclick=function(){
          var model=addModelFromFingerprint(row.modelNameDefault,row.vendor,row.fp,"");
          row.modelId=model.id; render();
          if(typeof window.renderLibrarySidebar==="function"){ window.renderLibrarySidebar(); }
        };
        tdAct.appendChild(btn);

        [tdKnown,tdDev,tdCounts,tdLabels,tdVendor,tdName,tdAct].forEach(function(td){ tr.appendChild(td); });
        tbody.appendChild(tr);
      });

      countSpan.textContent=String(shown);
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
      var reader=new FileReader();
      reader.onload=function(ev){
        try{
          var num = importJson(String(ev.target.result||""));
          alert("Import erfolgreich: "+num+" Modelle übernommen.");
          render();
          if(typeof window.renderLibrarySidebar==="function"){ window.renderLibrarySidebar(); }
        }catch(err){ alert(err.message||String(err)); }
      };
      reader.readAsText(f);
    };

    render();
  }

  function renderSidebarInto(container){
    var list = load();
    container.innerHTML="";
    if(!list.length){ container.innerHTML="<div class='muted'>Keine Modelle in der Bibliothek.</div>"; return; }
    list.slice().sort(function(a,b){
      var ax=(a.vendor||"")+a.modelName, bx=(b.vendor||"")+b.modelName; return ax.localeCompare(bx);
    }).forEach(function(m){
      var div=document.createElement("div");
      div.className="lib-item";
      var vh = m.vendor ? (m.vendor+" / ") : "";
      div.textContent = vh + m.modelName + " ("+m.txCount+"×"+m.rxCount+")";
      container.appendChild(div);
    });
  }

  return { openAdoptWizard, renderSidebarInto };
})();
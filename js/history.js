// history.js — historico mes a mes da equipe (dono, gerente e socio):
// valor a pagar, horarios lancados, plantoes e faltas, com Excel.
"use strict";

var historyData = null;

function historyMetric(){ return document.getElementById("historyMetric").value; }
function historyRange(){ return parseInt(document.getElementById("historyRange").value, 10) || 6; }

function loadHistory(){
  var table = document.getElementById("historyTable");
  if(!table || !authToken) return;
  authFetch("/api/company/history?months=" + historyRange()).then(function(res){
    if(res.status === 401){ handleAuthExpired(); throw new Error("auth_expired"); }
    return res.json().then(function(b){ return { ok: res.ok, body: b }; });
  }).then(function(r){
    if(!r.ok){ document.getElementById("historyNote").textContent = (r.body && r.body.message) || "Não consegui carregar o histórico."; return; }
    historyData = r.body;
    renderHistory();
  }).catch(function(err){
    if(err && err.message === "auth_expired") return;
    document.getElementById("historyNote").textContent = "Sem conexão com o servidor.";
  });
}

function historyFmt(metric, v){ return metric === "total" ? fmtMoney(v) : String(v); }
function historyShort(key){ var p = key.split("-"); return ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"][parseInt(p[1], 10) - 1] + "/" + p[0].slice(2); }

function renderHistory(){
  var d = historyData, metric = historyMetric();
  if(!d) return;
  var table = document.getElementById("historyTable");
  table.innerHTML = "";
  var thead = document.createElement("thead"), hr = document.createElement("tr");
  ["Pessoa"].concat(d.months.map(historyShort), ["Total"]).forEach(function(h){ var th = document.createElement("th"); th.textContent = h; hr.appendChild(th); });
  thead.appendChild(hr); table.appendChild(thead);
  var tbody = document.createElement("tbody");
  d.members.forEach(function(m){
    var tr = document.createElement("tr"), sum = 0;
    var tn = document.createElement("td"); tn.textContent = m.name; tr.appendChild(tn);
    d.months.forEach(function(mk){
      var c = m.months[mk], td = document.createElement("td");
      var v = c[metric] || 0; sum += v;
      td.textContent = !v && !c.hasData ? "–" : (c.status === "closed" ? "🔒 " : "") + historyFmt(metric, v);
      if(c.status !== "closed" && c.hasData) td.className = "open";
      if(!v) td.className = (td.className ? td.className + " " : "") + "zero";
      tr.appendChild(td);
    });
    var tt = document.createElement("td"); tt.textContent = historyFmt(metric, sum); tt.style.fontWeight = "800"; tr.appendChild(tt);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  var tfoot = document.createElement("tfoot"), fr = document.createElement("tr"), grand = 0;
  var fl = document.createElement("td"); fl.textContent = "Total do mês"; fr.appendChild(fl);
  d.months.forEach(function(mk){ var td = document.createElement("td"); var v = d.totals[mk][metric] || 0; grand += v; td.textContent = historyFmt(metric, v); fr.appendChild(td); });
  var fg = document.createElement("td"); fg.textContent = historyFmt(metric, grand); fr.appendChild(fg);
  tfoot.appendChild(fr); table.appendChild(tfoot);

  // barras: total da equipe por mes
  var bars = document.getElementById("historyBars");
  bars.innerHTML = "";
  var max = Math.max.apply(null, d.months.map(function(mk){ return d.totals[mk][metric] || 0; }).concat([1]));
  d.months.forEach(function(mk){
    var v = d.totals[mk][metric] || 0;
    var allClosed = d.members.length && d.members.every(function(m){ var c = m.months[mk]; return !c.hasData || c.status === "closed"; });
    var col = document.createElement("div"); col.className = "history-bar";
    var lv = document.createElement("span"); lv.className = "v"; lv.textContent = historyFmt(metric, v);
    var bar = document.createElement("div"); bar.className = "bar" + (allClosed ? "" : " open"); bar.style.height = Math.max(3, Math.round(v / max * 80)) + "px";
    var lm = document.createElement("span"); lm.className = "m"; lm.textContent = historyShort(mk);
    col.appendChild(lv); col.appendChild(bar); col.appendChild(lm); bars.appendChild(col);
  });
  document.getElementById("historyNote").textContent = metric === "total"
    ? "Valor de horas de sala (grade + auxílio − consumo). Barras claras e números em itálico são meses ainda abertos, ou seja, provisórios. Salário fixo de gerente e alunos particulares não entram."
    : "Barras claras e números em itálico são meses ainda abertos, ou seja, provisórios.";
}

function exportHistoryXlsx(){
  if(!historyData) return;
  var d = historyData;
  showToast("Gerando Excel...");
  loadExcelJs(function(){
    var wb = new window.ExcelJS.Workbook(), money = '"R$" #,##0.00';
    var defs = [["Valor a pagar (R$)", "total"], ["Horários lançados", "hours"], ["Plantões", "shifts"], ["Faltas", "absences"]];
    defs.forEach(function(def){
      var ws = wb.addWorksheet(def[0].replace(/[^A-Za-zÀ-ú ]/g, "").trim().slice(0, 28) || def[1]);
      ws.getColumn(1).width = 30;
      d.months.forEach(function(_, i){ ws.getColumn(i + 2).width = 14; });
      ws.getColumn(d.months.length + 2).width = 16;
      var head = ["Pessoa"].concat(d.months.map(function(mk){ return monthLabel(mk); }), ["Total"]);
      head.forEach(function(h, i){
        var c = ws.getCell(1, i + 1); c.value = h; c.font = { bold: true, color: { argb: "FF3B0764" } }; c.fill = fill(FILL_HEADER); c.border = THIN_BOX;
        if(i) c.alignment = { horizontal: "right" };
      });
      var r = 2;
      d.members.forEach(function(m){
        var sum = 0;
        ws.getCell(r, 1).value = m.name; ws.getCell(r, 1).border = THIN_BOX;
        d.months.forEach(function(mk, i){
          var v = m.months[mk][def[1]] || 0; sum += v;
          var c = ws.getCell(r, i + 2); c.value = v; c.border = THIN_BOX; c.alignment = { horizontal: "right" };
          if(def[1] === "total") c.numFmt = money;
          if(m.months[mk].status !== "closed" && m.months[mk].hasData) c.font = { italic: true, color: { argb: "FFB45309" } };
        });
        var tc = ws.getCell(r, d.months.length + 2); tc.value = sum; tc.font = { bold: true }; tc.border = THIN_BOX; tc.alignment = { horizontal: "right" };
        if(def[1] === "total") tc.numFmt = money;
        r++;
      });
      var fl = ws.getCell(r, 1); fl.value = "TOTAL"; fl.font = { bold: true }; fl.fill = fill(FILL_TOTAL);
      var grand = 0;
      d.months.forEach(function(mk, i){
        var v = d.totals[mk][def[1]] || 0; grand += v;
        var c = ws.getCell(r, i + 2); c.value = v; c.font = { bold: true }; c.fill = fill(FILL_TOTAL); c.alignment = { horizontal: "right" };
        if(def[1] === "total") c.numFmt = money;
      });
      var gc = ws.getCell(r, d.months.length + 2); gc.value = grand; gc.font = { bold: true }; gc.fill = fill(FILL_TOTAL); gc.alignment = { horizontal: "right" };
      if(def[1] === "total") gc.numFmt = money;
    });
    downloadWorkbook(wb, "historico-overall.xlsx").catch(function(){ showToast("Não consegui gerar o Excel."); });
  });
}

(function(){
  var m = document.getElementById("historyMetric"), r = document.getElementById("historyRange"), x = document.getElementById("btnHistoryXlsx");
  if(m) m.addEventListener("change", renderHistory);
  if(r) r.addEventListener("change", loadHistory);
  if(x) x.addEventListener("click", exportHistoryXlsx);
})();

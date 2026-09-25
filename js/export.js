// export.js — exportar a grade em Excel (colorido, igual a planilha
// original), em PDF (via impressao do navegador) e backup em .json.
"use strict";

  // ---------- Excel export (colorido, no estilo da planilha original) ----------
  var FILL_TITLE = "FF7030A0";     // roxo forte (cabecalho principal)
  var FILL_HEADER = "FFCC99FF";    // lilas claro (cabecalhos de secao/coluna)
  var FILL_WEEKEND = "FFE8DFFB";   // lilas bem claro (fim de semana)
  var FILL_HOLIDAY = "FFFDE68A";   // amarelo/ambar (feriado)
  var FILL_NOSCHED = "FFE9E9E9";   // cinza claro (sem escala)
  var FILL_VALUE = "FFEDE1FB";     // lilas claro (aula lancada)
  var FILL_TOTAL = "FFEFEFEF";     // cinza (linha de total)
  var BORDER_THIN = { style: "thin", color: { argb: "FFDDDDDD" } };
  var THIN_BOX = { top: BORDER_THIN, left: BORDER_THIN, bottom: BORDER_THIN, right: BORDER_THIN };

  function fill(argb){ return { type: "pattern", pattern: "solid", fgColor: { argb: argb } }; }

  function loadExcelJs(cb){
    if(window.ExcelJS){ cb(); return; }
    var existing = document.getElementById("exceljsLib");
    if(existing){ existing.addEventListener("load", cb); return; }
    var s = document.createElement("script");
    s.id = "exceljsLib";
    s.src = "vendor/exceljs.min.js";
    s.onload = cb;
    s.onerror = function(){ showToast("Não consegui carregar o gerador de Excel (sem internet?)"); };
    document.head.appendChild(s);
  }

  function buildExcelWorkbook(){
    var monthObj = ensureMonth(currentMonthKey);
    var keys = dayKeysOf(currentMonthKey);
    var lastCol = 1 + keys.length; // coluna A = Horario, depois um dia por coluna

    var wb = new window.ExcelJS.Workbook();
    var ws = wb.addWorksheet(monthLabel(currentMonthKey).replace("/", "-"), {
      views: [{ state: "frozen", xSplit: 1, ySplit: 0 }]
    });
    ws.getColumn(1).width = 16;
    for(var c = 2; c <= lastCol; c++){ ws.getColumn(c).width = 7; }

    var r = 1;
    function titleRow(text, fillColor, fontColor, size){
      ws.mergeCells(r, 1, r, lastCol);
      var cell = ws.getCell(r, 1);
      cell.value = text;
      cell.font = { bold: true, size: size || 12, color: { argb: fontColor || "FFFFFFFF" } };
      cell.fill = fill(fillColor);
      cell.alignment = { vertical: "middle", horizontal: "left" };
      ws.getRow(r).height = (size && size > 12) ? 26 : 20;
      r++;
    }

    titleRow("PONTO OVERALL — " + monthLabel(currentMonthKey).toUpperCase(), FILL_TITLE, "FFFFFFFF", 14);
    r++; // linha em branco

    // ---- resumo do mes ----
    titleRow("RESUMO DO MÊS", FILL_HEADER, "FF3B0764");
    var total = monthTotal(monthObj);
    var salario = total + (Number(monthObj.auxilio) || 0) - (Number(monthObj.consumo) || 0);
    var resumoLabels = ["Total horas (mês)", "Auxílio", "Consumo Overall", "Salário mensal"];
    var resumoValues = [total, Number(monthObj.auxilio) || 0, Number(monthObj.consumo) || 0, fmtMoney(salario)];
    for(var i = 0; i < 4; i++){
      var lc = ws.getCell(r, 1 + i);
      lc.value = resumoLabels[i];
      lc.font = { size: 9, color: { argb: "FF666666" } };
    }
    r++;
    for(var j = 0; j < 4; j++){
      var vc = ws.getCell(r, 1 + j);
      vc.value = resumoValues[j];
      vc.font = { bold: true, size: 13, color: { argb: j === 3 ? "FF059669" : "FF1c0a33" } };
    }
    r += 2;

    // ---- grade de horarios ----
    titleRow("GRADE DE HORÁRIOS", FILL_HEADER, "FF3B0764");
    var rowDayNumIdx = r, rowDayDowIdx = r + 1;
    ws.getCell(rowDayNumIdx, 1).value = "Dia";
    ws.getCell(rowDayDowIdx, 1).value = "Horário";
    [rowDayNumIdx, rowDayDowIdx].forEach(function(ri){
      var cell = ws.getCell(ri, 1);
      cell.font = { bold: true, size: 9 };
      cell.fill = fill(FILL_HEADER);
      cell.border = THIN_BOX;
    });

    keys.forEach(function(dateKey, idx){
      var col = idx + 2;
      var dayNum = parseInt(dateKey.split("-")[2], 10);
      var dow = dowOfDateKey(dateKey);
      var isWeekend = (dow === 0 || dow === 6);
      var dayObj = monthObj.days[dateKey];
      var singleXlsx = isSingleShiftDay(dateKey);
      var relevantXlsx = singleXlsx ? [dayObj.slots[0]] : dayObj.slots;
      var allFer = relevantXlsx.every(function(v){ return v === "FERIADO"; });
      var allSem = relevantXlsx.every(function(v){ return v === "SEM_ESCALA"; });
      var headFill = allFer ? FILL_HOLIDAY : allSem ? FILL_NOSCHED : isWeekend ? FILL_WEEKEND : FILL_HEADER;

      var cNum = ws.getCell(rowDayNumIdx, col);
      cNum.value = pad2(dayNum);
      cNum.font = { bold: true, size: 9 };
      cNum.fill = fill(headFill);
      cNum.alignment = { horizontal: "center" };
      cNum.border = THIN_BOX;

      var cDow = ws.getCell(rowDayDowIdx, col);
      cDow.value = DOW_NAMES[dow];
      cDow.font = { bold: true, size: 8, color: { argb: "FF666666" } };
      cDow.fill = fill(headFill);
      cDow.alignment = { horizontal: "center" };
      cDow.border = THIN_BOX;
    });
    r += 2;

    getTimeSlots().forEach(function(label, idx){
      var timeCell = ws.getCell(r, 1);
      timeCell.value = label;
      timeCell.font = { size: 9, color: { argb: "FF666666" } };
      timeCell.border = THIN_BOX;

      keys.forEach(function(dateKey, dIdx){
        var col = dIdx + 2;
        var dayObj = monthObj.days[dateKey];
        var singleXlsx = isSingleShiftDay(dateKey);
        var cell = ws.getCell(r, col);
        cell.alignment = { horizontal: "center" };
        cell.border = THIN_BOX;

        if(singleXlsx && idx > 0){
          cell.value = "";
          return;
        }

        var val = singleXlsx ? dayObj.slots[0] : dayObj.slots[idx];
        var shiftTagXlsx = singleXlsx ? (dayObj.shift ? SHIFT_SHORT[dayObj.shift] : "?") + " " : "";
        if(val === null || val === undefined){
          cell.value = shiftTagXlsx + "–";
          cell.font = { size: 9, color: { argb: "FFAAAAAA" } };
        } else if(val === "FERIADO"){
          cell.value = shiftTagXlsx + "FERIADO";
          cell.font = { bold: true, size: 8, color: { argb: "FF7C4A03" } };
          cell.fill = fill(FILL_HOLIDAY);
        } else if(val === "SEM_ESCALA"){
          cell.value = shiftTagXlsx + "SEM ESCALA";
          cell.font = { bold: true, size: 8, color: { argb: "FF888888" } };
          cell.fill = fill(FILL_NOSCHED);
        } else {
          cell.value = shiftTagXlsx + val;
          cell.font = { bold: true, size: 9, color: { argb: "FF3B0764" } };
          cell.fill = fill(FILL_VALUE);
        }
      });
      r++;
    });

    var totalLabelCell = ws.getCell(r, 1);
    totalLabelCell.value = "TOTAL";
    totalLabelCell.font = { bold: true };
    totalLabelCell.fill = fill(FILL_TOTAL);
    totalLabelCell.border = THIN_BOX;
    keys.forEach(function(dateKey, dIdx){
      var col = dIdx + 2;
      var dayObj = monthObj.days[dateKey];
      var cell = ws.getCell(r, col);
      cell.value = dayTotal(dayObj) || "";
      cell.font = { bold: true, color: { argb: "FF3B0764" } };
      cell.fill = fill(FILL_TOTAL);
      cell.alignment = { horizontal: "center" };
      cell.border = THIN_BOX;
    });
    r += 2;

    // ---- observacoes ----
    titleRow("OBSERVAÇÕES DO MÊS", FILL_HEADER, "FF3B0764");
    ws.mergeCells(r, 1, r, lastCol);
    var obsCell = ws.getCell(r, 1);
    obsCell.value = monthObj.obs || "";
    obsCell.alignment = { wrapText: true, vertical: "top" };
    ws.getRow(r).height = 34;
    r += 2;

    // ---- alunos vip (so pra quem ve essa secao na tela — personal trainer nao) ----
    if(roleCategory() !== "personal"){
      titleRow("ALUNOS VIP — AGENDA SEMANAL FIXA", FILL_HEADER, "FF3B0764");
      var vipHeadRow = r;
      ws.getCell(vipHeadRow, 1).value = "Horário";
      ws.getCell(vipHeadRow, 1).font = { bold: true, size: 9 };
      ws.getCell(vipHeadRow, 1).fill = fill(FILL_HEADER);
      ws.getCell(vipHeadRow, 1).border = THIN_BOX;
      VIP_COLS.forEach(function(c, idx){
        var cell = ws.getCell(vipHeadRow, idx + 2);
        cell.value = c.label;
        cell.font = { bold: true, size: 9 };
        cell.fill = fill(FILL_HEADER);
        cell.alignment = { horizontal: "center" };
        cell.border = THIN_BOX;
      });
      r++;
      getTimeSlots().forEach(function(label, idx){
        var timeCell = ws.getCell(r, 1);
        timeCell.value = label;
        timeCell.font = { size: 9, color: { argb: "FF666666" } };
        timeCell.border = THIN_BOX;
        VIP_COLS.forEach(function(c, cIdx){
          var val = (data.vip.slots[idx] || {})[c.key] || "";
          var cell = ws.getCell(r, cIdx + 2);
          cell.alignment = { horizontal: "center" };
          cell.border = THIN_BOX;
          if(val){
            cell.value = val;
            cell.font = { bold: true, size: 9, color: { argb: "FF3B0764" } };
            cell.fill = fill(FILL_VALUE);
          } else {
            cell.value = "–";
            cell.font = { size: 9, color: { argb: "FFAAAAAA" } };
          }
        });
        r++;
      });
    }

    return wb;
  }

  document.getElementById("btnExportCsv").addEventListener("click", function(){
    showToast("Gerando Excel...");
    loadExcelJs(function(){
      buildExcelWorkbook().xlsx.writeBuffer().then(function(buffer){
        var blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "ponto-overall-" + currentMonthKey + ".xlsx";
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
      }).catch(function(err){
        console.error("Falha ao gerar Excel:", err);
        showToast("Não consegui gerar o Excel.");
      });
    });
  });

  // ---------- PDF export (via browser print) ----------
  document.getElementById("btnExportPdf").addEventListener("click", function(){
    window.print();
  });

  // ---------- backup json ----------
  document.getElementById("btnExportJson").addEventListener("click", function(){
    var blob = new Blob([JSON.stringify(data, null, 2)], {type:"application/json"});
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "backup-ponto-overall-" + new Date().toISOString().slice(0,10) + ".json";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  });
  document.getElementById("btnImportJson").addEventListener("click", function(){
    document.getElementById("fileImport").click();
  });
  document.getElementById("fileImport").addEventListener("change", function(e){
    var file = e.target.files[0];
    if(!file) return;
    var reader = new FileReader();
    reader.onload = function(){
      try{
        var parsed = JSON.parse(reader.result);
        if(!confirm("Isso vai substituir todos os dados salvos neste aparelho. Continuar?")) return;
        data = parsed;
        saveData();
        renderMonthSelect(); renderGrid(); renderVip();
        showToast("Backup importado");
      }catch(err){
        showToast("Arquivo inválido");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  });


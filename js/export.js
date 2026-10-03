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
    var resumoLabels = ["Total lançado na grade (R$)", "Auxílio (R$)", "Consumo Overall (R$)", "Salário do mês (R$)"];
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

    // ---- alunos vip (so o estagiario atende VIP) ----
    if(roleCategory() === "estagiario"){
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

  // ---------- alunos particulares: Excel e PDF ----------
  var CLIENT_XLSX_COLS = [
    { header: "Aluno", width: 30 }, { header: "Dias", width: 24 }, { header: "Horário", width: 10 },
    { header: "Cobrança", width: 16 }, { header: "Valor combinado (R$)", width: 20 },
    { header: "Sessões no mês", width: 15 }, { header: "Ajuste", width: 9 }, { header: "Total do mês (R$)", width: 18 }
  ];

  function clientBillingLabel(client){
    return client.billingType === "monthly" ? "Mensal fixo" : "Por sessão";
  }
  function clientAgreedValue(client){
    return client.billingType === "monthly" ? (Number(client.flatMonthlyValue) || 0) : (Number(client.rate) || 0);
  }
  function clientAdjustCount(client){
    var adj = client.adjustments && client.adjustments[currentMonthKey];
    return adj ? (Number(adj.count) || 0) : 0;
  }

  function buildClientsWorkbook(){
    var clients = data.clients || [];
    var wb = new window.ExcelJS.Workbook();
    var ws = wb.addWorksheet("Alunos particulares", { views: [{ state: "frozen", ySplit: 4 }] });
    CLIENT_XLSX_COLS.forEach(function(c, i){ ws.getColumn(i + 1).width = c.width; });
    var lastCol = CLIENT_XLSX_COLS.length;

    ws.mergeCells(1, 1, 1, lastCol);
    var t = ws.getCell(1, 1);
    t.value = "ALUNOS PARTICULARES — " + monthLabel(currentMonthKey).toUpperCase();
    t.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
    t.fill = fill(FILL_TITLE);
    t.alignment = { vertical: "middle" };
    ws.getRow(1).height = 26;
    ws.mergeCells(2, 1, 2, lastCol);
    ws.getCell(2, 1).value = (currentUser ? currentUser.name : "") + " · gerado em " + new Date().toLocaleDateString("pt-BR");
    ws.getCell(2, 1).font = { size: 9, color: { argb: "FF666666" } };

    var headRow = 4;
    CLIENT_XLSX_COLS.forEach(function(c, i){
      var cell = ws.getCell(headRow, i + 1);
      cell.value = c.header;
      cell.font = { bold: true, size: 10, color: { argb: "FF3B0764" } };
      cell.fill = fill(FILL_HEADER);
      cell.alignment = { horizontal: i >= 4 ? "right" : "left", wrapText: true, vertical: "middle" };
      cell.border = THIN_BOX;
    });
    ws.getRow(headRow).height = 30;

    var r = headRow + 1, total = 0;
    var money = '"R$" #,##0.00';
    clients.forEach(function(client){
      var value = clientMonthlyValue(client, currentMonthKey);
      total += value;
      var monthly = client.billingType === "monthly";
      var vals = [
        client.name, clientDaysLabel(client), client.time || "", clientBillingLabel(client),
        clientAgreedValue(client), monthly ? "—" : clientMonthlySessions(client, currentMonthKey),
        clientAdjustCount(client) || "", value
      ];
      vals.forEach(function(v, i){
        var cell = ws.getCell(r, i + 1);
        cell.value = v;
        cell.border = THIN_BOX;
        cell.font = { size: 10, bold: i === 7 };
        if(i === 4 || i === 7){ cell.numFmt = money; cell.alignment = { horizontal: "right" }; }
        if(i === 5 || i === 6){ cell.alignment = { horizontal: "right" }; }
      });
      r++;
    });
    if(clients.length === 0){
      ws.mergeCells(r, 1, r, lastCol);
      ws.getCell(r, 1).value = "Nenhum aluno particular cadastrado.";
      ws.getCell(r, 1).font = { italic: true, color: { argb: "FF888888" } };
      r++;
    }
    ws.mergeCells(r, 1, r, lastCol - 1);
    var tl = ws.getCell(r, 1);
    tl.value = "TOTAL DO MÊS";
    tl.font = { bold: true };
    tl.alignment = { horizontal: "right" };
    tl.fill = fill(FILL_TOTAL);
    var tv = ws.getCell(r, lastCol);
    tv.value = total;
    tv.numFmt = money;
    tv.font = { bold: true, color: { argb: "FF059669" } };
    tv.alignment = { horizontal: "right" };
    tv.fill = fill(FILL_TOTAL);
    tv.border = THIN_BOX;
    return wb;
  }

  function downloadWorkbook(wb, filename){
    return wb.xlsx.writeBuffer().then(function(buffer){
      var blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    });
  }

  document.getElementById("btnExportClientsXlsx").addEventListener("click", function(){
    showToast("Gerando Excel...");
    loadExcelJs(function(){
      downloadWorkbook(buildClientsWorkbook(), "alunos-particulares-" + currentMonthKey + ".xlsx").catch(function(err){
        console.error("Falha ao gerar Excel:", err);
        showToast("Não consegui gerar o Excel.");
      });
    });
  });

  // Folha de impressao (PDF) com uma tabela simples: "Salvar como PDF" no dialogo de impressao.
  function printSheet(kind){
    document.body.classList.add("print-" + kind);
    var done = false;
    function cleanup(){
      if(done) return;
      done = true;
      document.body.classList.remove("print-" + kind);
      window.removeEventListener("afterprint", cleanup);
    }
    window.addEventListener("afterprint", cleanup);
    setTimeout(function(){ window.print(); setTimeout(cleanup, 800); }, 60);
  }

  function renderSheetTable(sheetEl, title, subtitle, headers, rows, totalLabel, totalValue){
    sheetEl.innerHTML = "";
    var h1 = document.createElement("h1"); h1.textContent = title; sheetEl.appendChild(h1);
    var sub = document.createElement("p"); sub.className = "ps-sub"; sub.textContent = subtitle; sheetEl.appendChild(sub);
    var table = document.createElement("table");
    var thead = document.createElement("thead"); var hr = document.createElement("tr");
    headers.forEach(function(h, i){
      var th = document.createElement("th"); th.textContent = h; if(i === headers.length - 1) th.className = "num"; hr.appendChild(th);
    });
    thead.appendChild(hr); table.appendChild(thead);
    var tbody = document.createElement("tbody");
    rows.forEach(function(row){
      var tr = document.createElement("tr");
      row.forEach(function(v, i){
        var td = document.createElement("td"); td.textContent = v; if(i === row.length - 1) td.className = "num"; tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    var tt = document.createElement("tr"); tt.className = "ps-total";
    var tdl = document.createElement("td"); tdl.colSpan = headers.length - 1; tdl.textContent = totalLabel; tdl.className = "num";
    var tdv = document.createElement("td"); tdv.textContent = totalValue; tdv.className = "num";
    tt.appendChild(tdl); tt.appendChild(tdv); tbody.appendChild(tt);
    table.appendChild(tbody); sheetEl.appendChild(table);
    var foot = document.createElement("p"); foot.className = "ps-foot";
    foot.textContent = "Gerado pelo Ponto Overall em " + new Date().toLocaleDateString("pt-BR");
    sheetEl.appendChild(foot);
  }

  document.getElementById("btnExportClientsPdf").addEventListener("click", function(){
    var clients = data.clients || [];
    var rows = clients.map(function(c){
      return [c.name, clientDaysLabel(c) + (c.time ? " · " + c.time : ""), clientBillingLabel(c) + " · " + fmtMoney(clientAgreedValue(c)),
        c.billingType === "monthly" ? "—" : String(clientMonthlySessions(c, currentMonthKey)), fmtMoney(clientMonthlyValue(c, currentMonthKey))];
    });
    var total = clients.reduce(function(sum, c){ return sum + clientMonthlyValue(c, currentMonthKey); }, 0);
    renderSheetTable(document.getElementById("clientsPrintSheet"),
      "Alunos particulares — " + monthLabel(currentMonthKey),
      (currentUser ? currentUser.name : ""),
      ["Aluno", "Dias e horário", "Cobrança", "Sessões", "Total do mês"], rows, "Total do mês", fmtMoney(total));
    printSheet("clients");
  });

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


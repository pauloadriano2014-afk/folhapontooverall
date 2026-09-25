// grade.js — a grade de ponto (escala de horas): montar a tabela do mes,
// totais, selecao de mes e os campos de auxilio/consumo/observacoes/pago.
"use strict";

  // ---------- state ----------
  var todayKey = (function(){
    var t = new Date();
    return monthKeyOf(t.getFullYear(), t.getMonth());
  })();

  var currentMonthKey = todayKey;
  var todayFullKey = (function(){
    var t = new Date();
    return t.getFullYear() + "-" + pad2(t.getMonth() + 1) + "-" + pad2(t.getDate());
  })();

  // Chamado depois que os dados da conta logada ja foram carregados (ver bootApp),
  // nunca antes disso — pra nao criar/gravar um mes "no vazio" antes do login.
  function initMonthState(){
    if(Object.keys(data.months).length === 0){
      ensureMonth(todayKey);
    }
    currentMonthKey = sortedMonthKeys().indexOf(todayKey) >= 0 ? todayKey : sortedMonthKeys()[sortedMonthKeys().length - 1];
  }

  var activeDayKey = null;
  var activeVip = null; // {rowIndex, colKey}

  // ---------- rendering ----------
  var monthSelect = document.getElementById("monthSelect");
  var rowDayNum = document.getElementById("rowDayNum");
  var rowDayDow = document.getElementById("rowDayDow");
  var gridBody = document.getElementById("gridBody");
  var inputAuxilio = document.getElementById("inputAuxilio");
  var inputConsumo = document.getElementById("inputConsumo");
  var statTotal = document.getElementById("statTotal");
  var statSalario = document.getElementById("statSalario");
  var obsField = document.getElementById("obs");
  var printTitle = document.getElementById("printTitle");
  var inputPaid = document.getElementById("inputPaid");

  function monthLabel(key){
    var parts = key.split("-");
    var year = parseInt(parts[0],10), mIdx = parseInt(parts[1],10)-1;
    var names = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
    return names[mIdx] + " / " + year;
  }

  function renderMonthSelect(){
    var keys = sortedMonthKeys();
    monthSelect.innerHTML = "";
    keys.forEach(function(k){
      var opt = document.createElement("option");
      opt.value = k;
      opt.textContent = monthLabel(k) + (data.months[k] && data.months[k].paid ? " ✓" : "");
      if(k === currentMonthKey) opt.selected = true;
      monthSelect.appendChild(opt);
    });
  }

  function dayKeysOf(monthKey){
    var m = data.months[monthKey];
    return Object.keys(m.days).sort();
  }

  function dowOfDateKey(dateKey){
    var parts = dateKey.split("-").map(Number);
    var dt = new Date(parts[0], parts[1]-1, parts[2]);
    return dt.getDay(); // 0=Dom..6=Sab
  }

  function dayTotal(dayObj){
    // Soma so ate a quantidade de horarios configurada hoje — se a conta
    // diminuiu a grade, um valor antigo "sobrando" num horario removido nao
    // fica contando escondido no total (mas tambem nao e apagado: se a conta
    // aumentar a grade de novo depois, o valor volta a aparecer).
    var n = getTimeSlots().length;
    var sum = 0;
    for(var i = 0; i < n; i++){
      if(typeof dayObj.slots[i] === "number") sum += dayObj.slots[i];
    }
    return sum;
  }

  function monthTotal(monthObj){
    var sum = 0;
    Object.keys(monthObj.days).forEach(function(k){ sum += dayTotal(monthObj.days[k]); });
    return sum;
  }

  function fmtMoney(n){
    return "R$ " + n.toLocaleString("pt-BR", {minimumFractionDigits:2, maximumFractionDigits:2});
  }

  // Builds one grid table's rows into the given <tr>/<tbody> elements, for the given
  // subset of day keys. Used both for the main on-screen table (all days) and for the
  // narrower split tables used when printing (so a wide month still prints in portrait).
  function buildGridInto(keys, monthObj, rowNumEl, rowDowEl, bodyEl, clickable){
    rowNumEl.innerHTML = "<th class='timecol'>Dia</th>";
    rowDowEl.innerHTML = "<th class='timecol'>Horário</th>";
    bodyEl.innerHTML = "";

    keys.forEach(function(dateKey){
      var dayNum = parseInt(dateKey.split("-")[2], 10);
      var dow = dowOfDateKey(dateKey);
      var isWeekend = (dow === 0 || dow === 6);
      var dayObj = monthObj.days[dateKey];
      var single = isSingleShiftDay(dateKey);
      var relevantSlots = single ? [dayObj.slots[0]] : dayObj.slots.slice(0, getTimeSlots().length);
      var allFer = relevantSlots.every(function(v){ return v === "FERIADO"; });
      var allSem = relevantSlots.every(function(v){ return v === "SEM_ESCALA"; });

      var hasNote = !!(dayObj.note && dayObj.note.trim());
      var thNum = document.createElement("th");
      thNum.className = "dayhead" + (isWeekend ? " weekend" : "") + (allFer ? " col-holiday" : "") + (allSem ? " col-noschedule" : "");
      thNum.innerHTML = "<span class='num'>" + pad2(dayNum) + "</span>" + (hasNote ? "<span class='note-dot' title='Tem anotação'>•</span>" : "");
      if(clickable) thNum.addEventListener("click", function(){ openDayModal(dateKey); });
      rowNumEl.appendChild(thNum);

      var thDow = document.createElement("th");
      thDow.className = "dayhead" + (isWeekend ? " weekend" : "") + (allFer ? " col-holiday" : "") + (allSem ? " col-noschedule" : "");
      thDow.innerHTML = "<span class='dow'>" + DOW_NAMES[dow] + "</span>";
      if(clickable) thDow.addEventListener("click", function(){ openDayModal(dateKey); });
      rowDowEl.appendChild(thDow);
    });

    var gridSlots = getTimeSlots();
    for(var s = 0; s < gridSlots.length; s++){
      var tr = document.createElement("tr");
      var tdTime = document.createElement("td");
      tdTime.className = "timecol";
      tdTime.textContent = gridSlots[s];
      tr.appendChild(tdTime);

      keys.forEach(function(dateKey){
        var dow = dowOfDateKey(dateKey);
        var isWeekend = (dow === 0 || dow === 6);
        var dayObj = monthObj.days[dateKey];
        var single = isSingleShiftDay(dateKey);
        var td = document.createElement("td");
        td.className = "daycell" + (isWeekend ? " weekend" : "");

        // Fim de semana com turno unico ligado: so a primeira "linha" (s===0)
        // representa algo (o turno de 5h de sala); as outras 5 linhas ficam
        // em branco/nao clicaveis pra essa coluna, ja que nao existem.
        if(single && s > 0){
          td.className += " cell-na";
          if(clickable) td.addEventListener("click", function(dk){ return function(){ openDayModal(dk); }; }(dateKey));
          tr.appendChild(td);
          return;
        }

        var val = single ? dayObj.slots[0] : dayObj.slots[s];
        var span = document.createElement("span");
        span.className = "slot" + (single ? " shift-slot" : "");
        var shiftTag = single ? (dayObj.shift ? SHIFT_SHORT[dayObj.shift] : "?") + " · " : "";
        if(val === null || val === undefined){
          span.textContent = shiftTag + "–";
          span.className += " sem";
        } else if(val === "FERIADO"){
          span.textContent = shiftTag + "FER";
          span.className += " feriado";
        } else if(val === "SEM_ESCALA"){
          span.textContent = shiftTag + "s/e";
          span.className += " sem";
        } else {
          span.textContent = shiftTag + val;
          span.className += " filled";
        }
        td.appendChild(span);
        if(clickable) td.addEventListener("click", function(dk){ return function(){ openDayModal(dk); }; }(dateKey));
        tr.appendChild(td);
      });

      bodyEl.appendChild(tr);
    }

    // total row
    var trTotal = document.createElement("tr");
    trTotal.className = "totalrow";
    var tdLabel = document.createElement("td");
    tdLabel.className = "timecol";
    tdLabel.textContent = "TOTAL";
    trTotal.appendChild(tdLabel);
    keys.forEach(function(dateKey){
      var dayObj = monthObj.days[dateKey];
      var td = document.createElement("td");
      td.className = "daycell";
      td.textContent = dayTotal(dayObj) || "";
      trTotal.appendChild(td);
    });
    bodyEl.appendChild(trTotal);
  }

  // Rebuilds the print-only split tables: the full month grid is too wide to fit a
  // portrait page in one piece, so for printing it's broken into two narrower tables
  // (first/second half of the month), stacked vertically, keeping the whole PDF portrait.
  function renderPrintGrid(monthObj, keys){
    var container = document.getElementById("printGridSplit");
    if(!container) return;
    container.innerHTML = "";
    var mid = Math.ceil(keys.length / 2);
    var chunks = [keys.slice(0, mid), keys.slice(mid)];
    chunks.forEach(function(chunkKeys){
      if(chunkKeys.length === 0) return;
      var wrap = document.createElement("div");
      wrap.className = "table-wrap";
      var table = document.createElement("table");
      var thead = document.createElement("thead");
      var trNum = document.createElement("tr");
      var trDow = document.createElement("tr");
      thead.appendChild(trNum);
      thead.appendChild(trDow);
      var tbody = document.createElement("tbody");
      table.appendChild(thead);
      table.appendChild(tbody);
      wrap.appendChild(table);
      container.appendChild(wrap);
      buildGridInto(chunkKeys, monthObj, trNum, trDow, tbody, false);
    });
  }

  function renderGrid(){
    var monthObj = ensureMonth(currentMonthKey);
    var keys = dayKeysOf(currentMonthKey);

    buildGridInto(keys, monthObj, rowDayNum, rowDayDow, gridBody, true);
    renderPrintGrid(monthObj, keys);

    inputAuxilio.value = monthObj.auxilio;
    inputConsumo.value = monthObj.consumo;
    obsField.value = monthObj.obs || "";
    inputPaid.checked = !!monthObj.paid;

    var total = monthTotal(monthObj);
    var salario = total + (Number(monthObj.auxilio) || 0) - (Number(monthObj.consumo) || 0);
    statTotal.textContent = total;
    statSalario.textContent = fmtMoney(salario);
    printTitle.textContent = "Folha de Ponto Overall — " + monthLabel(currentMonthKey);
    renderClients();
    renderVip();
  }


  // ---------- inputs ----------
  inputAuxilio.addEventListener("input", function(){
    var monthObj = ensureMonth(currentMonthKey);
    monthObj.auxilio = parseFloat(inputAuxilio.value.replace(",", ".")) || 0;
    data.settings.defaultAuxilio = monthObj.auxilio;
    saveData(); renderGrid();
  });
  inputConsumo.addEventListener("input", function(){
    var monthObj = ensureMonth(currentMonthKey);
    monthObj.consumo = parseFloat(inputConsumo.value.replace(",", ".")) || 0;
    saveData(); renderGrid();
  });
  obsField.addEventListener("input", function(){
    var monthObj = ensureMonth(currentMonthKey);
    monthObj.obs = obsField.value;
    saveData();
  });
  inputPaid.addEventListener("change", function(){
    var monthObj = ensureMonth(currentMonthKey);
    monthObj.paid = inputPaid.checked;
    saveData();
    renderMonthSelect();
  });

  // ---------- month controls ----------
  monthSelect.addEventListener("change", function(){
    currentMonthKey = monthSelect.value;
    renderGrid();
  });

  document.getElementById("btnNewMonth").addEventListener("click", function(){
    var input = prompt("Novo mês (formato AAAA-MM), ex: 2026-10:");
    if(!input) return;
    var match = /^(\d{4})-(\d{2})$/.exec(input.trim());
    if(!match){ showToast("Formato inválido. Use AAAA-MM"); return; }
    var key = match[1] + "-" + match[2];
    ensureMonth(key);
    currentMonthKey = key;
    renderMonthSelect();
    renderGrid();
    showToast("Mês " + monthLabel(key) + " criado");
  });

  document.getElementById("btnToday").addEventListener("click", function(){
    ensureMonth(todayKey);
    currentMonthKey = todayKey;
    renderMonthSelect();
    renderGrid();
    openDayModal(todayFullKey);
  });

  document.getElementById("btnApplyHolidays").addEventListener("click", function(){
    var count = applyHolidaysToMonth(currentMonthKey);
    if(count > 0){
      renderGrid();
      showToast(count + " feriado(s) marcado(s) automaticamente");
    } else {
      showToast("Nenhum feriado novo pra marcar neste mês");
    }
  });


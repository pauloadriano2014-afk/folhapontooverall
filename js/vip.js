// vip.js — grade de alunos VIP (estagiario) e controle de presenca/falta.
"use strict";

  // ---------- VIP grid ----------
  var vipHead = document.getElementById("vipHead");
  var vipBody = document.getElementById("vipBody");

  // ---------- presença dos alunos VIP ----------
  // A agenda VIP e um horario semanal fixo (nao muda de mes pra mes), mas a
  // presenca real de cada aluno e registrada por data especifica dentro do mes
  // selecionado — assim da pra saber quem falta muito ou cobrar reposicao.
  var VIP_COL_TO_DOW = { seg: 1, ter: 2, qua: 3, qui: 4, sex: 5 };

  function vipAttendanceKey(rowIndex, colKey, dateKey){
    return rowIndex + "_" + colKey + "_" + dateKey;
  }

  // A grade de horarios agora e customizavel por conta, entao data.vip.slots
  // pode ficar mais curto ou mais longo do que a lista salva antes — isso
  // garante a linha existir (sem apagar as outras) antes de ler/gravar nela.
  function ensureVipRow(rowIndex){
    if(!data.vip.slots[rowIndex]){
      data.vip.slots[rowIndex] = { seg:"", ter:"", qua:"", qui:"", sex:"" };
    }
    return data.vip.slots[rowIndex];
  }

  function getVipAttendance(rowIndex, colKey, dateKey){
    return (data.vip.attendance || {})[vipAttendanceKey(rowIndex, colKey, dateKey)] || null;
  }

  function setVipAttendance(rowIndex, colKey, dateKey, status){
    if(!data.vip.attendance) data.vip.attendance = {};
    var key = vipAttendanceKey(rowIndex, colKey, dateKey);
    if(status){
      data.vip.attendance[key] = status;
    } else {
      delete data.vip.attendance[key];
    }
    saveData();
  }

  function datesForWeekdayInMonth(monthKey, dow){
    var parts = monthKey.split("-");
    var year = parseInt(parts[0], 10), monthIndex = parseInt(parts[1], 10) - 1;
    var nDays = daysInMonth(year, monthIndex);
    var dates = [];
    for(var d = 1; d <= nDays; d++){
      if(new Date(year, monthIndex, d).getDay() === dow) dates.push(monthKey + "-" + pad2(d));
    }
    return dates;
  }

  function countVipFaltasThisMonth(rowIndex, colKey){
    var dow = VIP_COL_TO_DOW[colKey];
    var dates = datesForWeekdayInMonth(currentMonthKey, dow);
    var count = 0;
    dates.forEach(function(dateKey){
      if(getVipAttendance(rowIndex, colKey, dateKey) === "falta") count++;
    });
    return count;
  }

  function renderVipAttendanceSection(rowIndex, colKey){
    var section = document.getElementById("vipAttendanceSection");
    var listEl = document.getElementById("vipAttendanceList");
    var titleEl = document.getElementById("vipAttendanceTitle");
    var summaryEl = document.getElementById("vipAttendanceSummary");
    var name = (data.vip.slots[rowIndex] || {})[colKey];
    if(!name || name === "X"){
      section.style.display = "none";
      return;
    }
    section.style.display = "block";
    titleEl.textContent = "Presença em " + monthLabel(currentMonthKey);
    var colLabel = VIP_COLS.filter(function(c){ return c.key === colKey; })[0].label;
    var monthNum = currentMonthKey.split("-")[1];
    var dow = VIP_COL_TO_DOW[colKey];
    var dates = datesForWeekdayInMonth(currentMonthKey, dow);
    listEl.innerHTML = "";
    var presentCount = 0, faltaCount = 0;
    dates.forEach(function(dateKey){
      var dayNum = dateKey.split("-")[2];
      var status = getVipAttendance(rowIndex, colKey, dateKey);
      if(status === "presente") presentCount++;
      if(status === "falta") faltaCount++;

      var row = document.createElement("div");
      row.className = "attendance-row";
      var label = document.createElement("span");
      label.textContent = colLabel + ", " + dayNum + "/" + monthNum;
      var btns = document.createElement("div");
      btns.className = "attendance-btns";
      ["presente", "falta"].forEach(function(st){
        var b = document.createElement("button");
        b.className = "small attendance-btn " + st + (status === st ? " active" : "");
        b.textContent = st === "presente" ? "Presente" : "Faltou";
        b.addEventListener("click", function(){
          setVipAttendance(rowIndex, colKey, dateKey, status === st ? null : st);
          renderVipAttendanceSection(rowIndex, colKey);
          renderVip();
        });
        btns.appendChild(b);
      });
      row.appendChild(label);
      row.appendChild(btns);
      listEl.appendChild(row);
    });
    summaryEl.textContent = "Presenças: " + presentCount + " · Faltas: " + faltaCount + " este mês";
  }

  function renderVip(){
    vipHead.innerHTML = "<th class='timecol'>Horário</th>";
    VIP_COLS.forEach(function(c){
      var th = document.createElement("th");
      th.textContent = c.label;
      vipHead.appendChild(th);
    });

    vipBody.innerHTML = "";
    getTimeSlots().forEach(function(label, idx){
      var tr = document.createElement("tr");
      var tdTime = document.createElement("td");
      tdTime.className = "timecol";
      tdTime.textContent = label;
      tr.appendChild(tdTime);

      VIP_COLS.forEach(function(c){
        var val = (data.vip.slots[idx] || {})[c.key] || "";
        var td = document.createElement("td");
        td.className = "daycell";
        var span = document.createElement("span");
        span.className = "slot" + (val ? " filled" : " sem");
        span.textContent = val ? val : "–";
        if(val && val !== "X"){
          var faltas = countVipFaltasThisMonth(idx, c.key);
          if(faltas > 0){
            var badge = document.createElement("sup");
            badge.className = "vip-falta-badge";
            badge.textContent = faltas;
            badge.title = faltas + " falta(s) este mês";
            span.appendChild(badge);
          }
        }
        td.appendChild(span);
        td.addEventListener("click", function(){ openVipModal(idx, c.key, label, c.label); });
        tr.appendChild(td);
      });

      vipBody.appendChild(tr);
    });
  }

  var vipOverlay = document.getElementById("vipOverlay");
  var vipTitle = document.getElementById("vipTitle");
  var vipSub = document.getElementById("vipSub");
  var vipNameInput = document.getElementById("vipNameInput");

  function openVipModal(rowIndex, colKey, timeLabel, dayLabel){
    activeVip = { rowIndex: rowIndex, colKey: colKey };
    vipTitle.textContent = dayLabel + " · " + timeLabel;
    vipSub.textContent = "Nome do aluno, ou marque como sem aula.";
    var vipRow = ensureVipRow(rowIndex);
    vipNameInput.value = vipRow[colKey] === "X" ? "" : (vipRow[colKey] || "");
    renderVipAttendanceSection(rowIndex, colKey);
    vipOverlay.classList.add("open");
    setTimeout(function(){ vipNameInput.focus(); }, 50);
  }

  document.getElementById("vipSave").addEventListener("click", function(){
    if(!activeVip) return;
    ensureVipRow(activeVip.rowIndex)[activeVip.colKey] = vipNameInput.value.trim();
    saveData(); renderVip(); closeOverlays();
  });
  document.getElementById("vipMarkX").addEventListener("click", function(){
    if(!activeVip) return;
    ensureVipRow(activeVip.rowIndex)[activeVip.colKey] = "X";
    saveData(); renderVip(); closeOverlays();
  });
  document.getElementById("vipClear").addEventListener("click", function(){
    if(!activeVip) return;
    ensureVipRow(activeVip.rowIndex)[activeVip.colKey] = "";
    saveData(); renderVip(); closeOverlays();
  });


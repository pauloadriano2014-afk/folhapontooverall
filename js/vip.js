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
    renderVipDay();
  }

  // Visao do dia: abas SEG..SEX e a lista de horarios do dia escolhido (aluno, "Livre" ou sem aula).
  var vipSelCol = null;
  var VIP_COLORS = ["#7c3aed,#4c1d95", "#db2777,#9d174d", "#0891b2,#155e75", "#16a34a,#166534", "#ea580c,#9a3412", "#2563eb,#1e3a8a"];
  function vipInitials(name){
    var p = String(name).trim().split(/\s+/);
    return ((p[0] || "?").charAt(0) + (p.length > 1 ? p[p.length - 1].charAt(0) : (p[0] || "").charAt(1) || "")).toUpperCase();
  }
  function renderVipDay(){
    var tabs = document.getElementById("vipTabs"), list = document.getElementById("vipDay");
    if(!tabs || !list) return;
    if(!vipSelCol){
      var dow = new Date().getDay();
      var keys = Object.keys(VIP_COL_TO_DOW).filter(function(k){ return VIP_COL_TO_DOW[k] === dow; });
      vipSelCol = keys[0] || VIP_COLS[0].key;
    }
    tabs.innerHTML = "";
    VIP_COLS.forEach(function(c){
      var b = document.createElement("button"); b.type = "button";
      b.className = "week-tab vip-tab" + (c.key === vipSelCol ? " on" : "");
      b.textContent = c.label;
      b.addEventListener("click", function(){ vipSelCol = c.key; renderVipDay(); });
      tabs.appendChild(b);
    });
    list.innerHTML = "";
    var colLabel = VIP_COLS.filter(function(c){ return c.key === vipSelCol; })[0].label;
    getTimeSlots().forEach(function(label, idx){
      var val = (data.vip.slots[idx] || {})[vipSelCol] || "";
      var row = document.createElement("button"); row.type = "button"; row.className = "vip-row";
      var tm = document.createElement("span"); tm.className = "mono vip-time"; tm.textContent = label.split("–")[0];
      row.appendChild(tm);
      if(val && val !== "X"){
        var av = document.createElement("span"); av.className = "vip-av"; av.textContent = vipInitials(val);
        av.style.background = "linear-gradient(135deg," + VIP_COLORS[(val.charCodeAt(0) + val.length) % VIP_COLORS.length] + ")";
        var nm = document.createElement("strong"); nm.className = "vip-name"; nm.textContent = val;
        var f = countVipFaltasThisMonth(idx, vipSelCol);
        var chip = document.createElement("span"); chip.className = "vip-chip" + (f ? " falta" : ""); chip.textContent = f ? f + (f === 1 ? " falta" : " faltas") : "Em dia";
        row.appendChild(av); row.appendChild(nm); row.appendChild(chip);
      } else {
        var free = document.createElement("span"); free.className = "vip-free"; free.textContent = val === "X" ? "Sem aula" : "+ Livre";
        row.appendChild(free);
      }
      row.addEventListener("click", function(){ openVipModal(idx, vipSelCol, label, colLabel); });
      list.appendChild(row);
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


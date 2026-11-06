// dayModal.js — o modal de editar um dia especifico da grade de ponto.
"use strict";

  // ---------- day modal ----------
  var dayOverlay = document.getElementById("dayOverlay");
  var dayTitle = document.getElementById("dayTitle");
  var daySub = document.getElementById("daySub");
  var slotList = document.getElementById("slotList");

  // Constroi uma linha de horario (usada tanto pros 6 horarios fixos da semana
  // quanto pro turno unico de fim de semana, que so tem uma linha — idx sempre
  // aponta pra posicao real dentro de dayObj.slots que aquela linha edita).
  function buildSlotRow(dateKey, dayObj, label, idx){
    var row = document.createElement("div");
    row.className = "slot-row";

    var time = document.createElement("div");
    time.className = "time";
    time.textContent = label;
    row.appendChild(time);

    // turno unico (fim de semana/feriado): o valor vale para as 5 horas do turno
    var single = isSingleShiftDay(dateKey);
    function assign(v){
      if(single) setShiftDayValue(dayObj, v);
      else dayObj.slots[idx] = v;
    }

    var current = document.createElement("div");
    current.className = "current" + (single && typeof dayObj.slots[idx] === "number" ? " shift-total" : "");
    current.textContent = (single && typeof dayObj.slots[idx] === "number")
      ? "R$ " + dayObj.slots[idx] + " por hora × " + SHIFT_HOURS + "h = R$ " + (dayObj.slots[idx] * SHIFT_HOURS)
      : describeSlot(dayObj.slots[idx]);
    row.appendChild(current);

    var btns = document.createElement("div");
    btns.className = "slot-btns";

    var quickValues = (data.settings.quickValues && data.settings.quickValues.length) ? data.settings.quickValues : [10, 15];
    quickValues.forEach(function(v){
      var b = document.createElement("button");
      b.className = "small";
      b.textContent = v;
      b.addEventListener("click", function(){
        assign(v);
        saveData(); openDayModal(dateKey); renderGrid();
      });
      btns.appendChild(b);
    });

    var bCustom = document.createElement("button");
    bCustom.className = "small";
    bCustom.textContent = "Outro";
    bCustom.addEventListener("click", function(){
      var v = prompt("Valor para este horário:", typeof dayObj.slots[idx] === "number" ? dayObj.slots[idx] : "");
      if(v === null) return;
      var num = parseFloat(v.replace(",", "."));
      if(isNaN(num)){ showToast("Valor inválido"); return; }
      assign(num);
      saveData(); openDayModal(dateKey); renderGrid();
    });
    btns.appendChild(bCustom);

    var bFer = document.createElement("button");
    bFer.className = "small";
    bFer.textContent = "Feriado";
    bFer.addEventListener("click", function(){
      assign("FERIADO");
      saveData(); openDayModal(dateKey); renderGrid();
    });
    btns.appendChild(bFer);

    var bSem = document.createElement("button");
    bSem.className = "small";
    bSem.textContent = "Sem escala";
    bSem.addEventListener("click", function(){
      assign("SEM_ESCALA");
      saveData(); openDayModal(dateKey); renderGrid();
    });
    btns.appendChild(bSem);

    var bClear = document.createElement("button");
    bClear.className = "small ghost";
    bClear.textContent = "Limpar";
    bClear.addEventListener("click", function(){
      assign(null);
      saveData(); openDayModal(dateKey); renderGrid();
    });
    btns.appendChild(bClear);

    row.appendChild(btns);
    return row;
  }

  function openDayModal(dateKey){
    if(typeof guardClosedMonth === "function" && guardClosedMonth(currentMonthKey)) return;
    activeDayKey = dateKey;
    var monthObj = ensureMonth(currentMonthKey);
    var dayObj = monthObj.days[dateKey];
    var dow = dowOfDateKey(dateKey);
    var dayNum = parseInt(dateKey.split("-")[2], 10);
    var single = isSingleShiftDay(dateKey);

    dayTitle.textContent = "Dia " + pad2(dayNum) + " · " + DOW_NAMES[dow];
    document.getElementById("dayNote").value = dayObj.note || "";

    var shiftSelector = document.getElementById("shiftSelector");
    if(single){
      daySub.textContent = "Plantão (fim de semana ou feriado) — escolha o turno de sala (5h) e o valor por hora; o dia soma 5h × o valor. Sem alunos VIP.";
      shiftSelector.style.display = "flex";
      shiftSelector.querySelectorAll("[data-shift]").forEach(function(btn){
        btn.classList.toggle("active", dayObj.shift === btn.getAttribute("data-shift"));
      });
    } else {
      daySub.textContent = "Toque num valor rápido ou digite um valor personalizado.";
      shiftSelector.style.display = "none";
    }

    slotList.innerHTML = "";
    if(single){
      var label = dayObj.shift ? SHIFT_LABELS[dayObj.shift] : "Turno não definido";
      slotList.appendChild(buildSlotRow(dateKey, dayObj, label, 0));
    } else {
      getTimeSlots().forEach(function(label, idx){
        slotList.appendChild(buildSlotRow(dateKey, dayObj, label, idx));
      });
    }

    renderRepeatBox(dateKey);
    dayOverlay.classList.add("open");
  }

  // "Repetir nos proximos": marca outros dias (o dia seguinte e o mesmo dia da semana nas
  // proximas 2 semanas) e copia o que foi lancado neste dia, de uma vez so.
  var repeatPicks = {};
  function renderRepeatBox(dateKey){
    var box = document.getElementById("repeatBox");
    if(!box) return;
    box.innerHTML = "";
    var monthObj = ensureMonth(currentMonthKey);
    var base = new Date(dateKey + "T12:00:00");
    var cands = [];
    [1, 7, 14].forEach(function(n){
      var d = new Date(base.getTime()); d.setDate(d.getDate() + n);
      var k = dateKeyOf(d);
      if(monthObj.days[k]) cands.push(k);
    });
    if(!cands.length) return;
    repeatPicks = {};
    var lab = document.createElement("div"); lab.className = "lb"; lab.textContent = "REPETIR NOS PRÓXIMOS"; box.appendChild(lab);
    var row = document.createElement("div"); row.className = "repeat-chips"; box.appendChild(row);
    var go = document.createElement("button"); go.type = "button"; go.className = "primary repeat-go"; go.style.display = "none"; box.appendChild(go);
    function refresh(){
      var n = Object.keys(repeatPicks).filter(function(k){ return repeatPicks[k]; }).length;
      go.style.display = n ? "" : "none";
      go.textContent = n === 1 ? "Repetir em 1 dia" : "Repetir em " + n + " dias";
    }
    cands.forEach(function(k){
      var d = new Date(k + "T12:00:00");
      var chip = document.createElement("button"); chip.type = "button"; chip.className = "repeat-chip";
      chip.setAttribute("data-date", k);
      chip.textContent = DOW_NAMES[d.getDay()].toUpperCase().slice(0, 3) + " " + pad2(d.getDate());
      chip.addEventListener("click", function(){
        repeatPicks[k] = !repeatPicks[k];
        chip.classList.toggle("on", !!repeatPicks[k]);
        refresh();
      });
      row.appendChild(chip);
    });
    go.addEventListener("click", function(){
      var src = monthObj.days[dateKey], n = 0;
      Object.keys(repeatPicks).forEach(function(k){
        if(!repeatPicks[k] || !monthObj.days[k]) return;
        monthObj.days[k].slots = src.slots.slice();
        monthObj.days[k].shift = src.shift || null;
        n++;
      });
      if(n){ saveData(); renderGrid(); showToast("Repetido em " + n + (n === 1 ? " dia" : " dias")); openDayModal(dateKey); }
    });
  }

  function describeSlot(v){
    if(v === null || v === undefined) return "Vazio";
    if(v === "FERIADO") return "Feriado";
    if(v === "SEM_ESCALA") return "Sem escala";
    return String(v);
  }

  dayOverlay.querySelectorAll("[data-day-action]").forEach(function(btn){
    btn.addEventListener("click", function(){
      if(!activeDayKey) return;
      var monthObj = ensureMonth(currentMonthKey);
      var dayObj = monthObj.days[activeDayKey];
      var action = btn.getAttribute("data-day-action");
      var newVal = action === "feriado" ? "FERIADO" : action === "sem" ? "SEM_ESCALA" : null;
      dayObj.slots = dayObj.slots.map(function(){ return newVal; });
      saveData();
      openDayModal(activeDayKey);
      renderGrid();
    });
  });

  document.getElementById("shiftSelector").querySelectorAll("[data-shift]").forEach(function(btn){
    btn.addEventListener("click", function(){
      if(!activeDayKey) return;
      var monthObj = ensureMonth(currentMonthKey);
      var dayObj = monthObj.days[activeDayKey];
      dayObj.shift = btn.getAttribute("data-shift");
      saveData();
      openDayModal(activeDayKey);
      renderGrid();
    });
  });

  document.getElementById("dayNote").addEventListener("input", function(){
    if(!activeDayKey) return;
    var monthObj = ensureMonth(currentMonthKey);
    var dayObj = monthObj.days[activeDayKey];
    if(dayObj){
      dayObj.note = this.value;
      saveData();
      renderGrid();
    }
  });

  // Procura o objeto de um dia em qualquer mes ja carregado (mesmo que nao seja
  // o mes aberto no momento) — usado por "Repetir semana passada", que pode
  // precisar buscar um dia do mes anterior.
  function findDayObjByDateKey(dateKey){
    var monthKey = dateKey.slice(0, 7);
    var monthObj = data.months[monthKey];
    if(!monthObj) return null;
    return monthObj.days[dateKey] || null;
  }

  document.getElementById("btnCopyLastWeek").addEventListener("click", function(){
    if(!activeDayKey) return;
    var parts = activeDayKey.split("-").map(Number);
    var d = new Date(parts[0], parts[1] - 1, parts[2]);
    d.setDate(d.getDate() - 7);
    var sourceKey = dateKeyOf(d);
    var sourceDay = findDayObjByDateKey(sourceKey);
    if(!sourceDay){
      showToast("Sem dados salvos pra esse dia da semana passada ainda.");
      return;
    }
    var monthObj = ensureMonth(currentMonthKey);
    var dayObj = monthObj.days[activeDayKey];
    dayObj.slots = sourceDay.slots.slice();
    dayObj.shift = sourceDay.shift || null;
    saveData();
    openDayModal(activeDayKey);
    renderGrid();
    showToast("Horário copiado da semana passada");
  });

  document.getElementById("btnCopyToOthers").addEventListener("click", function(){
    if(!activeDayKey) return;
    var input = prompt("Copiar este horário pra quais dias deste mês? (números separados por vírgula, ex: 16,17,18)");
    if(!input) return;
    var monthObj = ensureMonth(currentMonthKey);
    var sourceDay = monthObj.days[activeDayKey];
    var nums = input.split(",").map(function(s){ return parseInt(s.trim(), 10); }).filter(function(n){ return !isNaN(n); });
    var count = 0;
    nums.forEach(function(n){
      var dateKey = currentMonthKey + "-" + pad2(n);
      if(monthObj.days[dateKey]){
        monthObj.days[dateKey].slots = sourceDay.slots.slice();
        monthObj.days[dateKey].shift = sourceDay.shift || null;
        count++;
      }
    });
    if(count > 0){
      saveData();
      renderGrid();
      showToast("Horário copiado pra " + count + " dia(s)");
    } else {
      showToast("Nenhum dia válido encontrado");
    }
  });


// schedule.js — "Escala da equipe": pra academias com coordenador(a), mostra
// quem trabalhou/faltou/foi coberto em cada dia (sobretudo fim de
// semana/feriado, onde a escala muda toda semana) e um relatório rápido de
// "quem ainda não trabalhou fim de semana/feriado este mês". O mesmo card
// (#scheduleCard) é reaproveitado tanto no painel da academia (dono/sócio,
// que só acompanham) quanto na tela individual do coordenador (que também
// edita) — ver mountScheduleCard(), chamado a partir de app.js/bootApp.
"use strict";

var scheduleData = null; // { canManage, staff: [{id,name,role,companyRole}], entries: [...] }
var scheduleMonthKey = null;
var scheduleActiveDateKey = null;

function currentScheduleMonthKey(){
  if(!scheduleMonthKey) scheduleMonthKey = monthKeyNow();
  return scheduleMonthKey;
}

function scheduleMonthDateKeys(monthKey){
  var parts = monthKey.split("-");
  var year = parseInt(parts[0], 10);
  var monthIndex = parseInt(parts[1], 10) - 1;
  var n = daysInMonth(year, monthIndex);
  var keys = [];
  for(var d = 1; d <= n; d++) keys.push(monthKey + "-" + pad2(d));
  return keys;
}

// Reaproveita o mesmo card (markup fixo no companyDashboard no index.html)
// tanto no painel da academia quanto na tela individual do coordenador —
// simplesmente move o elemento pro <main> certo, em vez de duplicar o HTML.
function mountScheduleCard(parentMain){
  var card = document.getElementById("scheduleCard");
  if(!card || !parentMain) return;
  if(card.parentElement !== parentMain) parentMain.appendChild(card);
  card.style.display = "";
}

function shiftScheduleMonth(delta){
  var parts = currentScheduleMonthKey().split("-");
  var year = parseInt(parts[0], 10);
  var monthIndex = parseInt(parts[1], 10) - 1;
  var d = new Date(year, monthIndex + delta, 1);
  loadScheduleMonth(monthKeyOf(d.getFullYear(), d.getMonth()));
}

function loadScheduleMonth(monthKey){
  scheduleMonthKey = monthKey;
  return authFetch("/api/company/schedule?month=" + encodeURIComponent(monthKey)).then(function(res){
    if(res.status === 401){ handleAuthExpired(); throw new Error("auth_expired"); }
    return res.json().then(function(body){ return { ok: res.ok, body: body }; });
  }).then(function(r){
    if(!r.ok) throw new Error("load_failed");
    scheduleData = r.body;
    renderScheduleCalendar();
    renderScheduleWeekendReport();
  }).catch(function(err){
    if(err && err.message === "auth_expired") return;
    console.warn("Falha ao carregar escala da equipe:", err);
  });
}

function scheduleStaffById(id){
  var list = (scheduleData && scheduleData.staff) || [];
  for(var i = 0; i < list.length; i++){ if(list[i].id === id) return list[i]; }
  return null;
}

function renderScheduleCalendar(){
  var table = document.getElementById("scheduleCalendarTable");
  var labelEl = document.getElementById("scheduleMonthLabel");
  if(!table) return;
  var monthKey = currentScheduleMonthKey();
  if(labelEl) labelEl.textContent = monthLabel(monthKey);
  table.innerHTML = "";

  var thead = document.createElement("thead");
  var trHead = document.createElement("tr");
  DOW_NAMES.forEach(function(n){
    var th = document.createElement("th");
    th.className = "timecol";
    th.textContent = n;
    trHead.appendChild(th);
  });
  thead.appendChild(trHead);
  table.appendChild(thead);

  var keys = scheduleMonthDateKeys(monthKey);
  var firstDow = dowOfDateKey(keys[0]);
  var cells = [];
  for(var i = 0; i < firstDow; i++) cells.push(null);
  keys.forEach(function(k){ cells.push(k); });
  while(cells.length % 7 !== 0) cells.push(null);

  var tbody = document.createElement("tbody");
  for(var r = 0; r < cells.length / 7; r++){
    var tr = document.createElement("tr");
    for(var c = 0; c < 7; c++){
      var dateKey = cells[r * 7 + c];
      var td = document.createElement("td");
      td.className = "daycell";
      if(!dateKey){
        td.className += " cell-na";
        tr.appendChild(td);
        continue;
      }
      var dow = dowOfDateKey(dateKey);
      var holidayName = holidaysForDateKey(dateKey);
      if(isWeekendDow(dow) || holidayName) td.className += " weekend";
      var dayNum = parseInt(dateKey.split("-")[2], 10);
      var entriesForDay = ((scheduleData && scheduleData.entries) || []).filter(function(e){ return e.date === dateKey; });
      var summary = "";
      if(entriesForDay.length){
        var worked = entriesForDay.filter(function(e){ return e.status === "trabalhou"; }).length;
        summary = worked + "/" + entriesForDay.length;
      }
      td.innerHTML = "<span class='num'>" + pad2(dayNum) + "</span>" +
        (summary ? "<br><span style='font-size:10px;color:var(--text-dim);'>" + summary + "</span>" : "") +
        (holidayName ? "<br><span style='font-size:9px;color:var(--warn);'>FER</span>" : "");
      td.addEventListener("click", (function(dk){ return function(){ openScheduleDayModal(dk); }; })(dateKey));
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
}

function renderScheduleWeekendReport(){
  var el = document.getElementById("scheduleWeekendReport");
  if(!el) return;
  el.innerHTML = "";
  if(!scheduleData){ return; }
  var counts = {};
  (scheduleData.staff || []).forEach(function(s){ counts[s.id] = 0; });
  (scheduleData.entries || []).forEach(function(entry){
    if(entry.status !== "trabalhou") return;
    var isRelevant = isWeekendDow(dowOfDateKey(entry.date)) || !!holidaysForDateKey(entry.date);
    if(!isRelevant) return;
    if(typeof counts[entry.userId] === "number") counts[entry.userId]++;
  });
  var rows = (scheduleData.staff || []).map(function(s){ return { id: s.id, name: s.name, count: counts[s.id] || 0 }; });
  rows.sort(function(a, b){ return a.count - b.count || a.name.localeCompare(b.name); });
  if(rows.length === 0){
    el.innerHTML = "<p style='font-size:12px;color:var(--text-dim);margin:4px 0;'>Sem profissionais na equipe ainda.</p>";
    return;
  }
  rows.forEach(function(r){
    var row = document.createElement("div");
    row.className = "client-row";
    var info = document.createElement("div");
    info.className = "client-info";
    var name = document.createElement("strong");
    name.textContent = r.name;
    if(r.count === 0) name.style.color = "var(--warn)";
    info.appendChild(name);
    row.appendChild(info);
    var valueEl = document.createElement("div");
    valueEl.className = "client-value";
    valueEl.textContent = r.count + "x";
    row.appendChild(valueEl);
    el.appendChild(row);
  });
}

function populateScheduleUserSelects(){
  var userSel = document.getElementById("scheduleUserSelect");
  var coveredSel = document.getElementById("scheduleCoveredBySelect");
  if(!userSel || !coveredSel) return;
  userSel.innerHTML = "";
  coveredSel.innerHTML = "";
  (scheduleData.staff || []).forEach(function(s){
    var opt1 = document.createElement("option");
    opt1.value = s.id; opt1.textContent = s.name;
    userSel.appendChild(opt1);
    var opt2 = document.createElement("option");
    opt2.value = s.id; opt2.textContent = s.name;
    coveredSel.appendChild(opt2);
  });
}

function updateScheduleCoveredByVisibility(){
  var checked = document.querySelector('input[name="scheduleStatus"]:checked');
  var wrap = document.getElementById("scheduleCoveredByWrap");
  if(wrap) wrap.style.display = (checked && checked.value === "coberto") ? "" : "none";
}

function openScheduleDayModal(dateKey){
  scheduleActiveDateKey = dateKey;
  var titleEl = document.getElementById("scheduleDayTitle");
  var listEl = document.getElementById("scheduleDayList");
  var addWrap = document.getElementById("scheduleDayAddWrap");
  var holidayName = holidaysForDateKey(dateKey);
  var dowName = DOW_NAMES[dowOfDateKey(dateKey)];
  var parts = dateKey.split("-");
  if(titleEl) titleEl.textContent = parts[2] + "/" + parts[1] + " — " + dowName + (holidayName ? " · " + holidayName : "");

  var canManage = !!(scheduleData && scheduleData.canManage);
  var entries = ((scheduleData && scheduleData.entries) || []).filter(function(e){ return e.date === dateKey; });
  if(listEl){
    listEl.innerHTML = "";
    if(entries.length === 0){
      listEl.innerHTML = "<p style='font-size:12px;color:var(--text-dim);margin:4px 0;'>Nada lançado neste dia ainda.</p>";
    }
    entries.forEach(function(entry){
      var staffMember = scheduleStaffById(entry.userId);
      var row = document.createElement("div");
      row.className = "client-row";
      var info = document.createElement("div");
      info.className = "client-info";
      var name = document.createElement("strong");
      name.textContent = staffMember ? staffMember.name : ("Profissional #" + entry.userId);
      var meta = document.createElement("span");
      meta.className = "client-meta";
      var statusLabel = entry.status === "trabalhou" ? "Trabalhou" : (entry.status === "falta" ? "Faltou" : "Coberto");
      if(entry.status === "coberto" && entry.coveredByUserId){
        var coveredBy = scheduleStaffById(entry.coveredByUserId);
        statusLabel += " por " + (coveredBy ? coveredBy.name : ("#" + entry.coveredByUserId));
      }
      meta.textContent = statusLabel + (entry.note ? " · " + entry.note : "");
      info.appendChild(name); info.appendChild(meta);
      row.appendChild(info);
      if(canManage){
        var delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "small bad";
        delBtn.textContent = "Excluir";
        delBtn.addEventListener("click", (function(id){ return function(){ deleteScheduleEntry(id); }; })(entry.id));
        row.appendChild(delBtn);
      }
      listEl.appendChild(row);
    });
  }

  if(addWrap) addWrap.style.display = canManage ? "" : "none";
  if(canManage){
    populateScheduleUserSelects();
    var noteInput = document.getElementById("scheduleNoteInput");
    if(noteInput) noteInput.value = "";
    document.querySelectorAll('input[name="scheduleStatus"]').forEach(function(r){
      r.checked = r.value === "trabalhou";
      r.closest(".client-day-chip").classList.toggle("checked", r.checked);
    });
    updateScheduleCoveredByVisibility();
    var errEl = document.getElementById("scheduleError");
    if(errEl) errEl.textContent = "";
  }
  document.getElementById("scheduleDayOverlay").classList.add("open");
}

function deleteScheduleEntry(id){
  authFetch("/api/company/schedule/" + id, { method: "DELETE" }).then(function(res){
    if(res.status === 401){ handleAuthExpired(); throw new Error("auth_expired"); }
    return loadScheduleMonth(scheduleMonthKey);
  }).then(function(){
    openScheduleDayModal(scheduleActiveDateKey);
  }).catch(function(err){
    if(err && err.message === "auth_expired") return;
    console.warn("Falha ao excluir lançamento da escala:", err);
  });
}

document.querySelectorAll('input[name="scheduleStatus"]').forEach(function(radio){
  radio.addEventListener("change", function(){
    document.querySelectorAll('input[name="scheduleStatus"]').forEach(function(r){
      r.closest(".client-day-chip").classList.toggle("checked", r.checked);
    });
    updateScheduleCoveredByVisibility();
  });
});

var btnScheduleSaveEl = document.getElementById("btnScheduleSave");
if(btnScheduleSaveEl){
  btnScheduleSaveEl.addEventListener("click", function(){
    var errEl = document.getElementById("scheduleError");
    errEl.textContent = "";
    var userId = parseInt(document.getElementById("scheduleUserSelect").value, 10);
    var statusChecked = document.querySelector('input[name="scheduleStatus"]:checked');
    var status = statusChecked ? statusChecked.value : "trabalhou";
    var coveredByUserId = status === "coberto" ? parseInt(document.getElementById("scheduleCoveredBySelect").value, 10) : null;
    var note = document.getElementById("scheduleNoteInput").value.trim();
    if(!userId){ errEl.textContent = "Selecione o profissional."; return; }
    var btn = btnScheduleSaveEl;
    btn.disabled = true; btn.textContent = "Salvando...";
    authFetch("/api/company/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: userId, date: scheduleActiveDateKey, status: status, note: note, coveredByUserId: coveredByUserId })
    }).then(function(res){
      if(res.status === 401){ handleAuthExpired(); throw new Error("auth_expired"); }
      return res.json().then(function(body){ return { ok: res.ok, body: body }; });
    }).then(function(r){
      btn.disabled = false; btn.textContent = "Salvar";
      if(!r.ok){ errEl.textContent = "Não consegui salvar."; return; }
      showToast("Escala atualizada");
      loadScheduleMonth(scheduleMonthKey).then(function(){ openScheduleDayModal(scheduleActiveDateKey); });
    }).catch(function(err){
      if(err && err.message === "auth_expired") return;
      btn.disabled = false; btn.textContent = "Salvar";
      errEl.textContent = "Sem conexão com o servidor.";
      console.warn("Falha ao salvar lançamento da escala:", err);
    });
  });
}

var btnSchedulePrevEl = document.getElementById("btnSchedulePrevMonth");
if(btnSchedulePrevEl) btnSchedulePrevEl.addEventListener("click", function(){ shiftScheduleMonth(-1); });
var btnScheduleNextEl = document.getElementById("btnScheduleNextMonth");
if(btnScheduleNextEl) btnScheduleNextEl.addEventListener("click", function(){ shiftScheduleMonth(1); });

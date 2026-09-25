// account.js — o modal "Minha conta": aparência (tema/cor), horários da
// grade, valores rápidos, lembrete diário, turno de fim de semana, trocar
// senha e zerar os dados da conta.
"use strict";

function updateThemeColorMeta(){
  var meta = document.querySelector('meta[name="theme-color"]');
  if(!meta) return;
  try{
    var bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
    if(bg) meta.setAttribute("content", bg);
  }catch(e){}
}

function applyTheme(theme){
  document.documentElement.setAttribute("data-theme", theme);
  updateThemeColorMeta();
  var btn = document.getElementById("btnTheme");
  if(btn){
    btn.textContent = theme === "light" ? "🌙" : "☀️";
    btn.title = theme === "light" ? "Mudar para tema escuro" : "Mudar para tema claro";
  }
  try{ localStorage.setItem(THEME_KEY, theme); }catch(e){}
}

function initTheme(){
  var saved = "dark";
  try{ saved = localStorage.getItem(THEME_KEY) || "dark"; }catch(e){}
  applyTheme(saved);
  var btn = document.getElementById("btnTheme");
  if(btn){
    btn.addEventListener("click", function(){
      var current = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
      applyTheme(current === "light" ? "dark" : "light");
    });
  }
}

// Tema de cor (independente de claro/escuro): roxo é o padrão original;
// azul/vermelho/verde/rosa/amarelo são a mesma paleta com o matiz rotacionado,
// preservando saturação/luminosidade (ver blocos :root[data-color="..."] no CSS).
// É uma preferência do aparelho (como claro/escuro), não fica salva por conta.
var COLOR_KEY = "pontoOverallColor_v1";
var VALID_COLORS = ["roxo","azul","vermelho","verde","rosa","amarelo"];

function applyColor(color){
  if(VALID_COLORS.indexOf(color) < 0) color = "roxo";
  if(color === "roxo"){
    document.documentElement.removeAttribute("data-color");
  } else {
    document.documentElement.setAttribute("data-color", color);
  }
  try{ localStorage.setItem(COLOR_KEY, color); }catch(e){}
  updateThemeColorMeta();
  var swatches = document.querySelectorAll("#colorSwatches .color-swatch");
  for(var i = 0; i < swatches.length; i++){
    swatches[i].classList.toggle("active", swatches[i].getAttribute("data-color-choice") === color);
  }
}

function initColor(){
  var saved = "roxo";
  try{ saved = localStorage.getItem(COLOR_KEY) || "roxo"; }catch(e){}
  applyColor(saved);
  var wrap = document.getElementById("colorSwatches");
  if(wrap){
    wrap.addEventListener("click", function(e){
      var btn = e.target.closest ? e.target.closest(".color-swatch") : null;
      if(!btn) return;
      applyColor(btn.getAttribute("data-color-choice"));
    });
  }
}

// ---------- lembrete diario ----------
var reminderTimer = null;
var lastReminderShownKey = null; // "AAAA-MM-DD" do ultimo dia que ja avisamos, pra nao repetir

function checkReminder(){
  if(!data.settings.reminderEnabled) return;
  if(!("Notification" in window) || Notification.permission !== "granted") return;
  var now = new Date();
  var hhmm = pad2(now.getHours()) + ":" + pad2(now.getMinutes());
  var todayFull = now.getFullYear() + "-" + pad2(now.getMonth() + 1) + "-" + pad2(now.getDate());
  if(hhmm !== (data.settings.reminderTime || "21:00")) return;
  if(lastReminderShownKey === todayFull) return;
  var monthObj = data.months[todayFull.slice(0, 7)];
  var dayObj = monthObj ? monthObj.days[todayFull] : null;
  var relevantToday = dayObj ? (isSingleShiftDay(todayFull) ? [dayObj.slots[0]] : dayObj.slots) : [];
  var isEmpty = !dayObj || relevantToday.every(function(v){ return v === null || v === undefined; });
  lastReminderShownKey = todayFull;
  if(isEmpty){
    try{
      new Notification("Ponto Overall", {
        body: "Não esqueça de lançar as horas de hoje!",
        icon: "icons/icon-192.png"
      });
    }catch(e){ console.warn("Falha ao mostrar notificação:", e); }
  }
}

function startReminderLoop(){
  clearInterval(reminderTimer);
  reminderTimer = setInterval(checkReminder, 30000); // confere a cada 30s enquanto o app estiver aberto
}

function currentQuickValues(){
  return (data.settings.quickValues && data.settings.quickValues.length) ? data.settings.quickValues : [10, 15];
}

function setQuickValues(nums){
  data.settings.quickValues = nums;
  saveData();
  renderQuickValuesUI();
}

function renderQuickValuesUI(){
  var values = currentQuickValues();
  var label = values.join("/");
  var chipSwatch = document.getElementById("quickValuesChipSwatch");
  var chipSwatchPrint = document.getElementById("quickValuesChipSwatchPrint");
  if(chipSwatch) chipSwatch.textContent = label;
  if(chipSwatchPrint) chipSwatchPrint.textContent = label;

  var qvInput = document.getElementById("quickValuesInput");
  if(qvInput) qvInput.value = values.join(", ");

  var listEl = document.getElementById("quickValuesChipsList");
  if(listEl){
    listEl.innerHTML = "";
    values.forEach(function(v){
      var chip = document.createElement("span");
      chip.className = "qv-chip";
      var text = document.createElement("span");
      text.textContent = v;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "×";
      btn.title = "Remover";
      btn.addEventListener("click", function(){
        var updated = currentQuickValues().filter(function(x){ return x !== v; });
        if(updated.length === 0){ showToast("Precisa ter pelo menos um valor"); return; }
        setQuickValues(updated);
      });
      chip.appendChild(text);
      chip.appendChild(btn);
      listEl.appendChild(chip);
    });
  }
}

document.getElementById("btnQuickValuesChip").addEventListener("click", function(){
  renderQuickValuesUI();
  document.getElementById("newQuickValueInput").value = "";
  document.getElementById("quickValuesOverlay").classList.add("open");
});

document.getElementById("btnAddQuickValue").addEventListener("click", function(){
  var input = document.getElementById("newQuickValueInput");
  var num = parseFloat(String(input.value).replace(",", "."));
  if(isNaN(num) || num <= 0){ showToast("Informe um valor válido"); return; }
  var updated = currentQuickValues().slice();
  if(updated.indexOf(num) < 0) updated.push(num);
  setQuickValues(updated);
  input.value = "";
});

// Horarios da grade de segunda a sexta, editados por seletores de horario
// (inicio/fim), sem precisar digitar texto. O rotulo salvo continua sendo uma
// string "HH:MM–HH:MM" (compativel com tudo que ja usava getTimeSlots()).
function pad2Time(n){ return (n < 10 ? "0" : "") + n; }

function formatSlotLabel(start, end){ return start + "–" + end; }

// Tenta separar um rótulo existente em início/fim pelos formatos de traço
// que já apareceram no app (en dash "–", hífen "-"); se não conseguir
// reconhecer, cai num horário padrão em vez de travar.
function parseSlotLabel(label){
  var parts = String(label || "").split(/[-–—]/).map(function(s){ return s.trim(); });
  var re = /^([0-1]?\d|2[0-3]):([0-5]\d)$/;
  if(parts.length >= 2 && re.test(parts[0]) && re.test(parts[1])){
    return { start: parts[0], end: parts[1] };
  }
  return { start: "08:00", end: "09:00" };
}

function addOneHour(hhmm){
  var m = /^(\d{1,2}):(\d{2})$/.exec(hhmm) || ["", "8", "00"];
  var h = (parseInt(m[1], 10) + 1) % 24;
  return pad2Time(h) + ":" + m[2];
}

function timeSlotsListRowsData(){
  var rows = document.querySelectorAll("#timeSlotsList .time-slot-row");
  var list = [];
  for(var i = 0; i < rows.length; i++){
    var start = rows[i].querySelector(".ts-start").value;
    var end = rows[i].querySelector(".ts-end").value;
    if(!start || !end) continue;
    list.push(formatSlotLabel(start, end));
  }
  return list;
}

function buildTimeSlotRow(start, end){
  var row = document.createElement("div");
  row.className = "time-slot-row";
  row.innerHTML =
    '<input type="time" class="ts-start" value="' + start + '" />' +
    '<span class="ts-sep">–</span>' +
    '<input type="time" class="ts-end" value="' + end + '" />' +
    '<button type="button" class="small ghost ts-remove" title="Remover">🗑</button>';
  row.querySelector(".ts-remove").addEventListener("click", function(){
    row.remove();
  });
  return row;
}

function renderTimeSlotsList(slots){
  var wrap = document.getElementById("timeSlotsList");
  wrap.innerHTML = "";
  slots.forEach(function(label){
    var parsed = parseSlotLabel(label);
    wrap.appendChild(buildTimeSlotRow(parsed.start, parsed.end));
  });
}

document.getElementById("btnAddTimeSlot").addEventListener("click", function(){
  var wrap = document.getElementById("timeSlotsList");
  var rows = wrap.querySelectorAll(".time-slot-row");
  var lastEnd = rows.length ? rows[rows.length - 1].querySelector(".ts-end").value : "";
  var start = lastEnd || "08:00";
  wrap.appendChild(buildTimeSlotRow(start, addOneHour(start)));
});

document.getElementById("btnSaveTimeSlots").addEventListener("click", function(){
  var list = timeSlotsListRowsData();
  if(list.length === 0){
    showToast("Escolha pelo menos um horário");
    return;
  }
  if(list.length > 20){
    showToast("No máximo 20 horários");
    return;
  }
  data.settings.timeSlots = list;
  saveData();
  renderGrid();
  renderVip();
  renderTimeSlotsList(getTimeSlots());
  showToast("Horários da grade atualizados");
});

document.getElementById("btnResetTimeSlots").addEventListener("click", function(){
  data.settings.timeSlots = DEFAULT_TIME_SLOTS.slice();
  saveData();
  renderGrid();
  renderVip();
  renderTimeSlotsList(getTimeSlots());
  showToast("Horários restaurados pro padrão (17h–23h)");
});

document.getElementById("btnSaveQuickValues").addEventListener("click", function(){
  var raw = document.getElementById("quickValuesInput").value;
  var nums = raw.split(",").map(function(s){ return parseFloat(s.trim()); }).filter(function(n){ return !isNaN(n) && n > 0; });
  if(nums.length === 0){
    showToast("Informe pelo menos um valor válido");
    return;
  }
  setQuickValues(nums);
  showToast("Valores rápidos atualizados");
});

// Wiring do modal "Minha conta" em si (abrir com os campos atuais, trocar
// senha, zerar dados) — chamado uma vez no boot do app, separado do wiring
// de login/cadastro que fica em auth.js.
function initAccountModal(){
  document.getElementById("btnAccount").addEventListener("click", function(){
    if(!currentUser) return;
    document.getElementById("accountSub").textContent =
      currentUser.name + (currentUser.role ? " · " + currentUser.role : "") + " · " + currentUser.email;
    document.getElementById("pwError").textContent = "";
    document.getElementById("pwSuccess").textContent = "";
    document.getElementById("pwForm").reset();
    document.getElementById("quickValuesInput").value = (data.settings.quickValues || [10, 15]).join(", ");
    renderTimeSlotsList(getTimeSlots());
    document.getElementById("reminderEnabled").checked = !!data.settings.reminderEnabled;
    document.getElementById("reminderTime").value = data.settings.reminderTime || "21:00";
    document.getElementById("weekendShiftEnabled").checked = !!data.settings.weekendShiftEnabled;
    document.getElementById("accountOverlay").classList.add("open");
  });

  document.getElementById("weekendShiftEnabled").addEventListener("change", function(){
    data.settings.weekendShiftEnabled = this.checked;
    saveData();
    renderGrid();
    showToast(this.checked ? "Turno de fim de semana ativado" : "Turno de fim de semana desativado");
  });

  document.getElementById("reminderEnabled").addEventListener("change", function(){
    var checkbox = this;
    if(!checkbox.checked){
      data.settings.reminderEnabled = false;
      saveData();
      showToast("Lembrete desativado");
      return;
    }
    if(!("Notification" in window)){
      showToast("Seu navegador não suporta notificações.");
      checkbox.checked = false;
      return;
    }
    if(Notification.permission === "granted"){
      data.settings.reminderEnabled = true;
      saveData();
      showToast("Lembrete ativado!");
      return;
    }
    Notification.requestPermission().then(function(perm){
      if(perm !== "granted"){
        checkbox.checked = false;
        showToast("Permissão de notificação negada.");
        return;
      }
      data.settings.reminderEnabled = true;
      saveData();
      showToast("Lembrete ativado!");
    });
  });

  document.getElementById("reminderTime").addEventListener("change", function(){
    data.settings.reminderTime = this.value || "21:00";
    saveData();
    lastReminderShownKey = null; // permite avisar hoje de novo no horario atualizado
  });

  document.getElementById("pwForm").addEventListener("submit", function(e){
    e.preventDefault();
    var errEl = document.getElementById("pwError");
    var okEl = document.getElementById("pwSuccess");
    errEl.textContent = ""; okEl.textContent = "";
    var currentPassword = document.getElementById("pwCurrent").value;
    var newPassword = document.getElementById("pwNew").value;
    var btn = document.getElementById("pwSubmit");
    btn.disabled = true; btn.textContent = "Trocando...";
    authFetch("/api/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: currentPassword, newPassword: newPassword })
    }).then(function(res){
      return res.json().then(function(body){ return { ok: res.ok, body: body }; });
    }).then(function(r){
      btn.disabled = false; btn.textContent = "Trocar senha";
      if(!r.ok){
        errEl.textContent = authErrorMessage(r.body, "Não consegui trocar a senha.");
        return;
      }
      okEl.textContent = "Senha alterada com sucesso.";
      document.getElementById("pwForm").reset();
    }).catch(function(err){
      btn.disabled = false; btn.textContent = "Trocar senha";
      errEl.textContent = "Sem conexão com o servidor. Tente novamente.";
      console.warn("Falha ao trocar senha:", err);
    });
  });

  document.getElementById("btnLogout").addEventListener("click", function(){
    logout();
  });

  // Zera os dados da conta atual (mantido pra corrigir contas que vieram com
  // dados de outra pessoa por causa do antigo esquema de migracao local, e
  // como opcao de "recomecar do zero" pra qualquer conta).
  document.getElementById("btnResetAllData").addEventListener("click", function(){
    if(!confirm("Isso vai apagar TODOS os dados desta conta (meses, valores, alunos VIP e particulares) e começar do zero. Não pode ser desfeito. Continuar?")) return;
    data = defaultData();
    initMonthState();
    saveData();
    renderMonthSelect();
    renderGrid();
    renderVip();
    document.getElementById("accountOverlay").classList.remove("open");
    showToast("Dados apagados. Começando do zero.");
  });
}

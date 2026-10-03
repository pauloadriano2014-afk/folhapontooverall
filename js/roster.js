// roster.js — escala PLANEJADA por turno e avisos.
//  - Coordenador/gerente/dono: monta quem faz cada turno (ex.: estagiario 8-13,
//    estagiario 13-18, professor 10-14) nos fins de semana e feriados, ajusta os
//    horarios dos turnos e PUBLICA o mes (quem foi afetado e avisado).
//  - Socio(a): so acompanha o rascunho.
//  - Equipe (professor/estagiario): ve so a escala PUBLICADA e recebe avisos.
// O registro "quem trabalhou/faltou/foi coberto" continua em schedule.js.
"use strict";

var rosterData = null;      // resposta de GET /api/company/roster
var rosterMonthKey = null;
var rosterActiveDate = null;
var myRosterMonthKey = null;

function rosterMonth(){ if(!rosterMonthKey) rosterMonthKey = monthKeyNow(); return rosterMonthKey; }
function myRosterMonth(){ if(!myRosterMonthKey) myRosterMonthKey = monthKeyNow(); return myRosterMonthKey; }

function shiftMonthKey(key, delta){
  var p = key.split("-");
  var d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1 + delta, 1);
  return monthKeyOf(d.getFullYear(), d.getMonth());
}

function dateLabelBr(dateKey){
  return DOW_NAMES[dowOfDateKey(dateKey)].toLowerCase() + " " + dateKey.slice(8, 10) + "/" + dateKey.slice(5, 7);
}

function shiftHours(t){ return t.startTime + "–" + t.endTime; }

function roleIsTrainee(role){
  return String(role || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").indexOf("estagi") >= 0;
}
function shiftAllows(kind, role){
  if(kind === "estagiario") return roleIsTrainee(role);
  if(kind === "professor") return !roleIsTrainee(role);
  return true;
}

function mountRosterCard(parentMain){
  var card = document.getElementById("rosterCard");
  if(!card || !parentMain) return;
  var teamCard = document.getElementById("coordTeamCard");
  if(teamCard){
    if(teamCard.parentElement !== parentMain) parentMain.appendChild(teamCard);
    teamCard.style.display = "";
  }
  var registry = document.getElementById("scheduleCard");
  if(registry && registry.parentElement === parentMain) parentMain.insertBefore(card, registry);
  else if(card.parentElement !== parentMain) parentMain.appendChild(card);
  card.style.display = "";
}

function rosterErr(el, r, fallback){
  el.textContent = (r && r.body && r.body.message) ? r.body.message : fallback;
}

// ---------- montagem (coordenador / gerente / dono / socio) ----------
function loadRoster(){
  var table = document.getElementById("rosterCalendarTable");
  if(!table || !authToken) return;
  var month = rosterMonth();
  document.getElementById("rosterMonthLabel").textContent = monthLabel(month);
  authFetch("/api/company/roster?month=" + encodeURIComponent(month)).then(function(res){
    if(res.status === 401){ handleAuthExpired(); throw new Error("auth_expired"); }
    return res.json().then(function(body){ return { ok: res.ok, body: body }; });
  }).then(function(r){
    if(!r.ok){ document.getElementById("rosterPubStatus").textContent = (r.body && r.body.message) || "Não consegui carregar a escala."; return; }
    rosterData = r.body;
    renderRoster();
    if(document.getElementById("rosterDayOverlay").classList.contains("open") && rosterActiveDate && !rosterDraft) renderRosterDay();
  }).catch(function(err){
    if(err && err.message === "auth_expired") return;
    document.getElementById("rosterPubStatus").textContent = "Sem conexão com o servidor.";
  });
}

function rosterEntriesOn(dateKey){
  return ((rosterData && rosterData.entries) || []).filter(function(e){ return e.date === dateKey; });
}
function rosterStaffName(id){
  var s = ((rosterData && rosterData.staff) || []).filter(function(x){ return x.id === id; })[0];
  return s ? s.name : "?";
}

function renderRoster(){
  if(!rosterData) return;
  var types = rosterData.shiftTypes || [];
  var month = rosterMonth();
  var canManage = !!rosterData.canManage;

  // estado da publicacao
  var pub = rosterData.publication || {};
  var statusEl = document.getElementById("rosterPubStatus");
  var btn = document.getElementById("btnRosterPublish");
  var when = pub.publishedAt ? new Date(pub.publishedAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "";
  statusEl.className = "pill " + (!pub.published ? "pill-off" : (pub.changedSincePublish ? "pill-warn" : "pill-ok"));
  statusEl.textContent = !pub.published ? "Rascunho — a equipe ainda não vê esta escala"
    : (pub.changedSincePublish ? "Publicada em " + when + ", com alterações ainda não publicadas" : "Publicada em " + when);
  btn.style.display = canManage ? "" : "none";
  btn.disabled = !!(pub.published && !pub.changedSincePublish);
  btn.textContent = pub.published ? (pub.changedSincePublish ? "Publicar alterações" : "Publicada ✓") : "Publicar escala de " + monthLabel(month).split(" / ")[0];
  document.getElementById("btnRosterShifts").style.display = canManage ? "" : "none";

  // legenda dos turnos
  var legend = document.getElementById("rosterLegend");
  legend.innerHTML = "";
  types.forEach(function(t){
    var chip = document.createElement("span");
    chip.className = "roster-legend-chip";
    chip.textContent = t.name + " · " + shiftHours(t);
    legend.appendChild(chip);
  });

  // calendario
  var table = document.getElementById("rosterCalendarTable");
  table.innerHTML = "";
  var thead = document.createElement("thead"), trh = document.createElement("tr");
  DOW_NAMES.forEach(function(n){ var th = document.createElement("th"); th.className = "timecol"; th.textContent = n; trh.appendChild(th); });
  thead.appendChild(trh); table.appendChild(thead);
  var keys = scheduleMonthDateKeys(month);
  var cells = [];
  for(var i = 0; i < dowOfDateKey(keys[0]); i++) cells.push(null);
  keys.forEach(function(k){ cells.push(k); });
  while(cells.length % 7 !== 0) cells.push(null);
  var tbody = document.createElement("tbody");
  for(var r = 0; r < cells.length / 7; r++){
    var tr = document.createElement("tr");
    for(var c = 0; c < 7; c++){
      var dk = cells[r * 7 + c];
      var td = document.createElement("td");
      td.className = "daycell";
      if(!dk){ td.className += " cell-na"; tr.appendChild(td); continue; }
      var holiday = holidaysForDateKey(dk);
      var special = isWeekendDow(dowOfDateKey(dk)) || !!holiday;
      if(special) td.className += " weekend";
      var entries = rosterEntriesOn(dk);
      var filled = {};
      entries.forEach(function(e){ filled[e.shiftTypeId] = true; });
      var nFilled = Object.keys(filled).length;
      var html = "<span class='num'>" + pad2(parseInt(dk.slice(8), 10)) + "</span>";
      if(special || entries.length){
        var cls = nFilled >= types.length && types.length ? "roster-full" : "roster-gap";
        html += "<br><span class='roster-count " + cls + "'>" + nFilled + "/" + types.length + "</span>";
      }
      if(holiday) html += "<br><span style='font-size:9px;color:var(--warn);'>FER</span>";
      td.innerHTML = html;
      td.addEventListener("click", (function(d){ return function(){ openRosterDay(d); }; })(dk));
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  // equilibrio: quantos plantoes cada pessoa tem no mes
  var counts = {};
  rosterData.entries.forEach(function(e){ counts[e.userId] = (counts[e.userId] || 0) + 1; });
  var rows = (rosterData.staff || []).map(function(s){ return { name: s.name, count: counts[s.id] || 0 }; });
  rows.sort(function(a, b){ return b.count - a.count || a.name.localeCompare(b.name); });
  var load = document.getElementById("rosterLoad");
  load.innerHTML = "";
  rows.forEach(function(row){
    var chip = document.createElement("span");
    chip.className = "roster-load-chip" + (row.count === 0 ? " zero" : "");
    chip.title = row.name + ": " + row.count + (row.count === 1 ? " plantão" : " plantões") + " neste mês";
    var nm = document.createElement("span");
    nm.textContent = row.name.split(" ")[0];
    var n = document.createElement("b");
    n.textContent = row.count;
    chip.appendChild(nm); chip.appendChild(n);
    load.appendChild(chip);
  });
}

var rosterDraft = null; // {shiftTypeId: [userId]} — rascunho do dia, so grava ao salvar

function openRosterDay(dateKey){
  rosterActiveDate = dateKey;
  rosterDraft = null;
  renderRosterDay();
  document.getElementById("rosterDayOverlay").classList.add("open");
}

function hmToMin(t){ var p = String(t || "0:0").split(":"); return parseInt(p[0], 10) * 60 + parseInt(p[1], 10); }
function shiftsOverlap(a, b){ return hmToMin(a.startTime) < hmToMin(b.endTime) && hmToMin(b.startTime) < hmToMin(a.endTime); }

function rosterDraftInit(dk){
  rosterDraft = {};
  (rosterData.shiftTypes || []).forEach(function(t){ rosterDraft[t.id] = []; });
  rosterEntriesOn(dk).forEach(function(e){ if(rosterDraft[e.shiftTypeId]) rosterDraft[e.shiftTypeId].push(e.userId); });
}

// diferenca entre o rascunho e o que ja esta salvo
function rosterDraftDiff(dk){
  var saved = rosterEntriesOn(dk), adds = [], removes = [];
  saved.forEach(function(e){ if((rosterDraft[e.shiftTypeId] || []).indexOf(e.userId) < 0) removes.push(e); });
  Object.keys(rosterDraft).forEach(function(tid){
    rosterDraft[tid].forEach(function(uid){
      var has = saved.some(function(e){ return e.shiftTypeId === parseInt(tid, 10) && e.userId === uid; });
      if(!has) adds.push({ shiftTypeId: parseInt(tid, 10), userId: uid });
    });
  });
  return { adds: adds, removes: removes };
}

function renderRosterDay(){
  var dk = rosterActiveDate;
  var holiday = holidaysForDateKey(dk);
  var canManage = !!rosterData.canManage;
  if(!rosterDraft) rosterDraftInit(dk);
  document.getElementById("rosterDayTitle").textContent = dateLabelBr(dk);
  document.getElementById("rosterDaySub").textContent = holiday ? "Feriado: " + holiday : (canManage ? "Escolha as pessoas de cada turno e salve uma vez só." : "Escala deste dia (só consulta).");
  var wrap = document.getElementById("rosterDayShifts");
  wrap.innerHTML = "";
  var types = rosterData.shiftTypes || [];
  types.forEach(function(t){
    var box = document.createElement("div");
    box.className = "roster-shift";
    var head = document.createElement("div");
    head.className = "roster-shift-head";
    head.innerHTML = "<strong></strong><span></span>";
    head.querySelector("strong").textContent = t.name;
    head.querySelector("span").textContent = shiftHours(t);
    box.appendChild(head);
    var mine = rosterDraft[t.id] || [];
    var list = document.createElement("div");
    list.className = "roster-people";
    if(mine.length === 0){
      var empty = document.createElement("span");
      empty.className = "roster-empty";
      empty.textContent = "Ninguém escalado";
      list.appendChild(empty);
    }
    mine.forEach(function(uid){
      var chip = document.createElement("span");
      chip.className = "roster-person";
      chip.appendChild(document.createTextNode(rosterStaffName(uid)));
      if(canManage){
        var x = document.createElement("button");
        x.type = "button"; x.className = "roster-x"; x.title = "Tirar da escala"; x.textContent = "✕";
        x.addEventListener("click", function(){
          rosterDraft[t.id] = rosterDraft[t.id].filter(function(id){ return id !== uid; });
          renderRosterDay();
        });
        chip.appendChild(x);
      }
      list.appendChild(chip);
    });
    box.appendChild(list);
    if(canManage){
      var candidates = (rosterData.staff || []).filter(function(st){
        if(mine.indexOf(st.id) >= 0 || !shiftAllows(t.kind, st.role)) return false;
        // quem ja esta num turno que se sobrepoe a este, no mesmo dia, nao entra de novo
        return !types.some(function(o){ return o.id !== t.id && shiftsOverlap(o, t) && (rosterDraft[o.id] || []).indexOf(st.id) >= 0; });
      });
      var sel = document.createElement("select");
      var o0 = document.createElement("option"); o0.value = ""; o0.textContent = candidates.length ? "+ Adicionar pessoa…" : "Ninguém disponível para este turno";
      sel.appendChild(o0);
      candidates.forEach(function(st){ var o = document.createElement("option"); o.value = st.id; o.textContent = st.name; sel.appendChild(o); });
      sel.disabled = candidates.length === 0;
      sel.addEventListener("change", function(){
        if(!sel.value) return;
        rosterDraft[t.id].push(parseInt(sel.value, 10));
        renderRosterDay();
      });
      var row = document.createElement("div");
      row.className = "roster-add";
      row.appendChild(sel);
      box.appendChild(row);
    }
    wrap.appendChild(box);
  });
  var foot = document.getElementById("rosterDayFoot");
  if(foot){
    foot.style.display = canManage ? "" : "none";
    var diff = rosterDraftDiff(dk), n = diff.adds.length + diff.removes.length;
    var btn = document.getElementById("btnRosterDaySave");
    btn.disabled = n === 0;
    btn.textContent = n === 0 ? "Nada para salvar" : "Salvar escala do dia (" + n + (n === 1 ? " alteração)" : " alterações)");
    document.getElementById("rosterDayError").textContent = "";
  }
}

(function(){
  var btn = document.getElementById("btnRosterDaySave");
  if(!btn) return;
  btn.addEventListener("click", function(){
    var dk = rosterActiveDate, diff = rosterDraftDiff(dk), err = document.getElementById("rosterDayError");
    err.textContent = "";
    btn.disabled = true; btn.textContent = "Salvando…";
    var steps = diff.removes.map(function(e){ return function(){ return authFetch("/api/company/roster/entries/" + e.id, { method: "DELETE" }).then(function(res){ return { ok: res.ok, body: {} }; }); }; })
      .concat(diff.adds.map(function(a){ return function(){
        return authFetch("/api/company/roster/entries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: dk, shiftTypeId: a.shiftTypeId, userId: a.userId }) })
          .then(function(res){ return res.json().then(function(b){ return { ok: res.ok, body: b }; }); });
      }; }));
    var failed = null;
    steps.reduce(function(p, step){
      return p.then(function(){ if(failed) return; return step().then(function(r){ if(!r.ok) failed = r; }); });
    }, Promise.resolve()).then(function(){
      rosterDraft = null;
      return authFetch("/api/company/roster?month=" + encodeURIComponent(rosterMonth())).then(function(res){ return res.json(); }).then(function(b){
        rosterData = b; renderRoster(); renderRosterDay();
        if(failed){ rosterErr(document.getElementById("rosterDayError"), failed, "Não consegui salvar tudo."); }
        else { showToast("Escala do dia salva."); document.getElementById("rosterDayOverlay").classList.remove("open"); }
      });
    }).catch(function(){ err.textContent = "Sem conexão com o servidor."; btn.disabled = false; });
  });
})();

document.getElementById("btnRosterPrev").addEventListener("click", function(){ rosterMonthKey = shiftMonthKey(rosterMonth(), -1); loadRoster(); });
document.getElementById("btnRosterNext").addEventListener("click", function(){ rosterMonthKey = shiftMonthKey(rosterMonth(), 1); loadRoster(); });

document.getElementById("btnRosterPublish").addEventListener("click", function(){
  var pub = (rosterData && rosterData.publication) || {};
  var name = monthLabel(rosterMonth()).split(" / ")[0];
  var msg = pub.published
    ? "Publicar as alterações da escala de " + name + "? Só quem teve mudança será avisado."
    : "Publicar a escala de " + name + "? A equipe passa a ver e as pessoas escaladas são avisadas.";
  if(!confirm(msg)) return;
  var btn = document.getElementById("btnRosterPublish");
  btn.disabled = true;
  authFetch("/api/company/roster/publish", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month: rosterMonth() })
  }).then(function(res){ return res.json().then(function(b){ return { ok: res.ok, body: b }; }); })
    .then(function(r){
      if(!r.ok){ showToast((r.body && r.body.message) || "Não consegui publicar."); btn.disabled = false; return; }
      showToast(r.body.unchanged ? "Nada mudou desde a última publicação." : "Escala publicada. " + r.body.notified + " pessoa(s) avisada(s).");
      loadRoster();
    }).catch(function(){ showToast("Sem conexão com o servidor."); btn.disabled = false; });
});

// ---------- turnos e horarios ----------
var KIND_LABELS = { estagiario: "Estagiário", professor: "Professor", any: "Qualquer pessoa" };

function renderShiftTypesEditor(){
  var wrap = document.getElementById("shiftTypesList");
  wrap.innerHTML = "";
  var errEl = document.getElementById("shiftTypesError");
  errEl.textContent = "";
  var types = (rosterData && rosterData.shiftTypes) || [];
  function rowFor(t){
    var row = document.createElement("div");
    row.className = "shift-edit";
    var name = document.createElement("input"); name.type = "text"; name.value = t ? t.name : ""; name.placeholder = "Nome do turno"; name.maxLength = 40;
    var start = document.createElement("input"); start.type = "time"; start.value = t ? t.startTime : "08:00";
    var end = document.createElement("input"); end.type = "time"; end.value = t ? t.endTime : "13:00";
    var kind = document.createElement("select");
    Object.keys(KIND_LABELS).forEach(function(k){ var o = document.createElement("option"); o.value = k; o.textContent = KIND_LABELS[k]; kind.appendChild(o); });
    kind.value = t ? t.kind : "any";
    var save = document.createElement("button"); save.type = "button"; save.className = "small primary"; save.textContent = t ? "Salvar" : "Criar turno";
    row.appendChild(name);
    var times = document.createElement("div"); times.className = "shift-times"; times.appendChild(start); times.appendChild(document.createTextNode("–")); times.appendChild(end);
    row.appendChild(times); row.appendChild(kind);
    var actions = document.createElement("div"); actions.className = "row-actions"; actions.style.marginTop = "0";
    actions.appendChild(save);
    save.addEventListener("click", function(){
      errEl.textContent = "";
      authFetch(t ? "/api/company/shift-types/" + t.id : "/api/company/shift-types", {
        method: t ? "PUT" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.value, startTime: start.value, endTime: end.value, kind: kind.value })
      }).then(function(res){ return res.json().then(function(b){ return { ok: res.ok, body: b }; }); })
        .then(function(r){
          if(!r.ok){ rosterErr(errEl, r, "Não consegui salvar o turno."); return; }
          showToast(t ? "Turno salvo" : "Turno criado");
          authFetch("/api/company/roster?month=" + encodeURIComponent(rosterMonth())).then(function(rr){ return rr.json(); }).then(function(b){ rosterData = b; renderRoster(); renderShiftTypesEditor(); });
        }).catch(function(){ errEl.textContent = "Sem conexão com o servidor."; });
    });
    if(t){
      var del = document.createElement("button"); del.type = "button"; del.className = "small bad"; del.textContent = "Excluir";
      del.addEventListener("click", function(){
        if(!confirm("Excluir o turno \"" + t.name + "\"? Isso também tira as pessoas escaladas nele.")) return;
        authFetch("/api/company/shift-types/" + t.id, { method: "DELETE" }).then(function(){
          authFetch("/api/company/roster?month=" + encodeURIComponent(rosterMonth())).then(function(rr){ return rr.json(); }).then(function(b){ rosterData = b; renderRoster(); renderShiftTypesEditor(); });
        });
      });
      actions.appendChild(del);
    }
    row.appendChild(actions);
    return row;
  }
  types.forEach(function(t){ wrap.appendChild(rowFor(t)); });
  var h = document.createElement("h3"); h.textContent = "Novo turno"; h.style.marginTop = "16px"; wrap.appendChild(h);
  wrap.appendChild(rowFor(null));
}

document.getElementById("btnRosterShifts").addEventListener("click", function(){
  renderShiftTypesEditor();
  document.getElementById("shiftTypesOverlay").classList.add("open");
});

// ---------- minha escala (equipe) ----------
function loadMyRoster(){
  if(!document.getElementById("myRosterCard") || !authToken) return;
  var month = myRosterMonth();
  document.getElementById("myRosterMonthLabel").textContent = monthLabel(month);
  var status = document.getElementById("myRosterStatus"), mineEl = document.getElementById("myRosterMine"), teamEl = document.getElementById("myRosterTeam");
  authFetch("/api/me/roster?month=" + encodeURIComponent(month)).then(function(res){
    if(res.status === 401){ handleAuthExpired(); throw new Error("auth_expired"); }
    return res.json().then(function(body){ return { ok: res.ok, body: body }; });
  }).then(function(r){
    mineEl.innerHTML = ""; teamEl.innerHTML = ""; status.textContent = "";
    if(!r.ok){ status.textContent = (r.body && r.body.message) || "Não consegui carregar a escala."; return; }
    var d = r.body;
    if(!d.published){
      status.innerHTML = "";
      var p = document.createElement("p"); p.className = "account-section-hint";
      p.textContent = "A escala de " + monthLabel(month).split(" / ")[0] + " ainda não foi publicada pela coordenação. Quando for, você recebe um aviso.";
      status.appendChild(p);
      return;
    }
    var types = {}; d.shiftTypes.forEach(function(t){ types[t.id] = t; });
    var mine = d.entries.filter(function(e){ return e.userId === d.me; });
    var today = todayFullKey;
    if(mine.length === 0){
      var none = document.createElement("p"); none.className = "account-section-hint"; none.textContent = "Você não está escalado(a) neste mês."; mineEl.appendChild(none);
    }
    var nextShown = false;
    mine.forEach(function(e){
      var t = types[e.shiftTypeId];
      var line = document.createElement("div");
      line.className = "roster-mine";
      var isNext = !nextShown && e.date >= today;
      if(isNext){ nextShown = true; line.classList.add("roster-next"); }
      line.innerHTML = "<strong></strong><span></span>" + (isNext ? "<em>próximo</em>" : "");
      line.querySelector("strong").textContent = dateLabelBr(e.date);
      line.querySelector("span").textContent = t.name + " · " + shiftHours(t);
      mineEl.appendChild(line);
    });
    // equipe do mes, por dia
    var byDate = {};
    d.entries.forEach(function(e){ (byDate[e.date] = byDate[e.date] || []).push(e); });
    Object.keys(byDate).sort().forEach(function(date){
      var day = document.createElement("div");
      day.className = "roster-day";
      var title = document.createElement("strong");
      var hol = holidaysForDateKey(date);
      title.textContent = dateLabelBr(date) + (hol ? " · feriado" : "");
      day.appendChild(title);
      d.shiftTypes.forEach(function(t){
        var who = byDate[date].filter(function(e){ return e.shiftTypeId === t.id; });
        if(!who.length) return;
        var li = document.createElement("div");
        li.className = "roster-day-line";
        var lab = document.createElement("span"); lab.textContent = t.name + " (" + shiftHours(t) + ")";
        var names = document.createElement("span");
        names.textContent = who.map(function(e){ return e.userName + (e.userId === d.me ? " (você)" : ""); }).join(", ");
        if(who.some(function(e){ return e.userId === d.me; })) names.style.fontWeight = "800";
        li.appendChild(lab); li.appendChild(names); day.appendChild(li);
      });
      teamEl.appendChild(day);
    });
    if(!Object.keys(byDate).length){
      var e0 = document.createElement("p"); e0.className = "account-section-hint"; e0.textContent = "Ninguém foi escalado neste mês."; teamEl.appendChild(e0);
    }
  }).catch(function(err){
    if(err && err.message === "auth_expired") return;
    status.textContent = "Sem conexão com o servidor.";
  });
}
document.getElementById("btnMyRosterPrev").addEventListener("click", function(){ myRosterMonthKey = shiftMonthKey(myRosterMonth(), -1); loadMyRoster(); });
document.getElementById("btnMyRosterNext").addEventListener("click", function(){ myRosterMonthKey = shiftMonthKey(myRosterMonth(), 1); loadMyRoster(); });

// ---------- avisos ----------
var noticeTimer = null;

function setNoticeBadge(n){
  var b = document.getElementById("avisosBadge");
  if(!b) return;
  b.textContent = n > 9 ? "9+" : String(n);
  b.hidden = !(n > 0);
}

function refreshNoticeBadge(){
  if(!authToken || !currentUser || !currentUser.companyId) return;
  authFetch("/api/me/notifications").then(function(res){ return res.ok ? res.json() : null; })
    .then(function(b){ if(b) setNoticeBadge(b.unread); }).catch(function(){});
}

function loadNotices(){
  if(!authToken) return;
  authFetch("/api/me/notifications").then(function(res){
    if(res.status === 401){ handleAuthExpired(); throw new Error("auth_expired"); }
    return res.json();
  }).then(function(b){
    document.querySelectorAll(".notices-body").forEach(function(box){
      box.innerHTML = "";
      if(!b.items.length){
        var e = document.createElement("p"); e.className = "account-section-hint"; e.textContent = "Nenhum aviso por enquanto. Quando a coordenação publicar ou mudar a escala, você é avisado aqui."; box.appendChild(e); return;
      }
      b.items.forEach(function(n){
        var item = document.createElement("div");
        item.className = "notice" + (n.read ? "" : " notice-new");
        var t = document.createElement("strong"); t.textContent = n.title;
        var body = document.createElement("div"); body.className = "notice-body"; body.textContent = n.body;
        var when = document.createElement("span"); when.className = "client-meta";
        when.textContent = new Date(n.createdAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
        item.appendChild(t); item.appendChild(body); item.appendChild(when);
        box.appendChild(item);
      });
    });
    if(b.unread > 0){
      // abrir a tela de avisos conta como ler: zera o selo, mantendo o destaque desta visita
      authFetch("/api/me/notifications/read", { method: "POST" }).then(function(){ setNoticeBadge(0); });
    }
  }).catch(function(err){ if(!(err && err.message === "auth_expired")) console.warn("Falha ao carregar avisos:", err); });
}

function startNoticePolling(){
  clearInterval(noticeTimer);
  refreshNoticeBadge();
  noticeTimer = setInterval(function(){ if(!document.hidden) refreshNoticeBadge(); }, 120000);
}
document.addEventListener("visibilitychange", function(){ if(!document.hidden) refreshNoticeBadge(); });


// ---------- Minha equipe (coordenador): quem esta vinculado, sem valores ----------
var coordTeamMonthKey = null;
function coordTeamMonth(){ if(!coordTeamMonthKey) coordTeamMonthKey = monthKeyNow(); return coordTeamMonthKey; }

function loadCoordTeam(){
  var list = document.getElementById("coordTeamList");
  if(!list || !authToken) return;
  var month = coordTeamMonth();
  document.getElementById("coordTeamMonthLabel").textContent = monthLabel(month);
  document.getElementById("coordTeamMonth").textContent = monthLabel(month);
  var h2 = document.querySelector("#coordTeamCard h2");
  if(h2 && h2.firstChild) h2.firstChild.textContent = (typeof isCompanyAdminView === "function" && isCompanyAdminView() ? "Horários e plantões" : "Minha equipe") + " — ";
  function get(url){
    return authFetch(url).then(function(res){
      if(res.status === 401){ handleAuthExpired(); throw new Error("auth_expired"); }
      return res.json().then(function(b){ if(!res.ok) throw new Error("load_failed"); return b; });
    });
  }
  Promise.all([
    get("/api/company/schedule?month=" + encodeURIComponent(month)),
    get("/api/company/roster?month=" + encodeURIComponent(month))
  ]).then(function(r){ renderCoordTeam(r[0], r[1]); }).catch(function(err){
    if(err && err.message === "auth_expired") return;
    list.innerHTML = "<p class='account-section-hint'>Não consegui carregar a equipe agora.</p>";
  });
}

function renderCoordTeam(sched, roster){
  var list = document.getElementById("coordTeamList");
  list.innerHTML = "";
  var types = {};
  (roster.shiftTypes || []).forEach(function(t){ types[t.id] = t; });
  var staff = (sched.staff || []).filter(function(u){ return u.companyRole !== "coordinator"; });
  if(!staff.length){
    list.innerHTML = "<p class='account-section-hint'>Ainda não há ninguém vinculado. Convide a equipe pela gerência.</p>";
    return;
  }
  staff.forEach(function(u){
    var plant = (roster.entries || []).filter(function(e){ return e.userId === u.id; }).sort(function(a, b){ return a.date < b.date ? -1 : 1; });
    var att = { trabalhou: 0, falta: 0, coberto: 0 };
    (sched.entries || []).forEach(function(e){ if(e.userId === u.id && att[e.status === "falta" ? "falta" : e.status] !== undefined) att[e.status === "falta" ? "falta" : e.status]++; });
    var row = document.createElement("div");
    row.className = "client-row team-member";
    var info = document.createElement("div");
    info.className = "client-info";
    var name = document.createElement("strong");
    name.textContent = u.name;
    var pill = document.createElement("span");
    pill.className = "pill pill-off";
    pill.style.marginLeft = "8px";
    pill.textContent = roleIsTrainee(u.role) ? "Estagiário" : "Professor";
    name.appendChild(pill);
    info.appendChild(name);
    function line(text){ var sp = document.createElement("span"); sp.className = "client-meta"; sp.style.display = "block"; sp.textContent = text; info.appendChild(sp); }
    line((u.email && !/\.invalid$/.test(u.email)) ? u.email : "Sem login (cadastro de teste)");
    line("Horário seg–sex: " + (u.shiftStart && u.shiftEnd ? u.shiftStart + " às " + u.shiftEnd : "ainda não definido"));
    if(plant.length){
      line("Plantões planejados (" + plant.length + "): " + plant.map(function(e){
        var t = types[e.shiftTypeId];
        return e.date.slice(8, 10) + "/" + e.date.slice(5, 7) + (t ? " " + shiftHours(t) : "");
      }).join(", "));
    } else {
      line("Nenhum plantão planejado neste mês.");
    }
    line("Presença: " + att.trabalhou + " trabalhou · " + att.falta + " faltou · " + att.coberto + " coberto");
    row.appendChild(info);
    if(sched.canEditStaffSchedule){
      var edit = document.createElement("button");
      edit.type = "button"; edit.className = "small"; edit.textContent = "Editar horário";
      edit.addEventListener("click", function(){ openStaffScheduleEditModal(u); });
      row.appendChild(edit);
    }
    list.appendChild(row);
  });
}

(function(){
  var prev = document.getElementById("btnCoordTeamPrev");
  var next = document.getElementById("btnCoordTeamNext");
  if(prev) prev.addEventListener("click", function(){ coordTeamMonthKey = shiftMonthKey(coordTeamMonth(), -1); loadCoordTeam(); });
  if(next) next.addEventListener("click", function(){ coordTeamMonthKey = shiftMonthKey(coordTeamMonth(), 1); loadCoordTeam(); });
})();

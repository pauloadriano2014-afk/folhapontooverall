// closing.js — fechamento do mes.
//  - Dono/gerente/coordenador(a): confere as horas de cada pessoa e fecha o mes.
//    Dono/gerente tambem reabrem. Socio(a) so acompanha.
//  - Cada pessoa: ve o aviso "mes fechado" na propria grade e nao consegue mais
//    alterar horas/valores desse mes (o servidor tambem barra).
"use strict";

var closingMonthKey = null;
var closingData = null;
var myClosings = {}; // mes -> { closedAt, closedByName }

function closingMonth(){
  if(!closingMonthKey) closingMonthKey = shiftMonthKey(monthKeyNow(), -1); // o que se costuma fechar: o mes passado
  return closingMonthKey;
}

function fmtDateBr(iso){
  var d = new Date(iso);
  return pad2(d.getDate()) + "/" + pad2(d.getMonth() + 1) + "/" + d.getFullYear();
}

// ---------- travas na grade de quem teve o mes fechado ----------
function isMonthClosedForMe(monthKey){ return !!(monthKey && myClosings[monthKey]); }

function loadMyClosings(){
  if(!authToken || !currentUser || !currentUser.companyId) return Promise.resolve();
  return authFetch("/api/me/closings").then(function(res){
    if(res.status === 401){ handleAuthExpired(); throw new Error("auth_expired"); }
    return res.ok ? res.json() : null;
  }).then(function(b){
    if(!b) return;
    var next = {};
    (b.closings || []).forEach(function(c){ next[c.month] = c; });
    myClosings = next;
    if(typeof renderGrid === "function" && typeof data !== "undefined" && data) renderGrid();
  }).catch(function(){});
}

// chamado pelo renderGrid: banner + campos travados
function applyMonthLockUI(monthKey){
  var closed = isMonthClosedForMe(monthKey);
  var banner = document.getElementById("monthLockBanner");
  if(banner){
    banner.style.display = closed ? "" : "none";
    if(closed){
      var c = myClosings[monthKey];
      banner.textContent = "🔒 Mês fechado em " + fmtDateBr(c.closedAt) + (c.closedByName ? " por " + c.closedByName : "") +
        ". As horas e valores deste mês não podem mais ser alterados. Se algo estiver errado, fale com a gerência para reabrir.";
    }
  }
  ["inputAuxilio", "inputConsumo"].forEach(function(id){ var el = document.getElementById(id); if(el) el.disabled = closed; });
  var gridWrap = document.getElementById("gridWrapMain");
  if(gridWrap) gridWrap.classList.toggle("month-locked", closed);
}

function guardClosedMonth(monthKey){
  if(!isMonthClosedForMe(monthKey)) return false;
  showToast("Este mês está fechado. Peça à gerência para reabrir se precisar corrigir.");
  return true;
}

// ---------- tela de fechamento (quem gerencia) ----------
function loadClosing(){
  var list = document.getElementById("closingList");
  if(!list || !authToken) return;
  var month = closingMonth();
  document.getElementById("closingMonthLabel").textContent = monthLabel(month);
  authFetch("/api/company/closings?month=" + encodeURIComponent(month)).then(function(res){
    if(res.status === 401){ handleAuthExpired(); throw new Error("auth_expired"); }
    return res.json().then(function(b){ return { ok: res.ok, body: b }; });
  }).then(function(r){
    if(!r.ok){ document.getElementById("closingStatus").textContent = (r.body && r.body.message) || "Não consegui carregar."; return; }
    closingData = r.body;
    renderClosing();
  }).catch(function(err){
    if(err && err.message === "auth_expired") return;
    document.getElementById("closingStatus").textContent = "Sem conexão com o servidor.";
  });
}

function closingCall(url, opts){
  return authFetch(url, opts).then(function(res){
    if(res.status === 401){ handleAuthExpired(); throw new Error("auth_expired"); }
    return res.json().then(function(b){ return { ok: res.ok, body: b }; });
  });
}

function doClose(userIds){
  var month = closingMonth();
  var err = document.getElementById("closingError");
  err.textContent = "";
  if(closingData && closingData.isCurrentOrFuture && !confirm("Este mês ainda não terminou. Fechar mesmo assim? Depois de fechado, ninguém consegue lançar mais horas nele.")) return;
  closingCall("/api/company/closings", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ month: month, userIds: userIds })
  }).then(function(r){
    if(!r.ok){ err.textContent = (r.body && r.body.message) || "Não consegui fechar."; return; }
    showToast(r.body.closed ? "Mês fechado para " + r.body.closed + " pessoa(s)." : "Nada a fechar.");
    loadClosing();
  }).catch(function(e){ if(!e || e.message !== "auth_expired") err.textContent = "Sem conexão com o servidor."; });
}

function doReopen(member){
  if(!confirm("Reabrir o mês de " + monthLabel(closingMonth()) + " de " + member.name + "? Ele(a) será avisado(a) e poderá alterar as horas. Isso fica registrado no histórico.")) return;
  var err = document.getElementById("closingError");
  err.textContent = "";
  closingCall("/api/company/closings/" + member.id + "/" + closingMonth(), { method: "DELETE" }).then(function(r){
    if(!r.ok){ err.textContent = (r.body && r.body.message) || "Não consegui reabrir."; return; }
    showToast("Mês reaberto para " + member.name + ".");
    loadClosing();
  }).catch(function(e){ if(!e || e.message !== "auth_expired") err.textContent = "Sem conexão com o servidor."; });
}

function renderClosing(){
  var d = closingData, list = document.getElementById("closingList");
  list.innerHTML = "";
  var people = d.members;
  var closedN = people.filter(function(m){ return m.status === "closed"; }).length;
  var pill = document.getElementById("closingStatus");
  var openable = people.filter(function(m){ return m.status === "open" && m.hasData && !(d.myId === m.id && !d.canReopen); });
  pill.className = "pill " + (closedN === people.length && people.length ? "pill-ok" : (closedN ? "pill-warn" : "pill-off"));
  pill.textContent = d.isFuture ? "Mês que ainda não começou" : (closedN + " de " + people.length + " fechados");
  var all = document.getElementById("btnClosingAll");
  all.style.display = d.canClose ? "" : "none";
  all.disabled = d.isFuture || openable.length === 0;
  all.onclick = function(){
    if(!confirm("Fechar o mês de " + monthLabel(closingMonth()) + " para " + openable.length + " pessoa(s)? Depois, ninguém consegue alterar as horas dele.")) return;
    doClose(openable.map(function(m){ return m.id; }));
  };
  if(!people.length){ list.innerHTML = "<p class='account-section-hint'>Ainda não há ninguém vinculado.</p>"; return; }
  people.forEach(function(m){
    var row = document.createElement("div");
    row.className = "client-row team-member";
    var info = document.createElement("div");
    info.className = "client-info";
    var name = document.createElement("strong");
    name.textContent = m.name;
    var role = document.createElement("span");
    role.className = "pill pill-off"; role.style.marginLeft = "8px";
    role.textContent = m.companyRole === "coordinator" ? "Coordenador(a)" : (roleIsTrainee(m.role) ? "Estagiário" : "Professor");
    name.appendChild(role);
    info.appendChild(name);
    function line(t){ var sp = document.createElement("span"); sp.className = "client-meta"; sp.style.display = "block"; sp.textContent = t; info.appendChild(sp); }
    if(!m.hasData){ line("Sem horas lançadas neste mês."); }
    else {
      line(m.hours + (m.hours === 1 ? " horário lançado" : " horários lançados") + (d.showValues && typeof m.total === "number" ? " · " + fmtMoney(m.total) : ""));
    }
    if(m.status === "closed") line("🔒 Fechado em " + fmtDateBr(m.closedAt) + (m.closedByName ? " por " + m.closedByName : ""));
    row.appendChild(info);
    var selfCoord = d.myId === m.id && !d.canReopen;
    if(m.status === "closed"){
      if(d.canReopen){
        var re = document.createElement("button"); re.type = "button"; re.className = "small"; re.textContent = "Reabrir";
        re.addEventListener("click", function(){ doReopen(m); }); row.appendChild(re);
      }
    } else if(d.canClose && m.hasData && !d.isFuture){
      if(selfCoord){ line("Quem fecha o seu mês é a gerência."); }
      else {
        var b = document.createElement("button"); b.type = "button"; b.className = "small primary"; b.textContent = "Fechar";
        b.addEventListener("click", function(){ doClose([m.id]); }); row.appendChild(b);
      }
    }
    list.appendChild(row);
  });
}

(function(){
  var prev = document.getElementById("btnClosingPrev"), next = document.getElementById("btnClosingNext");
  if(prev) prev.addEventListener("click", function(){ closingMonthKey = shiftMonthKey(closingMonth(), -1); loadClosing(); });
  if(next) next.addEventListener("click", function(){ closingMonthKey = shiftMonthKey(closingMonth(), 1); loadClosing(); });
})();

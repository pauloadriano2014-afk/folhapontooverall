// units.js — varias unidades (rede). So o dono ve: lista as unidades, compara o mes,
// cria unidade nova, renomeia e entra em outra unidade.
"use strict";

var unitsOrg = null;
var unitsMonthKey = null;
function unitsMonth(){
  if(!unitsMonthKey) unitsMonthKey = shiftMonthKey(monthKeyNow(), -1); // o mes que se costuma conferir
  return unitsMonthKey;
}

function unitsCall(url, method, body){
  return authFetch(url, { method: method || "GET", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })
    .then(function(res){
      if(res.status === 401){ handleAuthExpired(); throw new Error("auth_expired"); }
      return res.json().then(function(b){ return { ok: res.ok, body: b }; });
    });
}
function unitsErr(msg){ document.getElementById("unitsError").textContent = msg || ""; }

function loadUnits(){
  if(!document.getElementById("unitsCard") || !authToken) return;
  unitsErr("");
  unitsCall("/api/org").then(function(r){
    if(!r.ok){ document.getElementById("unitsBody").textContent = (r.body && r.body.message) || "Não consegui carregar."; return; }
    unitsOrg = r.body;
    if(!r.body.enabled){ renderUnitsOff(); return; }
    return unitsCall("/api/org/overview?month=" + encodeURIComponent(unitsMonth())).then(function(o){
      renderUnitsOn(o.ok ? o.body : { units: [] });
    });
  }).catch(function(err){
    if(err && err.message === "auth_expired") return;
    document.getElementById("unitsBody").textContent = "Sem conexão com o servidor.";
  });
}

function unitsBtn(label, cls, fn){
  var b = document.createElement("button");
  b.type = "button"; b.className = "small " + (cls || ""); b.textContent = label;
  b.addEventListener("click", function(){ fn(b); });
  return b;
}

function addUnitFlow(){
  var name = prompt("Nome da nova unidade (ex.: Overall Centro):");
  if(!name || !name.trim()) return;
  unitsErr("");
  unitsCall("/api/org/units", "POST", { name: name.trim() }).then(function(r){
    if(!r.ok){ unitsErr((r.body && r.body.message) || "Não consegui criar a unidade."); return; }
    showToast("Unidade \"" + r.body.unit.name + "\" criada. Código de convite: " + r.body.unit.inviteCode);
    loadUnits();
  }).catch(function(e){ if(!e || e.message !== "auth_expired") unitsErr("Sem conexão com o servidor."); });
}

function renderUnitsOff(){
  var intro = document.getElementById("unitsIntro"), body = document.getElementById("unitsBody"), act = document.getElementById("unitsActions");
  intro.innerHTML = ""; body.innerHTML = ""; act.innerHTML = "";
  var p = document.createElement("p");
  p.className = "account-section-hint"; p.style.margin = "-4px 0 10px";
  p.textContent = "Hoje o app tem uma unidade: \"" + unitsOrg.current.name + "\". Se a sua academia tem mais de uma, ative as várias unidades: cada uma ganha equipe, escala, fechamento e código de convite próprios, e você compara todas num quadro só e alterna entre elas com um toque.";
  intro.appendChild(p);
  var box = document.createElement("div"); box.className = "units-feat";
  ["Equipe, escala e fechamento separados por unidade", "Quadro comparativo do mês: pessoas, horários, valor, plantões e faltas", "Entrar em qualquer unidade com um toque", "Código de convite próprio para cada unidade"].forEach(function(t){
    var li = document.createElement("div"); li.textContent = "✓ " + t; box.appendChild(li);
  });
  body.appendChild(box);
  act.appendChild(unitsBtn("Adicionar unidade", "primary", addUnitFlow));
}

function renderUnitsOn(ov){
  var intro = document.getElementById("unitsIntro"), body = document.getElementById("unitsBody"), act = document.getElementById("unitsActions");
  intro.innerHTML = ""; body.innerHTML = ""; act.innerHTML = "";
  var p = document.createElement("p");
  p.className = "account-section-hint"; p.style.margin = "-4px 0 10px";
  p.textContent = "Rede " + unitsOrg.org.name + ": " + unitsOrg.units.length + " de " + unitsOrg.org.maxUnits + " unidade(s) no seu plano. Você está na unidade marcada abaixo; toque em Entrar para alternar.";
  intro.appendChild(p);
  var bar = document.createElement("div"); bar.className = "month-bar"; bar.style.marginBottom = "8px";
  var prev = unitsBtn("‹", "", function(){ unitsMonthKey = shiftMonthKey(unitsMonth(), -1); loadUnits(); }); prev.setAttribute("aria-label", "Mês anterior");
  var lab = document.createElement("strong"); lab.style.cssText = "flex:1;text-align:center;"; lab.textContent = monthLabel(unitsMonth());
  var next = unitsBtn("›", "", function(){ unitsMonthKey = shiftMonthKey(unitsMonth(), 1); loadUnits(); }); next.setAttribute("aria-label", "Próximo mês");
  bar.appendChild(prev); bar.appendChild(lab); bar.appendChild(next); body.appendChild(bar);

  var byId = {}; (ov.units || []).forEach(function(u){ byId[u.id] = u; });
  var sum = { people: 0, hours: 0, total: 0, shifts: 0, absences: 0 };
  unitsOrg.units.forEach(function(u){
    var s = byId[u.id] || { people: u.members, hours: 0, total: 0, closed: 0, withHours: 0, shifts: 0, absences: 0, pendingSwaps: 0 };
    sum.people += s.people; sum.hours += s.hours; sum.total += s.total; sum.shifts += s.shifts; sum.absences += s.absences;
    var card = document.createElement("div");
    card.className = "unit-card" + (u.isCurrent ? " current" : "");
    var head = document.createElement("div"); head.className = "unit-head";
    var nm = document.createElement("strong"); nm.textContent = u.name;
    head.appendChild(nm);
    if(u.isCurrent){ var tag = document.createElement("span"); tag.className = "pill pill-ok"; tag.textContent = "Você está aqui"; head.appendChild(tag); }
    card.appendChild(head);
    var grid = document.createElement("div"); grid.className = "unit-stats";
    [["Pessoas", s.people], ["Horários", s.hours], ["Valor", fmtMoney(s.total)], ["Plantões", s.shifts], ["Faltas", s.absences],
     ["Fechados", s.withHours ? s.closed + " de " + s.withHours : "—"]].forEach(function(kv){
      var c = document.createElement("div"); c.className = "unit-stat";
      c.innerHTML = "<span></span><b></b>"; c.querySelector("span").textContent = kv[0]; c.querySelector("b").textContent = kv[1]; grid.appendChild(c);
    });
    card.appendChild(grid);
    var foot = document.createElement("div"); foot.className = "unit-foot";
    var code = document.createElement("span"); code.className = "client-meta"; code.textContent = "Código de convite: " + u.inviteCode;
    foot.appendChild(code);
    var btns = document.createElement("div"); btns.className = "row-actions"; btns.style.marginTop = "0";
    if(s.pendingSwaps){ var sp = document.createElement("span"); sp.className = "pill pill-warn"; sp.textContent = s.pendingSwaps + " troca(s) a aprovar"; btns.appendChild(sp); }
    btns.appendChild(unitsBtn("Renomear", "", function(){
      var n = prompt("Novo nome da unidade:", u.name);
      if(!n || !n.trim() || n.trim() === u.name) return;
      unitsCall("/api/org/units/" + u.id, "PUT", { name: n.trim() }).then(function(r){
        if(!r.ok){ unitsErr((r.body && r.body.message) || "Não consegui renomear."); return; }
        if(u.isCurrent){ window.location.reload(); } else { loadUnits(); }
      });
    }));
    if(!u.isCurrent){
      btns.appendChild(unitsBtn("Entrar", "primary", function(b){
        b.disabled = true;
        unitsCall("/api/org/switch", "POST", { companyId: u.id }).then(function(r){
          if(!r.ok){ unitsErr((r.body && r.body.message) || "Não consegui trocar de unidade."); b.disabled = false; return; }
          try{ localStorage.removeItem(NAV_VIEW_KEY + currentUser.id); }catch(e){}
          window.location.reload();
        }).catch(function(){ b.disabled = false; });
      }));
    }
    foot.appendChild(btns);
    card.appendChild(foot);
    body.appendChild(card);
  });

  var tot = document.createElement("div"); tot.className = "unit-card unit-total";
  tot.innerHTML = "<strong>Total da rede</strong>";
  var tg = document.createElement("div"); tg.className = "unit-stats";
  [["Pessoas", sum.people], ["Horários", sum.hours], ["Valor", fmtMoney(sum.total)], ["Plantões", sum.shifts], ["Faltas", sum.absences]].forEach(function(kv){
    var c = document.createElement("div"); c.className = "unit-stat"; c.innerHTML = "<span></span><b></b>"; c.querySelector("span").textContent = kv[0]; c.querySelector("b").textContent = kv[1]; tg.appendChild(c);
  });
  tot.appendChild(tg); body.appendChild(tot);
  var note = document.createElement("p"); note.className = "account-section-hint"; note.style.marginTop = "8px";
  note.textContent = "Valores de horas de sala (grade + auxílio − consumo) de quem tem horas lançadas no mês; meses ainda abertos são provisórios. Salário fixo de gerente e alunos particulares não entram.";
  body.appendChild(note);
  act.appendChild(unitsBtn("+ Nova unidade", "primary", addUnitFlow));
}

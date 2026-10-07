// swaps.js — "ciente" da escala publicada e troca de plantao.
//  - Quem foi escalado confirma ("Estou ciente"); a coordenacao ve quem falta e lembra.
//  - Pedir troca: a pessoa escolhe um colega (ele aceita) ou "sem substituto"; a
//    coordenacao/gerencia aprova e a escala publicada ja se atualiza.
"use strict";

function swapCall(url, method, body){
  return authFetch(url, {
    method: method || "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  }).then(function(res){
    if(res.status === 401){ handleAuthExpired(); throw new Error("auth_expired"); }
    return res.json().then(function(b){ return { ok: res.ok, body: b }; });
  });
}
function swapMsg(r, fallback){ return (r && r.body && r.body.message) || fallback; }
function swapWhen(s){ return dateLabelBr(s.date) + " · " + s.shiftName + " (" + s.startTime + "–" + s.endTime + ")"; }

// ---------- "ciente" (quem foi escalado) ----------
function renderMyAck(d, hasShifts){
  var box = document.getElementById("myRosterAck");
  if(!box) return;
  box.innerHTML = "";
  if(!hasShifts) return;
  var div = document.createElement("div");
  div.className = "ack-box" + (d.acked ? " ok" : "");
  var span = document.createElement("span");
  if(d.acked){
    span.textContent = "✓ Você confirmou que está ciente em " + fmtDateBr(d.ackedAt) + ".";
    div.appendChild(span);
  } else {
    span.textContent = "Você está escalado(a) neste mês. Confirme que viu os seus plantões.";
    var b = document.createElement("button");
    b.type = "button"; b.className = "small primary"; b.textContent = "Estou ciente";
    b.addEventListener("click", function(){
      b.disabled = true;
      swapCall("/api/me/roster/ack", "POST", { month: myRosterMonth() }).then(function(r){
        if(!r.ok){ showToast(swapMsg(r, "Não consegui confirmar.")); b.disabled = false; return; }
        showToast("Obrigado! Confirmado.");
        loadMyRoster();
      }).catch(function(){ b.disabled = false; showToast("Sem conexão com o servidor."); });
    });
    div.appendChild(span); div.appendChild(b);
  }
  box.appendChild(div);
}

// ---------- "ciente" (quem monta) ----------
function renderRosterAcks(){
  var el = document.getElementById("rosterAcks");
  if(!el || !rosterData) return;
  el.innerHTML = "";
  var pub = rosterData.publication || {};
  var ids = rosterData.publishedUserIds || [];
  if(!pub.published || !ids.length) return;
  var acked = rosterData.ackedUserIds || [];
  var pending = ids.filter(function(id){ return acked.indexOf(id) < 0; });
  var line = document.createElement("div");
  line.className = "ack-box" + (pending.length ? "" : " ok");
  var span = document.createElement("span");
  span.textContent = pending.length
    ? "Ciente: " + (ids.length - pending.length) + " de " + ids.length + " confirmaram. Faltam: " + pending.map(rosterStaffName).join(", ") + "."
    : "✓ Todos os " + ids.length + " escalados confirmaram que estão cientes.";
  line.appendChild(span);
  if(pending.length && rosterData.canManage){
    var b = document.createElement("button");
    b.type = "button"; b.className = "small"; b.textContent = "Lembrar quem falta";
    b.addEventListener("click", function(){
      b.disabled = true;
      swapCall("/api/company/roster/remind", "POST", { month: rosterMonth() }).then(function(r){
        showToast(r.ok ? r.body.reminded + " pessoa(s) lembrada(s)." : swapMsg(r, "Não consegui lembrar."));
        b.disabled = false;
      }).catch(function(){ b.disabled = false; showToast("Sem conexão com o servidor."); });
    });
    line.appendChild(b);
  }
  el.appendChild(line);
}

// ---------- pedir troca ----------
var swapDraft = null;

function openSwapModal(entry, type, d){
  swapDraft = { date: entry.date, shiftTypeId: entry.shiftTypeId };
  document.getElementById("swapInfo").textContent = dateLabelBr(entry.date) + " · " + type.name + " (" + shiftHours(type) + ")";
  var sel = document.getElementById("swapTarget");
  sel.innerHTML = "";
  var o0 = document.createElement("option"); o0.value = ""; o0.textContent = "Sem substituto — preciso sair do plantão"; sel.appendChild(o0);
  (d.team || []).forEach(function(p){
    if(!shiftAllows(type.kind, p.role)) return;
    var o = document.createElement("option"); o.value = p.id; o.textContent = p.name; sel.appendChild(o);
  });
  document.getElementById("swapNote").value = "";
  document.getElementById("swapError").textContent = "";
  var upd = function(){
    document.getElementById("swapHint").textContent = sel.value
      ? "O colega recebe o pedido e precisa aceitar. Depois a coordenação aprova."
      : "A coordenação recebe o pedido e decide quem cobre o plantão.";
  };
  sel.onchange = upd; upd();
  document.getElementById("swapOverlay").classList.add("open");
}

(function(){
  var send = document.getElementById("btnSwapSend");
  if(!send) return;
  send.addEventListener("click", function(){
    if(!swapDraft) return;
    var err = document.getElementById("swapError"); err.textContent = "";
    send.disabled = true;
    swapCall("/api/me/swaps", "POST", {
      date: swapDraft.date, shiftTypeId: swapDraft.shiftTypeId,
      targetId: document.getElementById("swapTarget").value || null,
      note: document.getElementById("swapNote").value
    }).then(function(r){
      send.disabled = false;
      if(!r.ok){ err.textContent = swapMsg(r, "Não consegui enviar o pedido."); return; }
      document.getElementById("swapOverlay").classList.remove("open");
      showToast("Pedido enviado.");
      loadMyRoster();
    }).catch(function(){ send.disabled = false; err.textContent = "Sem conexão com o servidor."; });
  });
})();

var SWAP_STATUS_PT = {
  pending_target: "Aguardando o colega aceitar",
  pending_manager: "Aguardando a coordenação",
  approved: "Aprovada",
  rejected: "Recusada",
  cancelled: "Cancelada"
};

function swapRow(text, meta, buttons){
  var row = document.createElement("div");
  row.className = "client-row";
  var info = document.createElement("div");
  info.className = "client-info";
  var st = document.createElement("strong"); st.textContent = text; info.appendChild(st);
  if(meta){ var m = document.createElement("span"); m.className = "client-meta"; m.style.display = "block"; m.textContent = meta; info.appendChild(m); }
  row.appendChild(info);
  (buttons || []).forEach(function(b){ row.appendChild(b); });
  return row;
}
function swapBtn(label, cls, fn){
  var b = document.createElement("button");
  b.type = "button"; b.className = "small " + (cls || ""); b.textContent = label;
  b.addEventListener("click", function(){ b.disabled = true; fn(b); });
  return b;
}

// ---------- minhas trocas (equipe) ----------
function loadMySwaps(){
  var el = document.getElementById("myRosterSwaps");
  if(!el || !authToken) return;
  swapCall("/api/me/swaps").then(function(r){
    el.innerHTML = "";
    if(!r.ok) return;
    var me = r.body.me, list = r.body.swaps;
    if(!list.length){
      var p = document.createElement("p"); p.className = "account-section-hint";
      p.textContent = "Precisa trocar um plantão? Toque em \"Pedir troca\" no plantão.";
      el.appendChild(p); return;
    }
    list.forEach(function(s){
      if(s.targetId === me && s.status === "pending_target"){
        el.appendChild(swapRow(s.requesterName + " pediu para trocar com você", swapWhen(s) + (s.note ? " · " + s.note : ""), [
          swapBtn("Aceitar", "primary", function(){ swapCall("/api/me/swaps/" + s.id + "/respond", "POST", { accept: true }).then(function(x){ showToast(x.ok ? "Aceito. Falta a aprovação da coordenação." : swapMsg(x, "Não consegui aceitar.")); loadMyRoster(); }); }),
          swapBtn("Recusar", "", function(){ swapCall("/api/me/swaps/" + s.id + "/respond", "POST", { accept: false }).then(function(){ loadMyRoster(); }); })
        ]));
      } else if(s.requesterId === me){
        var pend = s.status === "pending_target" || s.status === "pending_manager";
        var who = s.targetId ? "com " + s.targetName : "sem substituto";
        el.appendChild(swapRow("Seu pedido " + who, swapWhen(s) + " · " + SWAP_STATUS_PT[s.status], pend ? [
          swapBtn("Cancelar", "", function(){ swapCall("/api/me/swaps/" + s.id + "/cancel", "POST").then(function(){ loadMyRoster(); }); })
        ] : []));
      } else {
        el.appendChild(swapRow("Troca com " + s.requesterName, swapWhen(s) + " · " + SWAP_STATUS_PT[s.status]));
      }
    });
  }).catch(function(){});
}

// ---------- fila de aprovacao (coordenacao) ----------
function loadSwaps(){
  var el = document.getElementById("swapsList");
  if(!el || !authToken) return;
  swapCall("/api/company/swaps").then(function(r){
    el.innerHTML = "";
    if(!r.ok) return;
    var list = r.body.swaps, canDecide = r.body.canDecide, me = r.body.me;
    var pend = list.filter(function(s){ return s.status === "pending_manager"; });
    var h2 = document.querySelector("#swapsCard h2");
    if(h2) h2.textContent = "Pedidos de troca de plantão" + (pend.length ? " (" + pend.length + ")" : "");
    if(!list.length){
      var p = document.createElement("p"); p.className = "account-section-hint"; p.textContent = "Nenhum pedido de troca por enquanto."; el.appendChild(p); return;
    }
    list.forEach(function(s){
      var who = s.requesterName + (s.targetId ? " → " + s.targetName : " (sem substituto)");
      var meta = swapWhen(s) + (s.note ? " · " + s.note : "");
      if(s.status === "pending_manager"){
        var btns = [];
        if(canDecide && s.requesterId !== me){
          btns.push(swapBtn("Aprovar", "primary", function(){
            swapCall("/api/company/swaps/" + s.id + "/decide", "POST", { approve: true }).then(function(x){ showToast(x.ok ? "Troca aprovada e escala atualizada." : swapMsg(x, "Não consegui aprovar.")); loadRoster(); });
          }));
          btns.push(swapBtn("Recusar", "", function(){
            swapCall("/api/company/swaps/" + s.id + "/decide", "POST", { approve: false }).then(function(){ loadRoster(); });
          }));
        } else if(s.requesterId === me){ meta += " · outra pessoa da gestão decide"; }
        el.appendChild(swapRow(who, meta, btns));
      } else {
        el.appendChild(swapRow(who, meta + " · " + SWAP_STATUS_PT[s.status]));
      }
    });
  }).catch(function(){});
}

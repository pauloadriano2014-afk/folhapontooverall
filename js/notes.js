// notes.js — "Ocorrências" da academia: problemas (goteira, secador queimado...), recados de
// turno e achados e perdidos. É um registro da ACADEMIA (todos veem), ao contrário das horas,
// que são pessoais. Quem anota fica registrado, quem abriu fica como "visto por" e quem
// resolveu aparece com a data e o que foi feito.
"use strict";

var NOTE_KIND_INFO = {
  problema: { icon: "🛠️", label: "Problema", plural: "Problemas" },
  recado: { icon: "💬", label: "Recado de turno", plural: "Recados" },
  achado: { icon: "🎧", label: "Achado e perdido", plural: "Achados e perdidos" }
};
var notesState = { status: "open", kind: "", q: "", canWrite: false, canResolve: false, me: null, activeId: null, photo: null };

function notesCall(url, method, body){
  return authFetch(url, {
    method: method || "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  }).then(function(res){
    if(res.status === 401){ handleAuthExpired(); throw new Error("auth_expired"); }
    return res.json().then(function(b){ return { ok: res.ok, body: b }; });
  });
}

function noteWhen(iso){
  var d = new Date(iso), diff = (Date.now() - d.getTime()) / 60000;
  if(diff < 1) return "agora";
  if(diff < 60) return "há " + Math.floor(diff) + " min";
  if(diff < 60 * 24) return "há " + Math.floor(diff / 60) + " h";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function mountNotesCard(parentMain){
  var card = document.getElementById("notesCard");
  if(!card || !parentMain) return;
  if(card.parentElement !== parentMain) parentMain.appendChild(card);
  refreshNotesBadge();
}

function setNotesBadge(n){
  var b = document.getElementById("notesBadge");
  if(!b) return;
  b.textContent = n > 9 ? "9+" : String(n);
  b.hidden = !(n > 0);
}
function refreshNotesBadge(){
  if(!authToken || !currentUser || !currentUser.companyId) return;
  authFetch("/api/company/notes?status=open").then(function(res){ return res.ok ? res.json() : null; })
    .then(function(b){ if(b) setNotesBadge(b.counts.open); }).catch(function(){});
}

function loadNotes(){
  var list = document.getElementById("notesList");
  if(!list || !authToken) return;
  var url = "/api/company/notes?status=" + notesState.status + (notesState.kind ? "&kind=" + notesState.kind : "") + (notesState.q ? "&q=" + encodeURIComponent(notesState.q) : "");
  notesCall(url).then(function(r){
    if(!r.ok) return;
    notesState.canWrite = r.body.canWrite; notesState.canResolve = r.body.canResolve; notesState.me = r.body.me;
    setNotesBadge(r.body.counts.open);
    renderNotes(r.body);
  }).catch(function(){});
}

function renderNotes(d){
  document.getElementById("btnNoteNew").style.display = d.canWrite ? "" : "none";
  var tabs = document.getElementById("notesStatusTabs");
  tabs.innerHTML = "";
  [["open", "Abertas", d.counts.open], ["resolved", "Resolvidas", d.counts.resolved]].forEach(function(t){
    var b = document.createElement("button");
    b.type = "button"; b.className = "faq-chip" + (notesState.status === t[0] ? " active" : "");
    b.appendChild(document.createTextNode(t[1]));
    var n = document.createElement("small"); n.textContent = t[2]; b.appendChild(n);
    b.addEventListener("click", function(){ notesState.status = t[0]; loadNotes(); });
    tabs.appendChild(b);
  });
  var kinds = document.getElementById("notesKindTabs");
  kinds.innerHTML = "";
  [["", "Todas"], ["problema", "Problemas"], ["recado", "Recados"], ["achado", "Achados e perdidos"]].forEach(function(k){
    var b = document.createElement("button");
    b.type = "button"; b.className = "faq-chip" + (notesState.kind === k[0] ? " active" : "");
    b.textContent = k[1];
    b.addEventListener("click", function(){ notesState.kind = k[0]; loadNotes(); });
    kinds.appendChild(b);
  });
  var list = document.getElementById("notesList");
  list.innerHTML = "";
  if(!d.notes.length){
    var p = document.createElement("p");
    p.className = "account-section-hint";
    p.textContent = notesState.q ? "Nada encontrado com essa busca."
      : (notesState.status === "open" ? "Nenhuma ocorrência aberta. Tudo em ordem! 🎉" : "Nenhuma ocorrência resolvida ainda.");
    list.appendChild(p);
    return;
  }
  d.notes.forEach(function(n){
    var info = NOTE_KIND_INFO[n.kind] || NOTE_KIND_INFO.problema;
    var row = document.createElement("div");
    row.className = "note-row" + (n.priority === "urgente" && n.status === "open" ? " urgent" : "") + (n.status === "resolved" ? " done" : "");
    row.tabIndex = 0; row.setAttribute("role", "button");
    var ico = document.createElement("span"); ico.className = "note-ico"; ico.textContent = n.status === "resolved" ? "✅" : info.icon;
    var main = document.createElement("div"); main.className = "note-main";
    var t = document.createElement("strong"); t.textContent = n.title;
    if(n.priority === "urgente" && n.status === "open"){ var u = document.createElement("span"); u.className = "note-urgent"; u.textContent = "URGENTE"; t.appendChild(u); }
    var m = document.createElement("span"); m.className = "client-meta";
    var parts = [info.label];
    if(n.place) parts.push(n.place);
    if(n.kind === "achado" && n.storedAt && n.status === "open") parts.push("guardado em: " + n.storedAt);
    parts.push(n.createdByName + " · " + noteWhen(n.createdAt));
    if(n.updates) parts.push(n.updates + (n.updates === 1 ? " atualização" : " atualizações"));
    if(n.hasPhoto) parts.push("📷");
    m.textContent = parts.join(" · ");
    main.appendChild(t); main.appendChild(m);
    if(n.status === "resolved"){
      var r = document.createElement("span"); r.className = "client-meta note-resolved";
      r.textContent = "✓ Resolvido por " + n.resolvedByName + " · " + noteWhen(n.resolvedAt) + (n.resolution ? " · " + n.resolution : "");
      main.appendChild(r);
    }
    row.appendChild(ico); row.appendChild(main);
    var open = function(){ openNoteDetail(n.id); };
    row.addEventListener("click", open);
    row.addEventListener("keydown", function(e){ if(e.key === "Enter" || e.key === " "){ e.preventDefault(); open(); } });
    list.appendChild(row);
  });
}

// ---------- anotar ----------
function noteSelectedKind(){
  var c = document.querySelector('input[name="noteKind"]:checked');
  return c ? c.value : "problema";
}
function updateNoteFormKind(){
  var k = noteSelectedKind();
  document.getElementById("noteStoredWrap").style.display = k === "achado" ? "" : "none";
  var titleEl = document.getElementById("noteTitle");
  titleEl.placeholder = k === "achado" ? "Ex: Fone de ouvido preto" : (k === "recado" ? "Ex: Aluna Maria vai buscar o fone" : "Ex: Goteira na sala de spinning");
  document.getElementById("notePlace").placeholder = k === "achado" ? "Onde foi encontrado (ex: vestiário feminino)" : "Onde (ex: vestiário, sala 2)";
  document.querySelectorAll("#noteKindChips .client-day-chip").forEach(function(c){ c.classList.toggle("checked", c.querySelector("input").checked); });
}
function openNoteNew(){
  document.getElementById("noteForm").reset();
  notesState.photo = null;
  document.getElementById("notePhotoPreview").style.display = "none";
  document.getElementById("noteError").textContent = "";
  updateNoteFormKind();
  document.getElementById("noteNewOverlay").classList.add("open");
}

// reduz a foto para caber no banco (máx. ~1000px, JPEG)
function noteCompressPhoto(file){
  return new Promise(function(resolve, reject){
    var img = new Image(), url = URL.createObjectURL(file);
    img.onload = function(){
      var max = 1000, w = img.width, h = img.height, scale = Math.min(1, max / Math.max(w, h));
      var c = document.createElement("canvas"); c.width = Math.round(w * scale); c.height = Math.round(h * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      var q = 0.72, out = c.toDataURL("image/jpeg", q);
      while(out.length > 380000 && q > 0.3){ q -= 0.1; out = c.toDataURL("image/jpeg", q); }
      resolve(out);
    };
    img.onerror = function(){ URL.revokeObjectURL(url); reject(new Error("img")); };
    img.src = url;
  });
}

(function(){
  var newBtn = document.getElementById("btnNoteNew");
  if(!newBtn) return;
  newBtn.addEventListener("click", openNoteNew);
  document.querySelectorAll('input[name="noteKind"]').forEach(function(r){ r.addEventListener("change", updateNoteFormKind); });
  document.getElementById("notePhoto").addEventListener("change", function(){
    var f = this.files && this.files[0];
    if(!f){ notesState.photo = null; document.getElementById("notePhotoPreview").style.display = "none"; return; }
    noteCompressPhoto(f).then(function(data){
      notesState.photo = data;
      var pv = document.getElementById("notePhotoPreview"); pv.src = data; pv.style.display = "";
    }).catch(function(){ document.getElementById("noteError").textContent = "Não consegui usar essa foto."; });
  });
  var search = document.getElementById("notesSearch"), timer = null;
  search.addEventListener("input", function(){ clearTimeout(timer); timer = setTimeout(function(){ notesState.q = search.value.trim(); loadNotes(); }, 300); });
  document.getElementById("noteForm").addEventListener("submit", function(e){
    e.preventDefault();
    var err = document.getElementById("noteError"); err.textContent = "";
    var title = document.getElementById("noteTitle").value.trim();
    if(!title){ err.textContent = "Escreva o que aconteceu."; return; }
    var btn = document.getElementById("noteSave"); btn.disabled = true; btn.textContent = "Salvando...";
    notesCall("/api/company/notes", "POST", {
      kind: noteSelectedKind(), title: title, body: document.getElementById("noteBody").value,
      place: document.getElementById("notePlace").value, storedAt: document.getElementById("noteStored").value,
      priority: document.getElementById("noteUrgent").checked ? "urgente" : "normal", photo: notesState.photo
    }).then(function(r){
      btn.disabled = false; btn.textContent = "Salvar ocorrência";
      if(!r.ok){ err.textContent = (r.body && r.body.message) || "Não consegui salvar."; return; }
      document.getElementById("noteNewOverlay").classList.remove("open");
      showToast("Ocorrência registrada. A equipe foi avisada.");
      notesState.status = "open"; notesState.kind = ""; notesState.q = ""; document.getElementById("notesSearch").value = "";
      loadNotes();
    }).catch(function(){ btn.disabled = false; btn.textContent = "Salvar ocorrência"; err.textContent = "Sem conexão com o servidor."; });
  });
})();

// ---------- detalhe ----------
function openNoteDetail(id){
  notesState.activeId = id;
  notesCall("/api/company/notes/" + id).then(function(r){
    if(!r.ok){ showToast("Não consegui abrir."); return; }
    renderNoteDetail(r.body);
    document.getElementById("noteDetailOverlay").classList.add("open");
    refreshNotesBadge();
  }).catch(function(){});
}

function renderNoteDetail(d){
  var n = d.note, info = NOTE_KIND_INFO[n.kind] || NOTE_KIND_INFO.problema;
  document.getElementById("noteDetailTitle").textContent = info.icon + " " + n.title;
  var meta = [info.label];
  if(n.priority === "urgente") meta.push("URGENTE");
  meta.push("anotado por " + n.createdByName + " · " + noteWhen(n.createdAt));
  document.getElementById("noteDetailMeta").textContent = meta.join(" · ");
  var facts = document.getElementById("noteDetailFacts"); facts.innerHTML = "";
  function fact(label, value){ if(!value) return; var p = document.createElement("p"); p.className = "note-fact"; var b = document.createElement("strong"); b.textContent = label + ": "; p.appendChild(b); p.appendChild(document.createTextNode(value)); facts.appendChild(p); }
  fact(n.kind === "achado" ? "Encontrado em" : "Local", n.place);
  fact("Guardado em", n.storedAt);
  fact("Detalhes", n.body);
  var img = document.getElementById("noteDetailPhoto");
  if(n.photo){ img.src = n.photo; img.style.display = ""; } else { img.style.display = "none"; }
  var st = document.getElementById("noteDetailStatus");
  st.className = "pill " + (n.status === "resolved" ? "pill-ok" : "pill-warn");
  st.textContent = n.status === "resolved" ? "✓ Resolvido por " + n.resolvedByName + " · " + noteWhen(n.resolvedAt) : "Aberto";
  // histórico
  var tl = document.getElementById("noteDetailTimeline"); tl.innerHTML = "";
  d.updates.forEach(function(u){
    var row = document.createElement("div"); row.className = "note-upd " + u.kind;
    var who = document.createElement("strong"); who.textContent = u.userName;
    var what = document.createElement("span"); what.textContent = (u.kind === "resolved" ? " resolveu: " : (u.kind === "reopened" ? " reabriu" : ": ")) + (u.kind === "reopened" ? "" : u.text);
    var when = document.createElement("span"); when.className = "client-meta"; when.textContent = " · " + noteWhen(u.createdAt);
    row.appendChild(who); row.appendChild(what); row.appendChild(when); tl.appendChild(row);
  });
  var h4 = document.querySelector("#noteDetailOverlay .note-h4");
  if(h4) h4.style.display = d.updates.length ? "" : "none";
  var seen = document.getElementById("noteDetailSeen");
  seen.textContent = d.seenBy.length ? "👁 Visto por: " + d.seenBy.map(function(s){ return s.name; }).join(", ") : "";
  // ações
  document.getElementById("noteCommentWrap").style.display = d.canWrite ? "" : "none";
  var resolveWrap = document.getElementById("noteResolveWrap");
  resolveWrap.style.display = (d.canResolve && n.status === "open") ? "" : "none";
  document.getElementById("noteResolution").value = "";
  var reopen = document.getElementById("btnNoteReopen");
  reopen.style.display = (d.canWrite && n.status === "resolved") ? "" : "none";
  document.getElementById("btnNoteDelete").style.display = d.canDelete ? "" : "none";
  document.getElementById("noteDetailError").textContent = "";
}

(function(){
  var send = document.getElementById("btnNoteComment");
  if(!send) return;
  function after(r, okMsg){
    if(!r.ok){ document.getElementById("noteDetailError").textContent = (r.body && r.body.message) || "Não consegui."; return; }
    if(okMsg) showToast(okMsg);
    openNoteDetail(notesState.activeId); loadNotes();
  }
  send.addEventListener("click", function(){
    var input = document.getElementById("noteCommentText"), text = input.value.trim();
    if(!text) return;
    notesCall("/api/company/notes/" + notesState.activeId + "/updates", "POST", { text: text }).then(function(r){ if(r.ok) input.value = ""; after(r); });
  });
  document.getElementById("btnNoteResolve").addEventListener("click", function(){
    notesCall("/api/company/notes/" + notesState.activeId + "/resolve", "POST", { resolution: document.getElementById("noteResolution").value }).then(function(r){ after(r, "Marcado como resolvido."); });
  });
  document.getElementById("btnNoteReopen").addEventListener("click", function(){
    notesCall("/api/company/notes/" + notesState.activeId + "/reopen", "POST").then(function(r){ after(r, "Ocorrência reaberta."); });
  });
  document.getElementById("btnNoteDelete").addEventListener("click", function(){
    if(!confirm("Apagar esta ocorrência e todo o histórico dela? Isso não pode ser desfeito.")) return;
    notesCall("/api/company/notes/" + notesState.activeId, "DELETE").then(function(r){
      if(!r.ok){ document.getElementById("noteDetailError").textContent = (r.body && r.body.message) || "Não consegui apagar."; return; }
      document.getElementById("noteDetailOverlay").classList.remove("open"); showToast("Ocorrência apagada."); loadNotes();
    });
  });
})();

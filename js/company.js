// company.js — painel da academia (conta "dono"): mostra o código de convite
// pra equipe e, pra cada profissional já vinculado, quanto ele tem a receber
// no mês, reaproveitando o mesmo cálculo que cada tela individual já faz
// (clientMonthlyValue pros alunos particulares; um cálculo equivalente ao da
// grade pra quem usa escala de horas). Isso evita duplicar a lógica
// financeira em dois lugares — o servidor só devolve os dados brutos de cada
// profissional (o mesmo "data" que a própria conta dele usa).
"use strict";

var companyOverviewData = null;

function monthKeyNow(){
  var d = new Date();
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1);
}

// Mesma conta de horas da grade (dayTotal/monthTotal), mas parametrizada pro
// "data" de OUTRA pessoa — nao pode usar getTimeSlots()/dayTotal daqui porque
// aquelas funcoes leem a variavel global `data` (a conta do proprio dono
// logado), nao a do profissional que estamos somando.
function computeGradeMonthTotal(staffData, monthKey){
  var monthObj = staffData && staffData.months && staffData.months[monthKey];
  if(!monthObj) return 0;
  var slots = (staffData.settings && Array.isArray(staffData.settings.timeSlots) && staffData.settings.timeSlots.length)
    ? staffData.settings.timeSlots
    : DEFAULT_TIME_SLOTS;
  var n = slots.length;
  var sum = 0;
  Object.keys(monthObj.days || {}).forEach(function(dateKey){
    var dayObj = monthObj.days[dateKey];
    if(!dayObj || !dayObj.slots) return;
    for(var i = 0; i < n; i++){
      if(typeof dayObj.slots[i] === "number") sum += dayObj.slots[i];
    }
  });
  return sum + (Number(monthObj.auxilio) || 0) - (Number(monthObj.consumo) || 0);
}

function computeClientsMonthTotal(staffData, monthKey){
  var clients = (staffData && staffData.clients) || [];
  var total = 0;
  clients.forEach(function(client){ total += clientMonthlyValue(client, monthKey); });
  return total;
}

// Cada profissional pode usar a grade (professor/estagiário) e/ou a lista de
// alunos particulares (personal) — soma o que existir nos dados dele.
function computeStaffMonthlyTotal(staffData, monthKey){
  if(!staffData) return 0;
  var total = 0;
  if(staffData.months && staffData.months[monthKey]) total += computeGradeMonthTotal(staffData, monthKey);
  if(Array.isArray(staffData.clients) && staffData.clients.length) total += computeClientsMonthTotal(staffData, monthKey);
  return total;
}

// Rotulo da funcao/nivel de acesso pra cada linha da equipe — dono e
// socio(a) nao tem valor financeiro (nao sao profissionais "operacionais"),
// coordenador(a) tem valor normal (ele tambem bate ponto) mas com uma tag a
// mais indicando o papel extra.
function companyRoleLabel(member){
  if(member.companyRole === "owner") return "Administrador(a)";
  if(member.companyRole === "partner") return "Sócio(a)";
  if(member.companyRole === "manager") return "Gerente";
  var base = member.role || "Sem função definida";
  if(member.companyRole === "coordinator") return base + " · Coordenador(a)";
  return base;
}

function companyRoleCountsFinancially(member){
  return member.companyRole !== "owner" && member.companyRole !== "partner" && member.companyRole !== "manager";
}

function renderCompanyStaffList(staff, monthKey){
  var listEl = document.getElementById("companyStaffList");
  var totalEl = document.getElementById("companyMonthTotal");
  listEl.innerHTML = "";
  if(!staff || staff.length === 0){
    listEl.innerHTML = "<p style='font-size:12px;color:var(--text-dim);margin:4px 0;'>Ainda ninguém entrou com o código de convite.</p>";
    totalEl.textContent = fmtMoney(0);
    return;
  }
  var total = 0;
  staff.forEach(function(member){
    var countsFinancially = companyRoleCountsFinancially(member);
    var value = countsFinancially ? computeStaffMonthlyTotal(member.data, monthKey) : 0;
    if(countsFinancially) total += value;
    var isYou = currentUser && member.id === currentUser.id;

    var row = document.createElement("div");
    row.className = "client-row";

    var info = document.createElement("div");
    info.className = "client-info";
    var name = document.createElement("strong");
    name.textContent = member.name + (isYou ? " (você)" : "");
    var meta = document.createElement("span");
    meta.className = "client-meta";
    meta.textContent = companyRoleLabel(member);
    info.appendChild(name);
    info.appendChild(meta);

    var valueEl = document.createElement("div");
    valueEl.className = "client-value";
    valueEl.textContent = countsFinancially ? fmtMoney(value) : "—";

    row.appendChild(info);
    row.appendChild(valueEl);
    listEl.appendChild(row);
  });
  totalEl.textContent = fmtMoney(total);
}

// Socio(a) so acompanha: esconde tudo que edita algo (convidar equipe). O
// card da escala (#scheduleCard) tem sua propria logica de leitura/edicao,
// controlada pelo "canManage" que o servidor devolve — ver schedule.js.
function applyCompanyReadOnlyUI(readOnly){
  var inviteCard = document.getElementById("companyInviteCard");
  if(inviteCard) inviteCard.style.display = readOnly ? "none" : "";
}

function loadCompanyOverview(){
  var listEl = document.getElementById("companyStaffList");
  var monthKey = monthKeyNow();
  document.getElementById("companyMonthLabel").textContent = monthLabel(monthKey);
  listEl.innerHTML = "<p style='font-size:12px;color:var(--text-dim);margin:4px 0;'>Carregando equipe...</p>";
  authFetch("/api/company/overview").then(function(res){
    if(res.status === 401){ handleAuthExpired(); throw new Error("auth_expired"); }
    return res.json().then(function(body){ return { ok: res.ok, body: body }; });
  }).then(function(r){
    if(!r.ok){
      listEl.innerHTML = "<p style='font-size:12px;color:var(--text-dim);margin:4px 0;'>Não consegui carregar a equipe agora.</p>";
      return;
    }
    companyOverviewData = r.body;
    document.getElementById("companyNameLabel").textContent = r.body.company.name;
    document.getElementById("companyInviteCodeDisplay").value = r.body.company.inviteCode;
    renderCompanyStaffList(r.body.staff, monthKey);
    loadPendingInvites();
  }).catch(function(err){
    if(err && err.message === "auth_expired") return;
    listEl.innerHTML = "<p style='font-size:12px;color:var(--text-dim);margin:4px 0;'>Sem conexão com o servidor.</p>";
    console.warn("Falha ao carregar painel da academia:", err);
  });
}

// ---------- convidar profissional por e-mail (com horario ja preenchido) ----------
function roleTextIsPersonal(text){
  var norm = String(text || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return norm.indexOf("personal") >= 0;
}

function selectedInviteAccessRole(){
  var checked = document.querySelector('input[name="inviteAccessRole"]:checked');
  return checked ? checked.value : "staff";
}

// Socio(a) e gerente sao 100% administrativos — nao trabalham na grade nem
// tem "função" no sentido operacional. Esconde os dois campos que so fazem
// sentido pra quem bate ponto.
function isAdminAccessRole(accessRole){
  return accessRole === "partner" || accessRole === "manager";
}
function updateInviteScheduleVisibility(){
  var wrap = document.getElementById("inviteScheduleWrap");
  var roleWrap = document.getElementById("inviteRoleWrap");
  var roleInput = document.getElementById("inviteRole");
  var accessRole = selectedInviteAccessRole();
  var isAdminInvite = isAdminAccessRole(accessRole);
  if(roleWrap) roleWrap.style.display = isAdminInvite ? "none" : "";
  if(wrap) wrap.style.display = (isAdminInvite || roleTextIsPersonal(roleInput.value)) ? "none" : "";
}

document.getElementById("btnOpenInvite").addEventListener("click", function(){
  document.getElementById("inviteForm").reset();
  document.querySelectorAll('input[name="inviteAccessRole"]').forEach(function(r){
    r.closest(".client-day-chip").classList.toggle("checked", r.checked);
  });
  document.getElementById("inviteError").textContent = "";
  document.getElementById("inviteResult").style.display = "none";
  updateInviteScheduleVisibility();
  document.getElementById("inviteOverlay").classList.add("open");
});

document.getElementById("inviteRole").addEventListener("input", updateInviteScheduleVisibility);
document.querySelectorAll('input[name="inviteAccessRole"]').forEach(function(radio){
  radio.addEventListener("change", function(){
    document.querySelectorAll('input[name="inviteAccessRole"]').forEach(function(r){
      r.closest(".client-day-chip").classList.toggle("checked", r.checked);
    });
    updateInviteScheduleVisibility();
  });
});

document.getElementById("inviteForm").addEventListener("submit", function(e){
  e.preventDefault();
  var errEl = document.getElementById("inviteError");
  errEl.textContent = "";
  var name = document.getElementById("inviteName").value.trim();
  var email = document.getElementById("inviteEmail").value.trim();
  var accessRole = selectedInviteAccessRole();
  var isAdminInvite = isAdminAccessRole(accessRole);
  var role = isAdminInvite ? "" : document.getElementById("inviteRole").value.trim();
  var applySchedule = !isAdminInvite && !roleTextIsPersonal(role);
  var shiftStart = applySchedule ? document.getElementById("inviteShiftStart").value : "";
  var shiftEnd = applySchedule ? document.getElementById("inviteShiftEnd").value : "";
  var weekendShift = applySchedule ? document.getElementById("inviteWeekendShift").checked : false;
  if(!name || !email){ errEl.textContent = "Informe nome e e-mail."; return; }
  var btn = document.getElementById("inviteSubmit");
  btn.disabled = true; btn.textContent = "Enviando...";
  authFetch("/api/company/invite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: name, email: email, role: role, accessRole: accessRole, shiftStart: shiftStart, shiftEnd: shiftEnd, weekendShift: weekendShift })
  }).then(function(res){
    if(res.status === 401){ handleAuthExpired(); throw new Error("auth_expired"); }
    return res.json().then(function(body){ return { ok: res.ok, body: body }; });
  }).then(function(r){
    btn.disabled = false; btn.textContent = "Enviar convite";
    if(!r.ok){
      errEl.textContent = authErrorMessage(r.body, "Não consegui criar o convite.");
      return;
    }
    document.getElementById("inviteResult").style.display = "";
    document.getElementById("inviteResultMsg").textContent = r.body.emailSent
      ? "Convite enviado por e-mail! Se preferir, também dá pra mandar o link direto:"
      : "E-mail automático não está configurado — copie e envie esse link pro profissional:";
    document.getElementById("inviteResultLink").value = r.body.inviteLink || "";
    showToast("Convite criado");
    loadPendingInvites();
  }).catch(function(err){
    if(err && err.message === "auth_expired") return;
    btn.disabled = false; btn.textContent = "Enviar convite";
    errEl.textContent = "Sem conexão com o servidor. Tente novamente.";
    console.warn("Falha ao criar convite:", err);
  });
});

document.getElementById("btnCopyInviteLink").addEventListener("click", function(){
  var input = document.getElementById("inviteResultLink");
  input.select();
  input.setSelectionRange(0, 99999);
  try{
    navigator.clipboard.writeText(input.value).then(function(){
      showToast("Link copiado");
    }).catch(function(){
      document.execCommand("copy");
      showToast("Link copiado");
    });
  }catch(e){
    try{ document.execCommand("copy"); showToast("Link copiado"); }catch(e2){}
  }
});

function loadPendingInvites(){
  var wrap = document.getElementById("companyPendingInvitesWrap");
  var listEl = document.getElementById("companyPendingInvitesList");
  if(!wrap || !listEl) return;
  authFetch("/api/company/invites").then(function(res){
    if(res.status === 401){ handleAuthExpired(); throw new Error("auth_expired"); }
    return res.json().then(function(body){ return { ok: res.ok, body: body }; });
  }).then(function(r){
    if(!r.ok || !r.body || !Array.isArray(r.body.invites)) return;
    var pending = r.body.invites.filter(function(inv){ return inv.status === "pending"; });
    listEl.innerHTML = "";
    if(pending.length === 0){
      wrap.style.display = "none";
      return;
    }
    wrap.style.display = "";
    pending.forEach(function(inv){
      var row = document.createElement("div");
      row.className = "client-row";

      var info = document.createElement("div");
      info.className = "client-info";
      var name = document.createElement("strong");
      name.textContent = inv.name;
      var meta = document.createElement("span");
      meta.className = "client-meta";
      var accessLabel = inv.accessRole === "coordinator" ? "Coordenador(a)" : (inv.accessRole === "partner" ? "Sócio(a)" : (inv.accessRole === "manager" ? "Gerente" : (inv.role || "Sem função definida")));
      meta.textContent = accessLabel + " · " + inv.email;
      info.appendChild(name);
      info.appendChild(meta);

      var actions = document.createElement("div");
      actions.className = "row-actions";
      actions.style.marginTop = "0";
      var copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "small ghost";
      copyBtn.textContent = "Copiar link";
      copyBtn.addEventListener("click", function(){
        try{
          navigator.clipboard.writeText(inv.inviteLink).then(function(){ showToast("Link copiado"); });
        }catch(err){}
      });
      var cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "small bad";
      cancelBtn.textContent = "Cancelar";
      cancelBtn.addEventListener("click", function(){
        authFetch("/api/company/invite/" + inv.id, { method: "DELETE" }).then(function(){
          loadPendingInvites();
        });
      });
      actions.appendChild(copyBtn);
      actions.appendChild(cancelBtn);

      row.appendChild(info);
      row.appendChild(actions);
      listEl.appendChild(row);
    });
  }).catch(function(err){
    if(err && err.message === "auth_expired") return;
    console.warn("Falha ao carregar convites pendentes:", err);
  });
}

document.getElementById("btnCopyInviteCode").addEventListener("click", function(){
  var input = document.getElementById("companyInviteCodeDisplay");
  input.select();
  input.setSelectionRange(0, 99999);
  try{
    navigator.clipboard.writeText(input.value).then(function(){
      showToast("Código copiado");
    }).catch(function(){
      document.execCommand("copy");
      showToast("Código copiado");
    });
  }catch(e){
    try{ document.execCommand("copy"); showToast("Código copiado"); }catch(e2){}
  }
});

document.getElementById("btnCompanyLogout").addEventListener("click", function(){
  logout();
});

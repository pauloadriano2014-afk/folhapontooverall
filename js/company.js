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
  // coordenador(a) sem funcao de professor so coordena
  if(member.companyRole === "coordinator") return member.role ? base + " · Coordenador(a)" : "Coordenador(a)";
  return base;
}

function companyRoleCountsFinancially(member){
  // gerente conta pelo salario fixo (definido pelo dono); dono e socio(a) nao entram nos valores
  return member.companyRole !== "owner" && member.companyRole !== "partner";
}

// Valor do mes de um item da lista: horas de sala (grade + auxilio - consumo) ou,
// para gerente, o salario mensal fixo. null = nao se aplica / nao visivel.
function memberMonthValue(member, monthKey){
  if(member.companyRole === "manager") return typeof member.monthlySalary === "number" ? member.monthlySalary : null;
  return computeStaffMonthlyTotal(member.data, monthKey);
}

// Texto no lugar do valor quando nao ha um numero para mostrar.
function memberNoValueText(member){
  if(member.companyRole === "manager"){
    var viewer = companyOverviewData && companyOverviewData.viewerRole;
    var isMe = currentUser && member.id === currentUser.id;
    if(viewer === "manager" && !isMe) return "—"; // um gerente nao ve o salario de outro
    return "Salário não definido";
  }
  return "—";
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
    var value = countsFinancially ? memberMonthValue(member, monthKey) : null;
    if(typeof value === "number") total += value;
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
    valueEl.textContent = typeof value === "number" ? fmtMoney(value) : memberNoValueText(member);
    if(typeof value !== "number" && member.companyRole === "manager" && memberNoValueText(member) !== "—") valueEl.style.fontSize = "12px";

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

function isRedundantCompanyName(name){
  var n = String(name || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\b(gym|academia|academy|fitness)\b/g, "").replace(/\s+/g, " ").trim();
  return n === "" || n === "overall";
}

function loadCompanyOverview(){
  var listEl = document.getElementById("companyStaffList");
  var monthKey = monthKeyNow();
  document.getElementById("companyMonthLabel").textContent = monthLabel(monthKey);
  var exportLabel = document.getElementById("companyExportMonthLabel");
  if(exportLabel) exportLabel.textContent = monthLabel(monthKey);
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
    var nameLabel = document.getElementById("companyNameLabel");
    nameLabel.textContent = r.body.company.name;
    // a logo ja diz "Overall Gym": so mostra o nome se ele acrescentar algo (ex.: "Overall Centro")
    nameLabel.style.display = isRedundantCompanyName(r.body.company.name) ? "none" : "";
    document.getElementById("companyInviteCodeDisplay").value = r.body.company.inviteCode;
    renderCompanyStaffList(r.body.staff, monthKey);
    if(typeof renderTeamManage === "function") renderTeamManage();
    loadPendingInvites();
  }).catch(function(err){
    if(err && err.message === "auth_expired") return;
    listEl.innerHTML = "<p style='font-size:12px;color:var(--text-dim);margin:4px 0;'>Sem conexão com o servidor.</p>";
    console.warn("Falha ao carregar painel da academia:", err);
  });
}

// ---------- convidar profissional por e-mail (com horario ja preenchido) ----------
// Coordenador(a) precisa ser pessoa formada: no seletor de funcao some "Estagiario"
// e o campo em branco vira "Nao e professor (so coordena)". Reaproveitado pela edicao de equipe.
function syncRoleOptionsForAccess(selectEl, accessKey){
  if(!selectEl) return;
  var isCoord = accessKey === "coordinator";
  for(var i = 0; i < selectEl.options.length; i++){
    var o = selectEl.options[i];
    if(o.value === "Estagiário"){ o.disabled = isCoord; o.hidden = isCoord; }
    if(o.value === ""){
      if(!o.dataset.original) o.dataset.original = o.textContent;
      o.textContent = isCoord ? "Não é professor (só coordena)" : o.dataset.original;
    }
  }
  if(isCoord && selectEl.value === "Estagiário") selectEl.value = "Professor";
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
  if(wrap) wrap.style.display = isAdminInvite ? "none" : "";
  // so o dono combina o salario fixo do gerente
  syncRoleOptionsForAccess(roleInput, accessRole);
  var salaryWrap = document.getElementById("inviteSalaryWrap");
  if(salaryWrap) salaryWrap.style.display = (accessRole === "manager" && companyOverviewData && companyOverviewData.viewerRole === "owner") ? "" : "none";
}

document.getElementById("btnOpenInvite").addEventListener("click", function(){
  document.getElementById("inviteForm").reset();
  document.querySelectorAll('input[name="inviteAccessRole"]').forEach(function(r){
    r.closest(".client-day-chip").classList.toggle("checked", r.checked);
  });
  document.getElementById("inviteError").textContent = "";
  document.getElementById("inviteResult").style.display = "none";
  // Um gerente so convida profissional ou coordenador(a); gerente e socio(a) so o dono convida.
  var viewerIsManager = companyOverviewData && companyOverviewData.viewerRole === "manager";
  ["manager", "partner"].forEach(function(v){
    var chip = document.querySelector('input[name="inviteAccessRole"][value="' + v + '"]');
    if(chip) chip.closest(".client-day-chip").style.display = viewerIsManager ? "none" : "";
  });
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
  var applySchedule = !isAdminInvite;
  var shiftStart = applySchedule ? document.getElementById("inviteShiftStart").value : "";
  var shiftEnd = applySchedule ? document.getElementById("inviteShiftEnd").value : "";
  var weekendShift = applySchedule ? document.getElementById("inviteWeekendShift").checked : false;
  var inviteBody = { name: name, email: email, role: role, accessRole: accessRole, shiftStart: shiftStart, shiftEnd: shiftEnd, weekendShift: weekendShift };
  var salaryRaw = document.getElementById("inviteSalary").value.trim();
  if(accessRole === "manager" && salaryRaw !== "") inviteBody.monthlySalary = Number(salaryRaw.replace(",", "."));
  if(!name || !email){ errEl.textContent = "Informe nome e e-mail."; return; }
  // coordenador(a) pode ficar sem funcao ("nao e professor, so coordena"); os demais escolhem uma
  if(!isAdminInvite && !role && accessRole !== "coordinator"){ errEl.textContent = "Escolha a função do profissional."; return; }
  var btn = document.getElementById("inviteSubmit");
  btn.disabled = true; btn.textContent = "Enviando...";
  authFetch("/api/company/invite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(inviteBody)
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

document.getElementById("btnRotateInviteCode").addEventListener("click", function(){
  if(!confirm("Gerar um novo código de convite? O código atual deixa de valer na hora (quem já entrou continua na academia). Se você já passou o código atual para alguém que ainda não se cadastrou, precisará passar o novo.")) return;
  authFetch("/api/company/invite-code/rotate", { method: "POST" }).then(function(res){
    if(res.status === 401){ handleAuthExpired(); throw new Error("auth_expired"); }
    return res.json().then(function(body){ return { ok: res.ok, body: body }; });
  }).then(function(r){
    if(!r.ok){ showToast(authErrorMessage(r.body, "Não consegui gerar um novo código.")); return; }
    document.getElementById("companyInviteCodeDisplay").value = r.body.inviteCode;
    if(companyOverviewData && companyOverviewData.company) companyOverviewData.company.inviteCode = r.body.inviteCode;
    showToast("Novo código gerado");
  }).catch(function(err){
    if(err && err.message === "auth_expired") return;
    showToast("Sem conexão com o servidor.");
  });
});

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

// ---------- exportacao da equipe: Excel (.xlsx) e PDF ----------
function teamExportData(){
  var monthKey = monthKeyNow();
  var rows = [], total = 0;
  ((companyOverviewData && companyOverviewData.staff) || []).forEach(function(member){
    if(!companyRoleCountsFinancially(member)) return;
    var value = memberMonthValue(member, monthKey);
    if(typeof value === "number") total += value;
    rows.push({ name: member.name, role: companyRoleLabel(member), value: typeof value === "number" ? value : null });
  });
  return { monthKey: monthKey, rows: rows, total: total };
}

function exportCompanyTeamXlsx(){
  if(!companyOverviewData || !companyOverviewData.staff){
    showToast("A equipe ainda não carregou. Tente de novo em instantes.");
    return;
  }
  var d = teamExportData();
  showToast("Gerando Excel...");
  loadExcelJs(function(){
    var wb = new window.ExcelJS.Workbook();
    var ws = wb.addWorksheet("Equipe");
    ws.getColumn(1).width = 32; ws.getColumn(2).width = 28; ws.getColumn(3).width = 20;
    ws.mergeCells(1, 1, 1, 3);
    var t = ws.getCell(1, 1);
    t.value = "EQUIPE — " + monthLabel(d.monthKey).toUpperCase();
    t.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
    t.fill = fill(FILL_TITLE);
    ws.getRow(1).height = 26;
    ws.mergeCells(2, 1, 2, 3);
    ws.getCell(2, 1).value = (companyOverviewData.company ? companyOverviewData.company.name : "") + " · gerado em " + new Date().toLocaleDateString("pt-BR");
    ws.getCell(2, 1).font = { size: 9, color: { argb: "FF666666" } };
    ["Nome", "Função", "Valor do mês (R$)"].forEach(function(h, i){
      var c = ws.getCell(4, i + 1);
      c.value = h; c.font = { bold: true, color: { argb: "FF3B0764" } }; c.fill = fill(FILL_HEADER); c.border = THIN_BOX;
      if(i === 2) c.alignment = { horizontal: "right" };
    });
    var r = 5, money = '"R$" #,##0.00';
    d.rows.forEach(function(row){
      ws.getCell(r, 1).value = row.name; ws.getCell(r, 2).value = row.role;
      var vc = ws.getCell(r, 3);
      if(row.value === null){ vc.value = "sem salário definido"; vc.font = { italic: true, color: { argb: "FF888888" } }; }
      else { vc.value = row.value; vc.numFmt = money; }
      vc.alignment = { horizontal: "right" };
      [1, 2, 3].forEach(function(col){ ws.getCell(r, col).border = THIN_BOX; });
      r++;
    });
    ws.mergeCells(r, 1, r, 2);
    var tl = ws.getCell(r, 1); tl.value = "TOTAL"; tl.font = { bold: true }; tl.alignment = { horizontal: "right" }; tl.fill = fill(FILL_TOTAL);
    var tv = ws.getCell(r, 3); tv.value = d.total; tv.numFmt = money; tv.font = { bold: true, color: { argb: "FF059669" } }; tv.alignment = { horizontal: "right" }; tv.fill = fill(FILL_TOTAL); tv.border = THIN_BOX;
    downloadWorkbook(wb, "equipe-overall-" + d.monthKey + ".xlsx").catch(function(err){
      console.error("Falha ao gerar Excel:", err);
      showToast("Não consegui gerar o Excel.");
    });
  });
}

function exportCompanyTeamPdf(){
  if(!companyOverviewData || !companyOverviewData.staff){
    showToast("A equipe ainda não carregou. Tente de novo em instantes.");
    return;
  }
  var d = teamExportData();
  var rows = d.rows.map(function(row){ return [row.name, row.role, row.value === null ? "sem salário definido" : fmtMoney(row.value)]; });
  renderSheetTable(document.getElementById("teamPrintSheet"),
    "Equipe — " + monthLabel(d.monthKey),
    companyOverviewData.company ? companyOverviewData.company.name : "",
    ["Nome", "Função", "Valor do mês"], rows, "Total da equipe", fmtMoney(d.total));
  printSheet("team");
}
document.getElementById("btnCompanyExport").addEventListener("click", exportCompanyTeamXlsx);
document.getElementById("btnCompanyExportPdf").addEventListener("click", exportCompanyTeamPdf);

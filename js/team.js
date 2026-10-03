// team.js — "Gestão da equipe" do painel da academia (dono e gerente): trocar
// função/nível de acesso de quem já entrou, remover quem saiu e ver o
// histórico de alterações. As regras de quem pode mexer em quem são as mesmas
// do servidor (managerCanManage em server.js) — o servidor é quem decide de
// verdade; aqui só escondemos o que a pessoa não pode fazer.
"use strict";

var ACCESS_LABELS = { staff: "Profissional", coordinator: "Coordenador(a)", manager: "Gerente", partner: "Sócio(a)" };
var editingMember = null;

function viewerCompanyRole(){
  return (companyOverviewData && companyOverviewData.viewerRole) || null;
}

function canManageMember(member){
  var viewer = viewerCompanyRole();
  if(!member || member.isOwner) return false;
  if(currentUser && member.id === currentUser.id) return false;
  if(viewer === "owner") return true;
  if(viewer === "manager") return !member.companyRole || member.companyRole === "coordinator";
  return false;
}

function assignableAccess(){
  var viewer = viewerCompanyRole();
  if(viewer === "owner") return ["staff", "coordinator", "manager", "partner"];
  if(viewer === "manager") return ["staff", "coordinator"];
  return [];
}

function memberAccessKey(member){
  return member.companyRole || "staff";
}

function renderTeamManage(){
  var listEl = document.getElementById("teamManageList");
  if(!listEl) return;
  listEl.innerHTML = "";
  var staff = (companyOverviewData && companyOverviewData.staff) || [];
  if(staff.length === 0){
    listEl.innerHTML = "<p style='font-size:12px;color:var(--text-dim);margin:4px 0;'>Ainda ninguém entrou na academia.</p>";
    return;
  }
  staff.forEach(function(member){
    var row = document.createElement("div");
    row.className = "client-row";

    var info = document.createElement("div");
    info.className = "client-info";
    var name = document.createElement("strong");
    name.textContent = member.name + (currentUser && member.id === currentUser.id ? " (você)" : "");
    var meta = document.createElement("span");
    meta.className = "client-meta";
    meta.textContent = companyRoleLabel(member) + " · " + member.email;
    info.appendChild(name);
    info.appendChild(meta);
    row.appendChild(info);

    if(canManageMember(member)){
      var actions = document.createElement("div");
      actions.className = "row-actions";
      actions.style.marginTop = "0";
      var editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "small";
      editBtn.textContent = "Editar";
      editBtn.addEventListener("click", function(){ openStaffEdit(member); });
      actions.appendChild(editBtn);
      row.appendChild(actions);
    }
    listEl.appendChild(row);
  });
}

function openStaffEdit(member){
  editingMember = member;
  document.getElementById("staffEditTitle").textContent = member.name;
  document.getElementById("staffEditSub").textContent = member.email + " · hoje: " + companyRoleLabel(member);
  document.getElementById("staffEditError").textContent = "";

  var grid = document.getElementById("staffEditAccessGrid");
  grid.innerHTML = "";
  var current = memberAccessKey(member);
  assignableAccess().forEach(function(key){
    var chip = document.createElement("label");
    chip.className = "client-day-chip" + (key === current ? " checked" : "");
    var input = document.createElement("input");
    input.type = "radio";
    input.name = "staffEditAccess";
    input.value = key;
    input.checked = key === current;
    input.addEventListener("change", function(){
      grid.querySelectorAll(".client-day-chip").forEach(function(c){ c.classList.remove("checked"); });
      chip.classList.add("checked");
      updateStaffEditRoleVisibility();
    });
    chip.appendChild(input);
    chip.appendChild(document.createTextNode(" " + ACCESS_LABELS[key]));
    grid.appendChild(chip);
  });

  setRoleSelectValue(document.getElementById("staffEditRole"), member.role || "");
  document.getElementById("staffEditSalary").value = typeof member.monthlySalary === "number" ? member.monthlySalary : "";
  updateStaffEditRoleVisibility();
  document.getElementById("staffEditOverlay").classList.add("open");
}

// Gerente e sócio(a) não batem ponto, então "função" não se aplica a eles.
function updateStaffEditRoleVisibility(){
  var checked = document.querySelector('input[name="staffEditAccess"]:checked');
  var key = checked ? checked.value : (editingMember ? memberAccessKey(editingMember) : "staff");
  document.getElementById("staffEditRoleWrap").style.display = (key === "manager" || key === "partner") ? "none" : "";
  // so o dono define o salario fixo do gerente
  document.getElementById("staffEditSalaryWrap").style.display = (key === "manager" && viewerCompanyRole() === "owner") ? "" : "none";
}

document.getElementById("staffEditForm").addEventListener("submit", function(e){
  e.preventDefault();
  if(!editingMember) return;
  var errEl = document.getElementById("staffEditError");
  errEl.textContent = "";
  var checked = document.querySelector('input[name="staffEditAccess"]:checked');
  var accessKey = checked ? checked.value : memberAccessKey(editingMember);
  var roleHidden = accessKey === "manager" || accessKey === "partner";
  var body = { accessRole: accessKey };
  if(!roleHidden) body.role = document.getElementById("staffEditRole").value;
  if(accessKey === "manager" && viewerCompanyRole() === "owner"){
    var salaryRaw = document.getElementById("staffEditSalary").value.trim();
    body.monthlySalary = salaryRaw === "" ? null : Number(salaryRaw.replace(",", "."));
  }
  var btn = document.getElementById("staffEditSave");
  btn.disabled = true; btn.textContent = "Salvando...";
  authFetch("/api/company/staff/" + editingMember.id + "/access", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }).then(function(res){
    if(res.status === 401){ handleAuthExpired(); throw new Error("auth_expired"); }
    return res.json().then(function(b){ return { ok: res.ok, body: b }; });
  }).then(function(r){
    btn.disabled = false; btn.textContent = "Salvar alterações";
    if(!r.ok){ errEl.textContent = authErrorMessage(r.body, "Não consegui salvar."); return; }
    document.getElementById("staffEditOverlay").classList.remove("open");
    showToast(r.body.changed ? "Alterações salvas" : "Nada mudou");
    loadCompanyOverview();
    loadTeamAudit();
  }).catch(function(err){
    if(err && err.message === "auth_expired") return;
    btn.disabled = false; btn.textContent = "Salvar alterações";
    errEl.textContent = "Sem conexão com o servidor. Tente novamente.";
  });
});

document.getElementById("btnStaffRemove").addEventListener("click", function(){
  if(!editingMember) return;
  var member = editingMember;
  if(!confirm("Remover " + member.name + " da academia?\n\nEla sai da equipe, dos valores e da escala. A conta e os dados pessoais dela (horas e alunos particulares) continuam dela — você só deixa de ver.")) return;
  authFetch("/api/company/staff/" + member.id, { method: "DELETE" }).then(function(res){
    if(res.status === 401){ handleAuthExpired(); throw new Error("auth_expired"); }
    return res.json().then(function(b){ return { ok: res.ok, body: b }; });
  }).then(function(r){
    if(!r.ok){ document.getElementById("staffEditError").textContent = authErrorMessage(r.body, "Não consegui remover."); return; }
    document.getElementById("staffEditOverlay").classList.remove("open");
    showToast(member.name + " foi removido(a) da academia");
    loadCompanyOverview();
    if(typeof loadScheduleMonth === "function") loadScheduleMonth(currentScheduleMonthKey());
    loadTeamAudit();
  }).catch(function(err){
    if(err && err.message === "auth_expired") return;
    document.getElementById("staffEditError").textContent = "Sem conexão com o servidor. Tente novamente.";
  });
});

// ---------- histórico de alterações ----------
function auditText(entry){
  var who = entry.actorName || "Alguém";
  var target = entry.targetName || "";
  if(entry.action === "member_updated") return who + " alterou " + target + " (" + entry.detail + ")";
  if(entry.action === "member_removed") return who + " removeu " + target + " da academia";
  if(entry.action === "invite_created") return who + " convidou " + target;
  if(entry.action === "invite_cancelled") return who + " cancelou o convite de " + target;
  if(entry.action === "invite_code_rotated") return who + " gerou um novo código de convite";
  return who + " · " + entry.action;
}

function loadTeamAudit(){
  var listEl = document.getElementById("teamAuditList");
  if(!listEl || !authToken) return;
  authFetch("/api/company/audit").then(function(res){
    if(res.status === 401){ handleAuthExpired(); throw new Error("auth_expired"); }
    return res.json().then(function(b){ return { ok: res.ok, body: b }; });
  }).then(function(r){
    listEl.innerHTML = "";
    if(!r.ok || !r.body || !Array.isArray(r.body.entries)){
      listEl.innerHTML = "<p style='font-size:12px;color:var(--text-dim);margin:4px 0;'>Não consegui carregar o histórico agora.</p>";
      return;
    }
    if(r.body.entries.length === 0){
      listEl.innerHTML = "<p style='font-size:12px;color:var(--text-dim);margin:4px 0;'>Nenhuma alteração registrada ainda.</p>";
      return;
    }
    r.body.entries.forEach(function(entry){
      var row = document.createElement("div");
      row.className = "client-row";
      var info = document.createElement("div");
      info.className = "client-info";
      var text = document.createElement("strong");
      text.style.fontWeight = "600";
      text.textContent = auditText(entry);
      var when = document.createElement("span");
      when.className = "client-meta";
      when.textContent = new Date(entry.createdAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
      info.appendChild(text);
      info.appendChild(when);
      row.appendChild(info);
      listEl.appendChild(row);
    });
  }).catch(function(err){
    if(err && err.message === "auth_expired") return;
    console.warn("Falha ao carregar histórico:", err);
  });
}

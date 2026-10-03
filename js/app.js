// app.js — ponto de entrada do app: decide se mostra o painel de uma
// academia (dono) ou a tela normal de ponto (profissional), instala o PWA e
// registra o service worker. Deve ser o ÚLTIMO <script> carregado no
// index.html, depois de todos os outros js/*.js.
"use strict";

var STORAGE_KEY = null; // definido depois do login, por conta (ver bootApp)
var THEME_KEY = "pontoOverallTheme_v1";

// Categorias de quem usa o app: "estagiario" (grade + VIP), "professor" (grade;
// inclui coordenador, que e um professor com a escala da equipe) e "gerente"
// (so o painel da academia). "Personal" nao e categoria: e o modulo de alunos
// particulares (personalModuleOn) que professor, coordenador e gerente ligam
// para si mesmos.
function roleCategory(){
  if(typeof isGerente === "function" && isGerente()) return "gerente";
  var raw = (currentUser && currentUser.role) ? currentUser.role : "";
  var norm = raw.toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, ""); // remove acentos
  if(norm.indexOf("estagi") >= 0) return "estagiario";
  return "professor";
}

function personalModuleOn(){
  return !!(currentUser && currentUser.personalModule) && roleCategory() !== "estagiario";
}

// Quem pode ligar o modulo de alunos particulares (o servidor tambem confere).
function canUsePersonalModule(){
  if(typeof isCompanyOwner === "function" && (isCompanyOwner() || isPartner())) return false;
  return roleCategory() !== "estagiario";
}

// Aluno VIP so o estagiario atende. A grade de horas e do estagiario e do
// professor (e coordenador); o gerente nao bate ponto. Alunos particulares
// aparecem so para quem ligou o modulo.
function applyRoleVisibility(){
  var cat = roleCategory();
  var showVip = cat === "estagiario";
  var showClients = personalModuleOn();
  var showGrade = cat !== "gerente";
  var showSchedule = showClients; // grade semanal dos alunos particulares
  var vipCard = document.getElementById("vipCard");
  var clientsCard = document.getElementById("clientsCard");
  var gradeCard = document.getElementById("gradeCard");
  var resumoCard = document.getElementById("resumoCard");
  var gradeAccountSections = document.getElementById("gradeAccountSections");
  var obsCard = document.getElementById("obsCard");
  var clientScheduleWrap = document.getElementById("clientScheduleWrap");
  // role-off (alem do display) tambem esconde o cartao na impressao do PDF, ver styles.css
  function setCardVisible(el, show){
    if(!el) return;
    el.style.display = show ? "" : "none";
    el.classList.toggle("role-off", !show);
  }
  setCardVisible(vipCard, showVip);
  setCardVisible(clientsCard, showClients);
  setCardVisible(gradeCard, showGrade);
  setCardVisible(resumoCard, showGrade);
  setCardVisible(obsCard, showGrade);
  var holidaysBtn = document.getElementById("btnApplyHolidays");
  if(holidaysBtn) holidaysBtn.style.display = showGrade ? "" : "none"; // feriados marcam a grade de horarios
  var gradeExport = document.getElementById("exportGradeGroup");
  if(gradeExport) gradeExport.style.display = showGrade ? "" : "none";
  var clientsExport = document.getElementById("exportClientsGroup");
  if(clientsExport) clientsExport.style.display = showClients ? "" : "none";
  if(clientScheduleWrap) clientScheduleWrap.style.display = showSchedule ? "" : "none";
  if(gradeAccountSections) gradeAccountSections.style.display = showGrade ? "" : "none";

  // Quem está ligado a uma academia (companyId) tem o horário de trabalho
  // (grade de segunda a sexta e turno de fim de semana) definido pelo
  // gerente/coordenador(a) de lá, não mais pela própria pessoa — ela mantém
  // controle só do que é dela mesma (alunos particulares, valores rápidos,
  // lembrete). Sem academia (freelancer), continua editando o próprio horário.
  // Coordenador(a) é exceção: ele(a) já é um dos dois papéis que EDITAM a
  // escala da equipe (ver isStaffScheduleEditor/schedule.js) — não faz
  // sentido ele "se fiscalizar" aparecendo na própria lista de edição da
  // equipe (schedule.js já tira ele de lá), então ele continua com controle
  // direto do próprio horário aqui, igual sempre foi. Isso também evita que o
  // horário dele fique sem dono numa academia sem gerente (só dono/sócio(a),
  // que são só leitura).
  var isCompanyLinked = !!(currentUser && currentUser.companyId);
  var selfManagesSchedule = typeof isCoordinator === "function" && isCoordinator();
  var showOwnScheduleEdit = showGrade && (!isCompanyLinked || selfManagesSchedule);
  var ownScheduleEditSection = document.getElementById("ownScheduleEditSection");
  var ownWeekendShiftSection = document.getElementById("ownWeekendShiftSection");
  var companyManagesScheduleHint = document.getElementById("companyManagesScheduleHint");
  if(ownScheduleEditSection) ownScheduleEditSection.style.display = showOwnScheduleEdit ? "" : "none";
  if(ownWeekendShiftSection) ownWeekendShiftSection.style.display = showOwnScheduleEdit ? "" : "none";
  if(companyManagesScheduleHint) companyManagesScheduleHint.style.display = (showGrade && isCompanyLinked && !selfManagesSchedule) ? "" : "none";
}

// Gerente que ligou o "modulo de alunos particulares": alem do painel da
// academia, ele ganha a tela de alunos particulares (so dele). Os dados dele
// carregam e sincronizam como os de qualquer profissional, e os cartoes
// necessarios sao movidos para dentro do painel da academia.
async function bootPersonalModule(){
  STORAGE_KEY = "pontoOverallData_v1_" + currentUser.id;
  data = loadData();
  await resolveInitialSync();
  applyRoleVisibility();
  initMonthState();
  renderMonthSelect();
  renderGrid();
  var companyMain = document.querySelector("#companyDashboard main");
  var companyHeader = document.querySelector("#companyDashboard header");
  var clientsCard = document.getElementById("clientsCard");
  var exportCard = document.getElementById("exportCard");
  var monthBar = document.querySelector("#mainHeader .month-bar");
  if(companyMain && clientsCard) companyMain.appendChild(clientsCard);
  if(companyMain && exportCard) companyMain.appendChild(exportCard);
  if(companyHeader && monthBar) companyHeader.appendChild(monthBar); // seletor de mes e status de sincronizacao
  var t1 = document.getElementById("exportTitle"); if(t1) t1.textContent = "Exportação — alunos particulares";
  var t2 = document.getElementById("companyExportTitle"); if(t2) t2.textContent = "Exportação — equipe";
  document.body.classList.add("has-personal-module");
}

// Mostra (ou nao) a opcao "Tambem atendo alunos particulares" em Minha conta.
function updatePersonalModuleUI(){
  var section = document.getElementById("personalModuleSection");
  if(section) section.style.display = canUsePersonalModule() ? "" : "none";
  var toggle = document.getElementById("personalModuleToggle");
  if(toggle) toggle.checked = !!(currentUser && currentUser.personalModule);
}

// Uma conta de academia (dono) nao tem ponto proprio pra bater — ela so ve o
// painel com a equipe (ver company.js). Uma conta profissional continua
// exatamente como sempre foi.
async function bootApp(){
  hideAuthScreen();
  var mainHeader = document.getElementById("mainHeader");
  var mainDashboard = document.getElementById("mainDashboard");
  var companyDashboard = document.getElementById("companyDashboard");
  if(isCompanyAdminView()){
    if(mainHeader) mainHeader.style.display = "none";
    if(mainDashboard) mainDashboard.style.display = "none";
    if(companyDashboard) companyDashboard.style.display = "block";
    // Dono, sócio(a) e gerente representam a academia — ficam travados na
    // identidade visual da Overall (classe "brand-view", ver
    // applyColorPolicyForCurrentUser em account.js), sem opção de trocar cor.
    if(typeof applyColorPolicyForCurrentUser === "function") applyColorPolicyForCurrentUser();
    // "Minha conta" do painel da academia: só senha e cor — nada de grade/valores rápidos/lembrete.
    var gradeAccount = document.getElementById("gradeAccountSections");
    if(gradeAccount) gradeAccount.style.display = "none";
    setAccountLabel();
    // Só o(a) sócio(a) é 100% leitura — dono e gerente convidam/gerenciam.
    if(typeof applyCompanyReadOnlyUI === "function") applyCompanyReadOnlyUI(isPartner());
    if(typeof mountScheduleCard === "function") mountScheduleCard(companyDashboard.querySelector("main"));
    loadCompanyOverview();
    if(typeof loadScheduleMonth === "function") loadScheduleMonth(currentScheduleMonthKey());
    updatePersonalModuleUI();
    if(isGerente() && currentUser.personalModule) await bootPersonalModule();
    renderFaq();
    setupNav();
    maybeShowOnboarding(isPartner() ? "socio" : (isGerente() ? "gerente" : "empresa"));
    return;
  }
  if(companyDashboard) companyDashboard.style.display = "none";

  STORAGE_KEY = "pontoOverallData_v1_" + currentUser.id;
  data = loadData();
  // Resolve local-vs-servidor ANTES de qualquer coisa (abaixo) que possa
  // chamar saveData() e carimbar data.updatedAt com "agora" — inclusive
  // aplicar o horario sugerido do convite e o initMonthState()/ensureMonth()
  // logo mais. Ver o comentario grande em resolveInitialSync() (state.js).
  // Por isso mainHeader/mainDashboard so ficam visiveis DEPOIS desse await,
  // ja com tudo renderizado: do contrario a tela apareceria em branco por um
  // instante (ou, pior, o tutorial inicial podia abrir por cima de um clique
  // em andamento) enquanto espera a rede — principalmente relevante com o
  // Render gratuito, que pode demorar pra "acordar".
  await resolveInitialSync();
  // Se a academia ja definiu o horario de trabalho dessa pessoa no convite
  // (ver company.js/auth.js), aplica antes de qualquer coisa usar getTimeSlots()
  // — assim ela ja abre com a escala certa, sem precisar configurar nada.
  if(pendingSuggestedSchedule){
    if(Array.isArray(pendingSuggestedSchedule.timeSlots) && pendingSuggestedSchedule.timeSlots.length){
      data.settings.timeSlots = pendingSuggestedSchedule.timeSlots;
    }
    if(typeof pendingSuggestedSchedule.weekendShiftEnabled === "boolean"){
      data.settings.weekendShiftEnabled = pendingSuggestedSchedule.weekendShiftEnabled;
    }
    pendingSuggestedSchedule = null;
    saveData();
  }
  setAccountLabel();
  updatePersonalModuleUI();
  applyRoleVisibility();
  // Coordenador(a) também representa a academia (gerencia a escala da
  // equipe) — fica travado na cor de identidade da Overall igual
  // dono/sócio(a)/gerente. Os demais escolhem a cor livremente.
  if(typeof applyColorPolicyForCurrentUser === "function") applyColorPolicyForCurrentUser();
  initMonthState();
  renderMonthSelect();
  renderGrid();
  renderVip();
  renderQuickValuesUI();
  if(mainHeader) mainHeader.style.display = "";
  if(mainDashboard) mainDashboard.style.display = "";
  initSync();
  startReminderLoop();
  // Coordenador(a) tambem bate ponto normalmente (por isso continua aqui, na
  // grade individual), mas alem disso gerencia a escala de fim de
  // semana/feriado da equipe — o card correspondente aparece na propria tela dele.
  if(isCoordinator() && typeof mountScheduleCard === "function"){
    mountScheduleCard(mainDashboard);
    loadScheduleMonth(currentScheduleMonthKey());
  }
  renderFaq();
  setupNav();
  maybeShowOnboarding(isCoordinator() ? "coordenador" : roleCategory());
}

// ---------- overlay close ----------
function closeOverlays(){
  document.querySelectorAll(".overlay").forEach(function(o){ o.classList.remove("open"); });
  activeDayKey = null; activeVip = null; activeClientId = null;
}
document.querySelectorAll(".overlay").forEach(function(overlay){
  overlay.addEventListener("click", function(e){ if(e.target === overlay) closeOverlays(); });
  overlay.querySelectorAll("[data-close]").forEach(function(b){ b.addEventListener("click", closeOverlays); });
});

// ---------- toast ----------
var toastEl = document.getElementById("toast");
var toastTimer = null;
function showToast(msg){
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ toastEl.classList.remove("show"); }, 2200);
}

// ---------- install prompt ----------
var deferredPrompt = null;
var installBanner = document.getElementById("installBanner");
var installText = document.getElementById("installText");

// O aviso de "Instalar" so faz sentido no celular; no computador o proprio
// navegador ja oferece instalar (icone na barra de endereco), sem nosso aviso.
function isMobileDevice(){
  return /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && window.matchMedia("(pointer:coarse)").matches);
}
window.addEventListener("beforeinstallprompt", function(e){
  if(!isMobileDevice()) return;
  e.preventDefault();
  deferredPrompt = e;
  installBanner.classList.add("show");
});
document.getElementById("btnInstall").addEventListener("click", function(){
  if(!deferredPrompt) return;
  deferredPrompt.prompt();
  deferredPrompt.userChoice.finally(function(){
    deferredPrompt = null;
    installBanner.classList.remove("show");
  });
});

(function checkIOS(){
  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  var isStandalone = window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  if(isIOS && !isStandalone && isMobileDevice()){
    installText.textContent = "No iPhone: toque em Compartilhar e depois \"Adicionar à Tela de Início\".";
    installBanner.classList.add("show");
  }
})();

// ---------- service worker ----------
if("serviceWorker" in navigator){
  window.addEventListener("load", function(){
    navigator.serviceWorker.register("sw.js").catch(function(err){
      console.warn("SW falhou", err);
    });
  });
}

// ---------- init ----------
initTheme();
initColor();
initAuthForms();
initAccountModal();
pendingResetToken = checkResetLink();
pendingInviteToken = checkInviteLink();
if(pendingResetToken){
  showAuthView("reset");
  showAuthScreen();
} else if(pendingInviteToken){
  showAuthView("register");
  showAuthScreen();
  loadInviteFromUrl();
} else {
  resumeSession();
}

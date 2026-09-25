// app.js — ponto de entrada do app: decide se mostra o painel de uma
// academia (dono) ou a tela normal de ponto (profissional), instala o PWA e
// registra o service worker. Deve ser o ÚLTIMO <script> carregado no
// index.html, depois de todos os outros js/*.js.
"use strict";

var STORAGE_KEY = null; // definido depois do login, por conta (ver bootApp)
var THEME_KEY = "pontoOverallTheme_v1";

function roleCategory(){
  var raw = (currentUser && currentUser.role) ? currentUser.role : "";
  var norm = raw.toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, ""); // remove acentos
  if(norm.indexOf("personal") >= 0) return "personal";
  if(norm.indexOf("professor") >= 0) return "professor";
  if(norm.indexOf("estagi") >= 0) return "estagiario";
  return null;
}

// Nem todo mundo usa o app do mesmo jeito: estagiario tem grade + VIP mas nao
// atende aluno particular; professor e personal nao tem alunos VIP (so o
// estagiario atende os VIP da sala) — professor e personal usam a parte de
// alunos particulares. So escondemos quando temos certeza da funcao —
// funcao desconhecida/em branco mostra tudo.
// Personal trainer nao bate ponto nem trabalha em escala fixa (ele mesmo
// pediu pra tirar isso) — pra ele some a grade, o resumo do mes (horas,
// auxilio, consumo) e tudo que so faz sentido pra quem tem escala (lembrete
// de ponto, horario de fim de semana). Fica so o controle de alunos
// particulares: aluno, horario e valor, sem conceito de falta.
function applyRoleVisibility(){
  var cat = roleCategory();
  var showVip = cat === "estagiario" || cat === null;
  var showClients = cat !== "estagiario";
  var showGrade = cat !== "personal";
  var showSchedule = cat === "personal";
  var vipCard = document.getElementById("vipCard");
  var clientsCard = document.getElementById("clientsCard");
  var gradeCard = document.getElementById("gradeCard");
  var resumoCard = document.getElementById("resumoCard");
  var gradeAccountSections = document.getElementById("gradeAccountSections");
  var clientScheduleWrap = document.getElementById("clientScheduleWrap");
  if(vipCard) vipCard.style.display = showVip ? "" : "none";
  if(clientsCard) clientsCard.style.display = showClients ? "" : "none";
  if(gradeCard) gradeCard.style.display = showGrade ? "" : "none";
  if(resumoCard) resumoCard.style.display = showGrade ? "" : "none";
  if(clientScheduleWrap) clientScheduleWrap.style.display = showSchedule ? "" : "none";
  if(gradeAccountSections) gradeAccountSections.style.display = showGrade ? "" : "none";
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
    document.body.classList.add("brand-view");
    // Só o(a) sócio(a) é 100% leitura — dono e gerente convidam/gerenciam.
    if(typeof applyCompanyReadOnlyUI === "function") applyCompanyReadOnlyUI(isPartner());
    if(typeof mountScheduleCard === "function") mountScheduleCard(companyDashboard.querySelector("main"));
    loadCompanyOverview();
    if(typeof loadScheduleMonth === "function") loadScheduleMonth(currentScheduleMonthKey());
    maybeShowOnboarding(isPartner() ? "socio" : (isGerente() ? "gerente" : "empresa"));
    return;
  }
  if(companyDashboard) companyDashboard.style.display = "none";
  document.body.classList.remove("brand-view");

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
  applyRoleVisibility();
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

window.addEventListener("beforeinstallprompt", function(e){
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
  if(isIOS && !isStandalone){
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

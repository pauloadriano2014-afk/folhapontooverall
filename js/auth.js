// auth.js — login, cadastro (profissional ou academia), sessão, e
// esqueci/trocar senha. O cadastro de "academia" cria uma conta de
// administrador (dono) que não usa a grade de ponto normal — veja
// company.js pro painel dela.
"use strict";

// ---------- login / conta ----------
var API_BASE = "https://ponto-overall-api.onrender.com";
var TOKEN_KEY = "pontoOverallToken_v1";
var USER_KEY = "pontoOverallUser_v1";
var authToken = null;
var currentUser = null;
var pendingResetToken = null; // token de "esqueci minha senha" vindo da URL (ver checkResetLink)
var pendingInviteToken = null; // token de convite por e-mail vindo da URL (ver checkInviteLink)
var pendingSuggestedSchedule = null; // horario que a academia ja definiu no convite, aplicado no 1o boot (ver app.js/bootApp)

function authFetch(path, options){
  options = options || {};
  var headers = {};
  for(var k in (options.headers || {})){ headers[k] = options.headers[k]; }
  if(authToken) headers["Authorization"] = "Bearer " + authToken;
  options.headers = headers;
  return fetch(API_BASE + path, options);
}

function showAuthScreen(){
  var el = document.getElementById("authScreen");
  if(el) el.style.display = "flex";
}

function hideAuthScreen(){
  var el = document.getElementById("authScreen");
  if(el) el.style.display = "none";
}

function setAccountLabel(){
  var el = document.getElementById("accountLabel");
  if(el) el.textContent = currentUser ? currentUser.name.split(" ")[0] : "Conta";
}

function isCompanyOwner(){
  return !!(currentUser && currentUser.companyRole === "owner");
}

// Coordenador(a): trabalha normalmente (bate ponto como qualquer
// profissional, ver roleCategory/applyRoleVisibility) e, alem disso, gerencia
// a escala de fim de semana/feriado da equipe — mas nao ve valores
// financeiros da equipe (isso continua exclusivo do dono/socio).
function isCoordinator(){
  return !!(currentUser && currentUser.companyRole === "coordinator");
}

// Socio(a) da academia: mesmo painel do dono, so que so pra acompanhar — sem
// convidar, editar escala nem qualquer outra alteracao.
function isPartner(){
  return !!(currentUser && currentUser.companyRole === "partner");
}

// Quem ve o painel "de cima" (o painel da academia, nao a grade individual):
// dono e socio(a). Coordenador(a) NAO entra aqui — ele continua na propria
// grade individual, so que com o card extra da escala.
function isCompanyAdminView(){
  return isCompanyOwner() || isPartner();
}

function onAuthSuccess(user, token){
  authToken = token;
  currentUser = user;
  try{
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }catch(e){}
  bootApp();
}

function logout(){
  authToken = null;
  currentUser = null;
  clearTimeout(syncTimer);
  clearInterval(reminderTimer);
  lastReminderShownKey = null;
  try{
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }catch(e){}
  document.querySelectorAll(".overlay").forEach(function(o){ o.classList.remove("open"); });
  document.getElementById("loginForm").reset();
  document.getElementById("registerForm").reset();
  document.getElementById("forgotForm").reset();
  document.getElementById("loginError").textContent = "";
  document.getElementById("registerError").textContent = "";
  document.getElementById("forgotError").textContent = "";
  document.getElementById("forgotSuccess").textContent = "";
  // Volta as telas ao estado padrao (conta individual) — se a proxima pessoa a
  // logar nesse aparelho for um profissional normal, ela nao pode herdar o
  // painel de academia ainda visivel de uma sessao anterior.
  var mainHeader = document.getElementById("mainHeader");
  var mainDashboard = document.getElementById("mainDashboard");
  var companyDashboard = document.getElementById("companyDashboard");
  if(mainHeader) mainHeader.style.display = "";
  if(mainDashboard) mainDashboard.style.display = "";
  if(companyDashboard) companyDashboard.style.display = "none";
  document.body.classList.remove("brand-view");
  showAuthView("login");
  showAuthScreen();
}

function handleAuthExpired(){
  showToast("Sua sessão expirou. Entre novamente.");
  logout();
}

function authErrorMessage(body, fallback){
  return (body && body.message) ? body.message : fallback;
}

// Alterna entre as 4 telas dentro do cartao de login: "login", "register",
// "forgot" (pedir link de redefinicao) e "reset" (definir a nova senha, quando
// a pessoa chega pelo link do e-mail). As abas Entrar/Criar conta só aparecem
// nas duas primeiras.
function showAuthView(view){
  var tabs = document.getElementById("authTabs");
  var hint = document.getElementById("authHint");
  var isTabView = (view === "login" || view === "register");
  tabs.style.display = isTabView ? "flex" : "none";
  hint.style.display = isTabView ? "block" : "none";
  document.getElementById("tabLogin").classList.toggle("active", view === "login");
  document.getElementById("tabRegister").classList.toggle("active", view === "register");
  document.getElementById("loginForm").style.display = view === "login" ? "flex" : "none";
  document.getElementById("registerForm").style.display = view === "register" ? "flex" : "none";
  document.getElementById("forgotForm").style.display = view === "forgot" ? "flex" : "none";
  document.getElementById("resetForm").style.display = view === "reset" ? "flex" : "none";
}

// Mostra os campos certos pro tipo de conta escolhido no cadastro: um
// profissional preenche função + (opcionalmente) o código de convite da
// academia; uma academia preenche o nome dela em vez disso.
function applyRegAccountTypeUI(type){
  var isCompany = type === "empresa";
  document.getElementById("regRoleWrap").style.display = isCompany ? "none" : "";
  document.getElementById("regCompanyNameWrap").style.display = isCompany ? "" : "none";
  document.getElementById("regInviteCodeWrap").style.display = isCompany ? "none" : "";
}

// ---------- convite por e-mail (link "?invite=<token>") ----------
// Quando o profissional abre o link que a academia mandou, a tela de cadastro
// ja vem com nome/funcao/e-mail preenchidos e o tipo de conta travado em
// "profissional" — nao precisa digitar nem colar codigo nenhum.
function checkInviteLink(){
  var token = null;
  try{
    token = new URLSearchParams(window.location.search).get("invite");
  }catch(e){}
  return token || null;
}

function clearInviteFromUrl(){
  pendingInviteToken = null;
  try{ window.history.replaceState({}, document.title, window.location.pathname); }catch(e){}
}

function applyInviteToForm(inviteInfo){
  var banner = document.getElementById("regInviteBanner");
  var bannerCompany = document.getElementById("regInviteBannerCompany");
  var accountTypeWrap = document.getElementById("regAccountTypeWrap");
  var inviteCodeWrap = document.getElementById("regInviteCodeWrap");
  if(banner) banner.style.display = "";
  if(bannerCompany) bannerCompany.textContent = inviteInfo.companyName || "sua academia";
  if(accountTypeWrap) accountTypeWrap.style.display = "none";
  if(inviteCodeWrap) inviteCodeWrap.style.display = "none";
  document.getElementById("regName").value = inviteInfo.name || "";
  document.getElementById("regRole").value = inviteInfo.role || "";
  document.getElementById("regEmail").value = inviteInfo.email || "";
}

function loadInviteFromUrl(){
  if(!pendingInviteToken) return;
  fetch(API_BASE + "/api/company/invite/" + encodeURIComponent(pendingInviteToken)).then(function(res){
    return res.json().then(function(body){ return { ok: res.ok, body: body }; });
  }).then(function(r){
    if(!r.ok || !r.body || !r.body.valid){
      clearInviteFromUrl();
      showToast("Esse link de convite não é mais válido. Peça um novo pra academia.");
      return;
    }
    applyInviteToForm(r.body);
  }).catch(function(err){
    console.warn("Falha ao carregar convite:", err);
  });
}

function initAuthForms(){
  var tabLogin = document.getElementById("tabLogin");
  var tabRegister = document.getElementById("tabRegister");
  var loginForm = document.getElementById("loginForm");
  var registerForm = document.getElementById("registerForm");

  tabLogin.addEventListener("click", function(){ showAuthView("login"); });
  tabRegister.addEventListener("click", function(){ showAuthView("register"); });

  document.querySelectorAll('input[name="regAccountType"]').forEach(function(radio){
    radio.addEventListener("change", function(){
      document.querySelectorAll('input[name="regAccountType"]').forEach(function(r){
        r.closest(".client-day-chip").classList.toggle("checked", r.checked);
      });
      applyRegAccountTypeUI(radio.value);
    });
  });

  loginForm.addEventListener("submit", function(e){
    e.preventDefault();
    var errEl = document.getElementById("loginError");
    errEl.textContent = "";
    var email = document.getElementById("loginEmail").value.trim();
    var password = document.getElementById("loginPassword").value;
    var btn = document.getElementById("loginSubmit");
    btn.disabled = true; btn.textContent = "Entrando...";
    fetch(API_BASE + "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email, password: password })
    }).then(function(res){
      return res.json().then(function(body){ return { ok: res.ok, body: body }; });
    }).then(function(r){
      btn.disabled = false; btn.textContent = "Entrar";
      if(!r.ok){
        errEl.textContent = authErrorMessage(r.body, "Não consegui entrar. Confira e-mail e senha.");
        return;
      }
      onAuthSuccess(r.body.user, r.body.token);
    }).catch(function(err){
      btn.disabled = false; btn.textContent = "Entrar";
      errEl.textContent = "Sem conexão com o servidor. Tente novamente.";
      console.warn("Falha no login:", err);
    });
  });

  registerForm.addEventListener("submit", function(e){
    e.preventDefault();
    var errEl = document.getElementById("registerError");
    errEl.textContent = "";
    var accountTypeInput = document.querySelector('input[name="regAccountType"]:checked');
    var accountType = pendingInviteToken ? "profissional" : (accountTypeInput ? accountTypeInput.value : "profissional");
    var name = document.getElementById("regName").value.trim();
    var role = document.getElementById("regRole").value.trim();
    var companyName = document.getElementById("regCompanyName").value.trim();
    var inviteCode = document.getElementById("regInviteCode").value.trim();
    var email = document.getElementById("regEmail").value.trim();
    var password = document.getElementById("regPassword").value;
    var btn = document.getElementById("registerSubmit");
    if(accountType === "empresa" && !companyName){
      errEl.textContent = "Informe o nome da academia.";
      return;
    }
    btn.disabled = true; btn.textContent = "Criando...";
    fetch(API_BASE + "/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountType: accountType,
        name: name,
        role: role,
        companyName: companyName,
        inviteCode: inviteCode,
        inviteToken: pendingInviteToken || "",
        email: email,
        password: password
      })
    }).then(function(res){
      return res.json().then(function(body){ return { ok: res.ok, body: body }; });
    }).then(function(r){
      btn.disabled = false; btn.textContent = "Criar conta";
      if(!r.ok){
        errEl.textContent = authErrorMessage(r.body, "Não consegui criar a conta.");
        return;
      }
      if(r.body.user && r.body.user.suggestedSchedule){
        pendingSuggestedSchedule = r.body.user.suggestedSchedule;
      }
      clearInviteFromUrl();
      onAuthSuccess(r.body.user, r.body.token);
    }).catch(function(err){
      btn.disabled = false; btn.textContent = "Criar conta";
      errEl.textContent = "Sem conexão com o servidor. Tente novamente.";
      console.warn("Falha no cadastro:", err);
    });
  });

  document.getElementById("btnForgotPassword").addEventListener("click", function(){
    document.getElementById("forgotEmail").value = document.getElementById("loginEmail").value.trim();
    document.getElementById("forgotError").textContent = "";
    document.getElementById("forgotSuccess").textContent = "";
    showAuthView("forgot");
  });
  document.getElementById("btnBackToLoginFromForgot").addEventListener("click", function(){
    showAuthView("login");
  });
  document.getElementById("btnBackToLoginFromReset").addEventListener("click", function(){
    pendingResetToken = null;
    try{
      window.history.replaceState({}, document.title, window.location.pathname);
    }catch(hErr){}
    document.getElementById("resetForm").reset();
    document.getElementById("resetError").textContent = "";
    showAuthView("login");
  });

  document.getElementById("forgotForm").addEventListener("submit", function(e){
    e.preventDefault();
    var errEl = document.getElementById("forgotError");
    var okEl = document.getElementById("forgotSuccess");
    errEl.textContent = ""; okEl.textContent = "";
    var email = document.getElementById("forgotEmail").value.trim();
    var btn = document.getElementById("forgotSubmit");
    btn.disabled = true; btn.textContent = "Enviando...";
    fetch(API_BASE + "/api/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email })
    }).then(function(res){
      return res.json().then(function(body){ return { ok: res.ok, body: body }; });
    }).then(function(r){
      btn.disabled = false; btn.textContent = "Enviar link de redefinição";
      if(!r.ok){
        errEl.textContent = authErrorMessage(r.body, "Não consegui enviar o e-mail agora.");
        return;
      }
      okEl.textContent = authErrorMessage(r.body, "Se esse e-mail tiver uma conta, enviamos um link de redefinição. Confira sua caixa de entrada (e o spam).");
      document.getElementById("forgotForm").reset();
    }).catch(function(err){
      btn.disabled = false; btn.textContent = "Enviar link de redefinição";
      errEl.textContent = "Sem conexão com o servidor. Tente novamente.";
      console.warn("Falha ao pedir redefinição de senha:", err);
    });
  });

  document.getElementById("resetForm").addEventListener("submit", function(e){
    e.preventDefault();
    var errEl = document.getElementById("resetError");
    errEl.textContent = "";
    if(!pendingResetToken){
      errEl.textContent = "Link inválido. Peça um novo em \"Esqueci minha senha\".";
      return;
    }
    var newPassword = document.getElementById("resetPassword").value;
    var btn = document.getElementById("resetSubmit");
    btn.disabled = true; btn.textContent = "Salvando...";
    fetch(API_BASE + "/api/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: pendingResetToken, newPassword: newPassword })
    }).then(function(res){
      return res.json().then(function(body){ return { ok: res.ok, body: body }; });
    }).then(function(r){
      btn.disabled = false; btn.textContent = "Salvar nova senha";
      if(!r.ok){
        errEl.textContent = authErrorMessage(r.body, "Não consegui redefinir a senha.");
        return;
      }
      pendingResetToken = null;
      try{
        window.history.replaceState({}, document.title, window.location.pathname);
      }catch(hErr){}
      document.getElementById("resetForm").reset();
      showAuthView("login");
      showToast("Senha redefinida! Faça login com a nova senha.");
    }).catch(function(err){
      btn.disabled = false; btn.textContent = "Salvar nova senha";
      errEl.textContent = "Sem conexão com o servidor. Tente novamente.";
      console.warn("Falha ao redefinir senha:", err);
    });
  });
}

function resumeSession(){
  var token = null, user = null;
  try{
    token = localStorage.getItem(TOKEN_KEY);
    var raw = localStorage.getItem(USER_KEY);
    user = raw ? JSON.parse(raw) : null;
  }catch(e){}
  if(token && user){
    authToken = token;
    currentUser = user;
    bootApp();
  } else {
    showAuthScreen();
  }
}

function checkResetLink(){
  var token = null;
  try{
    token = new URLSearchParams(window.location.search).get("reset");
  }catch(e){}
  return token || null;
}

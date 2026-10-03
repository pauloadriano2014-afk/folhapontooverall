// nav.js — menu de navegação: barra lateral no computador, barra inferior no
// celular. Cada item do menu mostra só os cartões (.card[data-view="..."])
// daquela categoria, em vez de uma página enorme com tudo junto. Quais itens
// aparecem depende do perfil (estagiário, professor, personal, coordenador,
// dono/gerente/sócio) — ver navItemsForCurrentUser().
"use strict";

var NAV_VIEW_KEY = "pontoOverallNavView_v1_";
// Telas em que o seletor de mês (e Hoje / Novo mês / Marcar feriados) faz sentido.
var MONTH_VIEWS = ["resumo", "grade", "vip", "clientes", "exportacao"];
var currentView = null;

// Quais categorias cada perfil enxerga, na ordem do menu. O primeiro é a tela inicial.
function navItemsForCurrentUser(){
  if(typeof isCompanyAdminView === "function" && isCompanyAdminView()){
    var items = ["equipe", "escala"];
    if(!isPartner()) items.push("gestao", "convites");
    if(isGerente() && currentUser.personalModule) items.push("clientes");
    items.push("exportacao", "duvidas");
    return items;
  }
  var cat = roleCategory();
  var items2 = ["grade", "resumo"];
  if(cat === "estagiario") items2.push("vip");
  if(personalModuleOn()) items2.push("clientes");
  // quem esta numa academia: coordenador monta a escala; os demais veem a escala publicada
  var linked = !!(currentUser && currentUser.companyId);
  if(typeof isCoordinator === "function" && isCoordinator()) items2.push("escala");
  else if(linked) items2.push("minhaescala");
  if(linked) items2.push("avisos");
  items2.push("exportacao", "duvidas");
  return items2;
}

function activeDashboardEl(){
  var company = document.getElementById("companyDashboard");
  if(company && company.style.display === "block") return company;
  return document.getElementById("mainDashboard");
}

function showView(view){
  var allowed = navItemsForCurrentUser();
  if(allowed.indexOf(view) < 0) view = allowed[0];
  currentView = view;
  var root = activeDashboardEl();
  if(root){
    root.querySelectorAll(".card[data-view]").forEach(function(card){
      var views = card.getAttribute("data-view").split(" ");
      card.classList.toggle("view-off", views.indexOf(view) < 0);
    });
  }
  document.querySelectorAll("#appNav .nav-item[data-view]").forEach(function(btn){
    var isActive = btn.getAttribute("data-view") === view;
    btn.classList.toggle("active", isActive);
    // no celular o menu rola de lado: deixa o item ativo inteiro a vista
    if(isActive && window.innerWidth < 900 && btn.scrollIntoView){
      try{ btn.scrollIntoView({ inline: "center", block: "nearest" }); }catch(e){}
    }
  });
  document.body.setAttribute("data-view", view);
  if(view === "gestao" && typeof loadTeamAudit === "function") loadTeamAudit();
  if(view === "escala" && typeof loadRoster === "function") loadRoster();
  if(view === "minhaescala" && typeof loadMyRoster === "function") loadMyRoster();
  if(view === "avisos" && typeof loadNotices === "function") loadNotices();
  document.body.classList.toggle("hide-month", MONTH_VIEWS.indexOf(view) < 0);
  if(currentUser){
    try{ localStorage.setItem(NAV_VIEW_KEY + currentUser.id, view); }catch(e){}
  }
  window.scrollTo(0, 0);
}

// Monta o menu do perfil logado e abre a última tela usada (ou a inicial).
function setupNav(){
  var nav = document.getElementById("appNav");
  if(!nav) return;
  var allowed = navItemsForCurrentUser();
  nav.querySelectorAll(".nav-item[data-view]").forEach(function(btn){
    var show = allowed.indexOf(btn.getAttribute("data-view")) >= 0;
    btn.hidden = !show;
    // mantém a ordem definida acima (o menu é reordenado de acordo com o perfil)
    if(show) btn.style.order = String(allowed.indexOf(btn.getAttribute("data-view")));
  });
  var account = document.getElementById("btnAccount");
  var logoutBtn = document.getElementById("btnNavLogout");
  var themeBtn = document.getElementById("btnTheme");
  if(themeBtn) themeBtn.style.order = "49";
  if(account) account.style.order = "50";
  if(logoutBtn) logoutBtn.style.order = "51";
  nav.style.display = "block";
  document.body.classList.add("has-nav");
  var saved = null;
  try{ saved = currentUser ? localStorage.getItem(NAV_VIEW_KEY + currentUser.id) : null; }catch(e){}
  showView(saved || allowed[0]);
}

function teardownNav(){
  var nav = document.getElementById("appNav");
  if(nav) nav.style.display = "none";
  document.body.classList.remove("has-nav", "hide-month");
  document.body.removeAttribute("data-view");
}

document.querySelectorAll("#appNav .nav-item[data-view]").forEach(function(btn){
  btn.addEventListener("click", function(){ showView(btn.getAttribute("data-view")); });
});
var btnNavLogout = document.getElementById("btnNavLogout");
if(btnNavLogout){
  btnNavLogout.addEventListener("click", function(){
    if(confirm("Sair da conta neste aparelho?")) logout();
  });
}

// onboarding.js — tutorial curto mostrado uma vez pra cada conta, em passos
// (um cartao por vez, com icone, titulo curto e progresso). Reaproveita o
// overlay do resto do app; a categoria "Duvidas" reabre quando a pessoa quiser.
// Guardado so no aparelho (localStorage): e uma dica de uso, nao sincroniza.
"use strict";

var ONBOARDING_SEEN_PREFIX = "pontoOverallOnboardingSeen_v1_";

var ONBOARDING_INTRO = {
  empresa:     { icon: "🏢", title: "Bem-vindo ao painel da academia", sub: "Veja em 1 minuto como acompanhar sua equipe." },
  socio:       { icon: "👀", title: "Bem-vindo(a), sócio(a)", sub: "Seu acesso é de acompanhamento. Veja o que aparece pra você." },
  gerente:     { icon: "🧭", title: "Bem-vindo(a), gerente", sub: "Veja em 1 minuto o que você pode fazer por aqui." },
  coordenador: { icon: "📋", title: "Bem-vindo(a), coordenador(a)", sub: "Você bate ponto e também cuida da escala da equipe." },
  professor:   { icon: "💪", title: "Bem-vindo(a) ao Ponto Overall", sub: "Veja em 1 minuto como lançar suas horas." },
  estagiario:  { icon: "💪", title: "Bem-vindo(a) ao Ponto Overall", sub: "Veja em 1 minuto como lançar suas horas." }
};

function onboardingSteps(kind){
  if(kind === "empresa"){
    return [
      { icon: "👥", title: "Monte sua equipe", text: "Compartilhe o código de convite ou convide por e-mail. Quem entra já fica ligado à sua academia." },
      { icon: "💰", title: "Acompanhe os valores", text: "Em Equipe e valores você vê quanto cada profissional tem a receber no mês pelas horas de sala. Aluno particular é renda pessoal e nunca aparece aqui." },
      { icon: "🛠️", title: "Cuide de quem entra e sai", text: "Em Gestão da equipe você troca a função ou o nível de acesso, remove quem saiu e define o salário fixo de cada gerente." },
      { icon: "✉️", title: "Convites completos", text: "No convite escolha o nível: Profissional, Coordenador(a), Gerente ou Sócio(a), e já informe o horário de trabalho. Se o código vazar, gere um novo em Convites." },
      { icon: "📅", title: "Escala de fim de semana", text: "A coordenação monta quem faz cada turno e publica; a equipe é avisada. Você acompanha e vê se está equilibrada entre todos." }
    ];
  }
  if(kind === "socio"){
    return [
      { icon: "💰", title: "Equipe e valores", text: "Você vê quanto cada profissional tem a receber no mês pelas horas de sala, e o salário fixo dos gerentes." },
      { icon: "📅", title: "Escala da equipe", text: "Acompanhe quem trabalhou fim de semana e feriado e se a escala está equilibrada." },
      { icon: "🔒", title: "Só acompanhamento", text: "Você não convida pessoas nem edita nada. Quem faz isso é o dono ou o(a) gerente. Alunos particulares nunca aparecem pra você." }
    ];
  }
  if(kind === "gerente"){
    return [
      { icon: "🛠️", title: "Gerencie a equipe", text: "Em Gestão da equipe você altera e remove profissionais e coordenadores. Em Convites você chama gente nova por e-mail ou pelo código." },
      { icon: "📅", title: "Escala e fechamento do mês", text: "Monte a escala de fim de semana e feriado, ajuste o horário de cada profissional e, no fim do mês, confira e feche as horas em Fechamento do mês." },
      { icon: "💼", title: "Seu salário", text: "Você não bate ponto: seu valor é um salário mensal fixo, definido pelo dono. Você vê só o seu." },
      { icon: "🔒", title: "Privacidade dos alunos", text: "Você vê só o valor das horas de sala. Aluno particular é renda pessoal e não aparece pra ninguém da academia." },
      { icon: "🏋️", title: "Atende alunos particulares?", text: "Ligue \"Também atendo alunos particulares\" em Minha conta. A tela aparece no menu e é só sua: o dono e os sócios nunca veem esses dados." }
    ];
  }
  if(kind === "coordenador"){
    return [
      { icon: "⏱️", title: "Bate ponto como todo mundo", text: "Sua grade de horas funciona igual à dos outros profissionais." },
      { icon: "📅", title: "Monte a escala", text: "Em Escala planejada, toque num dia, escolha quem faz cada turno e salve: estagiário de manhã, estagiário à tarde e professor das 10h às 14h. Os horários você ajusta quando quiser." },
      { icon: "📣", title: "Publique e avise", text: "Ao publicar, a equipe vê a escala e cada pessoa escalada recebe um aviso e confirma com \"Estou ciente\". Mudou algo? Publique de novo. Pedidos de troca chegam para você aprovar." },
      { icon: "🔍", title: "Equilíbrio, presença e fechamento", text: "Veja quantos plantões cada um tem, registre depois do dia quem trabalhou, faltou ou foi coberto e, no fim do mês, confira e feche em Fechamento do mês." },
      { icon: "🔒", title: "Valores só com a gestão", text: "Você não vê o salário da equipe. Isso fica com o dono e os sócios. Atende alunos particulares? Ligue o módulo em Minha conta." }
    ];
  }
  if(kind === "estagiario"){
    return [
      { icon: "✍️", title: "Lance suas horas", text: "Toque no número de um dia na grade e escolha o valor de cada horário." },
      { icon: "⚡", title: "Valores rápidos", text: "Atalhos como 10 e 15 para não digitar toda vez. Você edita quando quiser." },
      { icon: "⭐", title: "Alunos VIP", text: "A agenda semanal fixa fica separada da grade. Marque presença ou falta ali." },
      { icon: "📅", title: "Sua escala de fim de semana", text: "Se você está numa academia, veja seus plantões em Escala da equipe, confirme com \"Estou ciente\" e peça troca quando precisar. Os avisos chegam em Avisos." },
      { icon: "🔄", title: "Tudo sincronizado", text: "Seus dados acompanham você no celular e no computador. O indicador no topo mostra se está tudo salvo." }
    ];
  }
  // professor (e qualquer outra funcao)
  return [
    { icon: "✍️", title: "Lance suas horas", text: "Toque no número de um dia na grade e escolha o valor de cada horário." },
    { icon: "⚡", title: "Valores rápidos", text: "Atalhos como 10 e 15 para não digitar toda vez. Você edita quando quiser." },
    { icon: "🏋️", title: "Atende alunos particulares?", text: "Ligue \"Também atendo alunos particulares\" em Minha conta. A tela aparece no menu e é só sua: a academia nunca vê esses dados." },
    { icon: "📅", title: "Sua escala de fim de semana", text: "Se você está numa academia, veja seus plantões em Escala da equipe, confirme com \"Estou ciente\" e peça troca quando precisar. Os avisos chegam em Avisos." },
    { icon: "🔄", title: "Tudo sincronizado", text: "Seus dados acompanham você no celular e no computador. O indicador no topo mostra se está tudo salvo." }
  ];
}

var obSteps = [];
var obIndex = 0;

function renderOnboardingStep(animate){
  var step = obSteps[obIndex];
  if(!step) return;
  var last = obIndex === obSteps.length - 1;
  document.getElementById("obIco").textContent = step.icon;
  document.getElementById("obStepTitle").textContent = step.title;
  document.getElementById("obStepText").textContent = step.text;
  document.getElementById("obBack").style.visibility = obIndex === 0 ? "hidden" : "visible";
  document.getElementById("obNext").textContent = last ? "Começar" : "Próximo";
  document.getElementById("obClose").textContent = last ? "Fechar" : "Pular";
  var dots = document.getElementById("obDots").children;
  for(var i = 0; i < dots.length; i++) dots[i].classList.toggle("active", i === obIndex);
  document.getElementById("obCount").textContent = "Passo " + (obIndex + 1) + " de " + obSteps.length;
  var card = document.getElementById("obCard");
  card.classList.remove("anim");
  if(animate){ void card.offsetWidth; card.classList.add("anim"); }
}

function showOnboarding(kind){
  var intro = ONBOARDING_INTRO[kind] || ONBOARDING_INTRO.professor;
  obSteps = onboardingSteps(kind);
  obIndex = 0;
  document.getElementById("obBadge").textContent = intro.icon;
  document.getElementById("onboardingTitle").textContent = intro.title;
  document.getElementById("onboardingSub").textContent = intro.sub;
  var dotsEl = document.getElementById("obDots");
  dotsEl.innerHTML = "";
  obSteps.forEach(function(s, i){
    var d = document.createElement("button");
    d.type = "button";
    d.className = "ob-dot";
    d.setAttribute("aria-label", "Ir para o passo " + (i + 1));
    d.addEventListener("click", function(){ obIndex = i; renderOnboardingStep(true); });
    dotsEl.appendChild(d);
  });
  renderOnboardingStep(false);
  document.getElementById("onboardingOverlay").classList.add("open");
}

document.getElementById("obNext").addEventListener("click", function(){
  if(obIndex >= obSteps.length - 1){ closeOverlays(); return; }
  obIndex++; renderOnboardingStep(true);
});
document.getElementById("obBack").addEventListener("click", function(){
  if(obIndex > 0){ obIndex--; renderOnboardingStep(true); }
});
document.addEventListener("keydown", function(e){
  if(!document.getElementById("onboardingOverlay").classList.contains("open")) return;
  if(e.key === "ArrowRight") document.getElementById("obNext").click();
  if(e.key === "ArrowLeft") document.getElementById("obBack").click();
});

// Mostra so na primeira vez que essa conta loga neste aparelho (marcado por
// usuario — se a pessoa usar outro aparelho, ve de novo uma vez, o que e um
// efeito colateral aceitavel pra algo que e so uma dica).
function maybeShowOnboarding(kind){
  if(!currentUser) return;
  var key = ONBOARDING_SEEN_PREFIX + currentUser.id;
  var seen = false;
  try{ seen = localStorage.getItem(key) === "1"; }catch(e){}
  if(seen) return;
  try{ localStorage.setItem(key, "1"); }catch(e){}
  showOnboarding(kind);
}

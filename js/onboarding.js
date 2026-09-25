// onboarding.js — tutorial curto mostrado uma vez pra cada conta (dono de
// academia ou profissional), explicando o que fazer e pra que serve cada
// parte. Reaproveita o mesmo overlay/sheet do resto do app, e o botão "❓" no
// topo reabre a qualquer momento. Guardado só no aparelho (localStorage) —
// é uma dica de uso, não precisa sincronizar entre aparelhos.
"use strict";

var ONBOARDING_SEEN_PREFIX = "pontoOverallOnboardingSeen_v1_";

function onboardingTitle(kind){
  if(kind === "empresa") return "Como funciona o painel da academia";
  if(kind === "socio") return "Como funciona pra sócio(a)";
  if(kind === "gerente") return "Como funciona pra gerente";
  if(kind === "coordenador") return "Como funciona pra coordenador(a)";
  if(kind === "personal") return "Como funciona pra personal/particular";
  return "Como funciona a grade de horas";
}

function onboardingSteps(kind){
  if(kind === "empresa"){
    return [
      "Compartilhe o código de convite (ou use \"Convidar profissional por e-mail\") com cada professor, estagiário ou personal da academia.",
      "Ao se cadastrar com o código ou o link, o profissional já aparece automaticamente na sua lista de equipe, ligado à sua academia.",
      "Neste painel você acompanha quanto cada profissional tem a receber no mês, calculado a partir do que cada um já lançou na própria conta.",
      "Se você já sabe o horário de trabalho de alguém, defina ele no convite por e-mail — a pessoa já entra com a escala certa, sem precisar configurar nada.",
      "No convite, escolha o \"Nível de acesso\": Profissional (padrão), Coordenador(a) (também gerencia a escala de fim de semana/feriado), Gerente (gerencia tudo igual a você, exceto valor de aluno particular da equipe) ou Sócio(a) (só acompanha, sem editar nada)."
    ];
  }
  if(kind === "socio"){
    return [
      "Você vê o mesmo painel do dono da academia — equipe, quanto cada um tem a receber no mês e a escala de fim de semana/feriado.",
      "É um acesso só de acompanhamento: você não convida profissionais nem edita a escala — quem faz isso é o dono, o(a) gerente ou o(a) coordenador(a) (só a escala, no caso dele).",
      "O relatório \"Quem ainda não trabalhou fim de semana/feriado\" ajuda a enxergar rápido se a escala está equilibrada entre a equipe."
    ];
  }
  if(kind === "gerente"){
    return [
      "Você gerencia a equipe igual ao dono da academia: convida profissionais e coordenadores(as) por e-mail ou pelo código de convite, e também edita a escala de fim de semana/feriado.",
      "A diferença: você não vê o valor que um profissional ganha com aluno particular (isso é renda pessoal dele) — só o valor de quando ele trabalha na grade/sala, pago pela academia.",
      "O relatório \"Quem ainda não trabalhou fim de semana/feriado\" ajuda a enxergar rápido se a escala está equilibrada entre a equipe.",
      "Você não bate ponto nem tem grade própria — seu acesso é só o painel de gestão da academia."
    ];
  }
  if(kind === "coordenador"){
    return [
      "Você bate ponto normalmente, como qualquer profissional — sua grade de horas funciona igual à de todo mundo.",
      "Além disso, você tem o card \"Escala da equipe\": toque num dia pra lançar quem trabalhou, faltou ou foi coberto (com motivo, se quiser anotar).",
      "O relatório \"Quem ainda não trabalhou fim de semana/feriado\" mostra rapidinho se algum profissional está ficando de fora da escala.",
      "Você não vê os valores financeiros da equipe (salário de cada um) — isso continua só com o dono/sócio(a) da academia."
    ];
  }
  if(kind === "personal"){
    return [
      "Cadastre cada aluno particular em \"+ Novo aluno particular\", com o valor por sessão (ou mensal fixo) e os dias da semana.",
      "Toque em um horário na grade pra ver, editar ou adicionar rapidamente um aluno naquele dia e horário.",
      "O total esperado do mês é calculado sozinho, a partir dos alunos e dias cadastrados.",
      "Seus dados sincronizam sozinhos entre o celular e o computador — o ícone no topo mostra o status da sincronização."
    ];
  }
  // estagiario/professor/funcao desconhecida: grade de horas + VIP
  return [
    "Toque em um dia na grade pra lançar as horas trabalhadas naquele dia.",
    "Os \"valores rápidos\" (ex: 10, 15) são atalhos pro valor da hora/aula — edite em \"Valores rápidos\" a qualquer momento.",
    "Alunos VIP têm agenda semanal fixa, separada da grade — marque presença/falta ali quando precisar.",
    "Seus dados sincronizam sozinhos entre o celular e o computador — o ícone no topo mostra o status da sincronização."
  ];
}

function showOnboarding(kind){
  var titleEl = document.getElementById("onboardingTitle");
  var stepsEl = document.getElementById("onboardingSteps");
  if(!titleEl || !stepsEl) return;
  titleEl.textContent = onboardingTitle(kind);
  stepsEl.innerHTML = "";
  onboardingSteps(kind).forEach(function(text, i){
    var row = document.createElement("div");
    row.className = "slot-row";
    var num = document.createElement("span");
    num.className = "time";
    num.textContent = (i + 1) + ".";
    var desc = document.createElement("span");
    desc.className = "current";
    desc.style.fontWeight = "400";
    desc.textContent = text;
    row.appendChild(num);
    row.appendChild(desc);
    stepsEl.appendChild(row);
  });
  document.getElementById("onboardingOverlay").classList.add("open");
}

// Mostra so na primeira vez que essa conta loga neste aparelho (marcado por
// usuario, nao por conta — se a pessoa usar outro aparelho, ve de novo uma
// vez, o que e um efeito colateral aceitavel pra algo que e so uma dica).
function maybeShowOnboarding(kind){
  if(!currentUser) return;
  var key = ONBOARDING_SEEN_PREFIX + currentUser.id;
  var seen = false;
  try{ seen = localStorage.getItem(key) === "1"; }catch(e){}
  if(seen) return;
  try{ localStorage.setItem(key, "1"); }catch(e){}
  showOnboarding(kind);
}

var btnHelpIndividual = document.getElementById("btnHelpIndividual");
if(btnHelpIndividual){
  btnHelpIndividual.addEventListener("click", function(){
    showOnboarding(typeof isCoordinator === "function" && isCoordinator() ? "coordenador" : roleCategory());
  });
}
var btnHelpCompany = document.getElementById("btnHelpCompany");
if(btnHelpCompany){
  btnHelpCompany.addEventListener("click", function(){
    var kind = (typeof isPartner === "function" && isPartner()) ? "socio"
      : (typeof isGerente === "function" && isGerente()) ? "gerente"
      : "empresa";
    showOnboarding(kind);
  });
}

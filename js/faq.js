// faq.js — a categoria "Dúvidas" do menu: perguntas e respostas e o glossário
// de cada termo do app, escritas de acordo com o perfil de quem está usando.
"use strict";

function helpKind(){
  if(typeof isCompanyAdminView === "function" && isCompanyAdminView()){
    if(isPartner()) return "socio";
    if(isGerente()) return "gerente";
    return "empresa";
  }
  if(typeof isCoordinator === "function" && isCoordinator()) return "coordenador";
  return roleCategory() || "professor";
}

function faqGroupsFor(kind){
  var admin = kind === "empresa" || kind === "gerente" || kind === "socio";
  var groups = [];

  if(admin){
    var team = [
      ["O que aparece em \"Equipe e valores\"?", "Cada professor, estagiário e coordenador(a) da academia, com o valor a receber no mês pelas horas de sala (grade + auxílio − consumo), calculado a partir do que cada um lançou. O total da equipe aparece embaixo da lista."],
      ["Os alunos particulares aparecem aqui?", "Nunca. Aula particular é renda pessoal do profissional, então nome do aluno, valor e total ficam só com ele. Isso vale para todos os níveis de acesso, inclusive para quem é coordenador(a) e também dá aula particular."],
      ["Por que um personal trainer não aparece na lista?", "Personal trainer atende só aluno particular, sem relação com as horas de sala da academia. Por isso ele não entra na equipe, nos valores nem na escala."],
      ["Por que alguém da equipe não aparece?", "Ainda não criou a conta com o código ou o link de convite, ou é personal trainer. Em \"Convites\" você vê quem ainda está pendente."]
    ];
    groups.push({ title: "Equipe e valores", items: team });
    var sched = [
      ["Como funciona a escala da equipe?", "Em \"Escala da equipe\", toque num dia do calendário para ver ou lançar quem trabalhou, faltou ou foi coberto, com observação se quiser. O relatório abaixo do calendário mostra quem ainda não trabalhou fim de semana/feriado no mês."],
      ["Quem pode lançar e quem só acompanha?", kind === "socio"
        ? "Como sócio(a), você só acompanha: vê o calendário e os relatórios, sem lançar nem editar nada."
        : "Dono, gerente e coordenador(a) lançam a escala. Sócio(a) só acompanha."],
      ["Quem altera o horário semanal de cada profissional?", "O(a) gerente e o(a) coordenador(a), na parte \"Horário de trabalho da equipe\" da escala. Dono e sócio(a) só acompanham, para evitar mudanças sem querer."]
    ];
    groups.push({ title: "Escala", items: sched });
    if(kind !== "socio"){
      groups.push({ title: "Convites e níveis de acesso", items: [
        ["Como convido alguém?", "Em \"Convites\" você pode passar o código da academia (a pessoa digita ao criar a conta) ou enviar um convite por e-mail já com função e horário de trabalho. Quem entra por convite já fica ligado à academia."],
        ["Quais são os níveis de acesso?", "Profissional: bate ponto e lança as próprias horas. Coordenador(a): bate ponto e também gerencia a escala. Gerente: gerencia equipe, convites e escala, mas não bate ponto. Sócio(a): só acompanha, sem editar nada."]
      ]});
    }
    groups.push({ title: "Exportação", items: [
      ["O que a exportação baixa?", "Uma planilha da equipe do mês atual, com nome, função e valor a pagar de cada profissional (horas de sala) e o total. Abre direto no Excel."]
    ]});
  } else {
    if(kind !== "personal"){
      groups.push({ title: "Grade de horários e salário", items: [
        ["Como lanço as horas de um dia?", "Em \"Grade de horários\", toque no número do dia. Para cada horário, escolha um valor rápido, \"Outro\" para digitar um valor, \"Feriado\" ou \"Sem escala\". Dá também para repetir a semana passada ou copiar o dia para outros dias."],
        ["O que significa cada marcação da grade?", "O número é o valor lançado, em reais. FER é feriado. s/e é sem escala, ou seja, você não trabalha naquele horário. O traço (–) quer dizer que ainda não foi lançado. A coluna mais clara é fim de semana."],
        ["O que são os valores rápidos?", "Atalhos com o valor (em R$) da aula/hora, por exemplo 10 e 15, para você não digitar toda vez. Para trocar, toque em \"Valores rápidos\" acima da grade ou vá em Minha conta."],
        ["Como o salário do mês é calculado?", "Salário do mês = soma de todos os valores lançados na grade + Auxílio − Consumo Overall. O resumo mostra cada parte, tudo em reais."],
        ["O que são Auxílio e Consumo Overall?", "Auxílio é um valor somado ao total do mês (por exemplo, uma ajuda de custo). Consumo Overall é um valor descontado (por exemplo, o que foi consumido na academia). Digite os dois em reais, no Resumo do mês."],
        ["Para que serve \"Marcar feriados\"?", "Marca sozinho os feriados nacionais e de Curitiba/PR nos dias que ainda estão vazios. Dias que você já preencheu nunca são alterados."],
        ["Para que servem \"Hoje\", \"+ Novo mês\" e \"Marcar como pago\"?", "\"Hoje\" volta para o mês atual, \"+ Novo mês\" cria a grade de um mês novo e \"Marcar como pago\" registra que você já recebeu aquele mês (aparece um ✓ ao lado dele na lista de meses)."]
      ]});
    }
    if(kind === "estagiario"){
      groups.push({ title: "Alunos VIP", items: [
        ["Como funcionam os alunos VIP?", "É uma agenda semanal fixa, de segunda a sexta, por horário. Toque numa célula para escolher ou trocar o aluno e marcar presença ou falta. Só o estagiário atende alunos VIP."]
      ]});
    }
    if(kind !== "estagiario"){
      groups.push({ title: "Alunos particulares", items: [
        ["Como cadastro um aluno particular?", "Em \"Alunos particulares\", toque em \"+ Novo aluno particular\" e informe nome, valor (por sessão ou mensal fixo), dias da semana e horário. Dá para tocar num horário da grade para adicionar ou editar rápido."],
        ["O total esperado do mês está certo?", "Ele é calculado sozinho a partir dos alunos e dos dias cadastrados, separado do salário da grade. Alterou algo? O total se atualiza na hora."],
        ["Quem enxerga meus alunos particulares?", "Só você. A academia (dono, sócio, gerente e coordenador) não vê nome, valor nem total de aluno particular."]
      ]});
    }
    if(kind === "coordenador"){
      groups.push({ title: "Escala da equipe", items: [
        ["O que eu faço em \"Escala da equipe\"?", "Toque num dia do calendário para lançar quem trabalhou, faltou ou foi coberto (com observação, se quiser). O relatório mostra quem ainda não trabalhou fim de semana/feriado no mês. Você também ajusta o horário semanal de cada profissional ali."],
        ["Vejo o salário da equipe?", "Não. Os valores financeiros da equipe ficam só com o dono e o(a) sócio(a). Você bate ponto e usa a grade normalmente, como qualquer profissional."]
      ]});
    }
    groups.push({ title: "O que a academia enxerga", items: [
      ["Quem vê as minhas horas?", kind === "personal"
        ? "Ninguém da academia. Personal trainer usa só a parte de alunos particulares, que é só sua."
        : "Se você está ligado a uma academia, o dono, o sócio e o gerente veem o total das suas horas de sala no mês (grade + auxílio − consumo). Os alunos particulares nunca aparecem."],
      ["Quem define o meu horário de trabalho?", "Quando você está ligado a uma academia, o horário de segunda a sexta e o de fim de semana são definidos pelo gerente ou coordenador. Se precisar mudar, fale com eles."]
    ]});
    groups.push({ title: "Exportação", items: [
      ["Como baixo ou imprimo o mês?", "Em \"Exportação\", baixe a planilha Excel (.xlsx) ou gere o PDF pela impressão do navegador (escolha \"Salvar como PDF\"). O mês exportado é o selecionado no topo da tela. Lá também ficam o backup e a restauração dos seus dados."]
    ]});
  }

  groups.push({ title: "Conta e aparelhos", items: [
    ["Posso usar no celular e no computador ao mesmo tempo?", "Pode. Os dados sincronizam sozinhos. O indicador no topo mostra: 🟢 Sincronizado (tudo salvo no servidor), 🔄 Sincronizando, ou 🟡 Sem conexão (está salvando só neste aparelho e envia assim que a internet voltar)."],
    ["Mexi em dois aparelhos e perdi alguma coisa?", "O app junta as mudanças dos dois. Se o mesmo mês foi alterado nos dois, vale a versão que chegou primeiro ao servidor e a outra fica guardada em backup neste aparelho. Você é avisado na tela quando isso acontece."],
    ["Esqueci minha senha. E agora?", "Na tela de entrada, toque em \"Esqueci minha senha\" e siga o link enviado ao seu e-mail. Já logado, você troca a senha em Minha conta."],
    ["Como instalo no celular?", "No iPhone: toque em Compartilhar e depois em \"Adicionar à Tela de Início\". No Android: use o botão \"Instalar\" que aparece no topo. Depois é só abrir pelo ícone, como um app."]
  ]});
  return groups;
}

function renderFaq(){
  var kind = helpKind();
  var groups = faqGroupsFor(kind);
  document.querySelectorAll(".faq-body").forEach(function(body){
    body.innerHTML = "";
    groups.forEach(function(g){
      var h = document.createElement("h3");
      h.textContent = g.title;
      body.appendChild(h);
      g.items.forEach(function(qa){
        var d = document.createElement("details");
        var sm = document.createElement("summary");
        sm.textContent = qa[0];
        var p = document.createElement("p");
        p.textContent = qa[1];
        d.appendChild(sm);
        d.appendChild(p);
        body.appendChild(d);
      });
    });
    var tut = document.createElement("div");
    tut.className = "row-actions";
    tut.style.marginTop = "16px";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "small";
    btn.textContent = "Rever o tutorial inicial";
    btn.addEventListener("click", function(){ showOnboarding(kind); });
    tut.appendChild(btn);
    body.appendChild(tut);
  });
}

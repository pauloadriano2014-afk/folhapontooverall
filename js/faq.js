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
      ["Como o salário do gerente aparece?", "O gerente não bate ponto, então o valor dele é um salário mensal fixo, definido pelo dono em \"Gestão da equipe\" (Editar, no gerente). Dono e sócios veem esse valor em \"Equipe e valores\" e ele entra no total da equipe. Um gerente vê só o próprio salário, nunca o de outro gerente."],
      ["Os alunos particulares aparecem aqui?", "Nunca. Aula particular é renda pessoal: o professor, o coordenador(a) ou o gerente que a atende liga o módulo de alunos particulares só para si, e nome do aluno, valor e total ficam só com ele. Isso vale para todos os níveis de acesso."],
      ["Por que alguém da equipe não aparece?", "Ainda não criou a conta com o código ou o link de convite. Em \"Convites\" você vê quem ainda está pendente."]
    ];
    if(kind === "gerente"){
      team.push(["Atendo alunos particulares também. Como faço?", "Em Minha conta, ligue \"Também atendo alunos particulares\". O menu ganha a categoria \"Alunos particulares\", só sua, e a Exportação passa a ter Excel e PDF deles. O dono e os sócios nunca veem nomes, valores nem totais desses alunos, e você pode desligar quando quiser (os dados continuam guardados)."]);
    }
    groups.push({ title: "Equipe e valores", items: team });
    var sched = [
      ["Como funciona a escala planejada?", "Em \"Escala planejada\", a coordenação escolhe quem faz cada turno nos fins de semana e feriados (por exemplo: estagiário de manhã, estagiário à tarde e professor das 10h às 14h) e depois publica o mês. A equipe só vê a escala publicada e as pessoas escaladas recebem um aviso. Os turnos e horários podem ser mudados em \"Turnos e horários\"."],
      ["Para que serve o Registro de presença?", "É o depois: em \"Registro de presença\", toque num dia que já passou para lançar quem trabalhou, faltou ou foi coberto, com observação se quiser. Dia que ainda não aconteceu leva você para a escala planejada. As etiquetas abaixo do calendário mostram quantos fins de semana/feriados cada pessoa já trabalhou."],
      ["Como funciona o fechamento do mês?", "Em \"Fechamento do mês\", escolha o mês, confira as horas de cada pessoa e toque em Fechar (ou \"Fechar todos os abertos\"). Depois de fechado, ninguém consegue alterar as horas e valores daquele mês, e a pessoa recebe um aviso. Para corrigir algo, o dono ou o gerente reabre o mês daquela pessoa; isso fica no histórico. Coordenador vê só horas, nunca valores em reais."],
      ["Quem pode lançar e quem só acompanha?", kind === "socio"
        ? "Como sócio(a), você só acompanha: vê o calendário e os relatórios, sem lançar nem editar nada."
        : "Dono, gerente e coordenador(a) lançam a escala. Sócio(a) só acompanha."],
      ["Quem altera o horário semanal de cada profissional?", "O(a) gerente e o(a) coordenador(a), na aba \"Minha equipe\" (para dono, gerente e sócio(a): \"Horários e plantões\"), no botão Editar horário de cada pessoa. Dono e sócio(a) só acompanham, para evitar mudanças sem querer."]
    ];
    groups.push({ title: "Escala", items: sched });
    if(kind !== "socio"){
      groups.push({ title: "Gestão da equipe", items: [
        ["Como removo alguém que saiu da academia?", "Em \"Gestão da equipe\", toque em Editar na pessoa e depois em \"Remover da academia\". Ela sai da lista, dos valores e da escala. A conta e os dados pessoais dela (horas e alunos particulares) continuam dela; você só deixa de ver. O que já foi lançado na escala fica guardado."],
        ["Como troco a função ou o nível de acesso?", "Em \"Gestão da equipe\", toque em Editar. O dono pode dar qualquer nível (profissional, coordenador, gerente ou sócio). O gerente só altera profissionais e coordenadores, e não mexe no dono nem em outros gerentes. A mudança vale na hora."],
        ["O código de convite vazou. O que eu faço?", "Em \"Convites\", toque em \"Gerar novo código\". O código antigo deixa de valer na hora e quem já entrou continua na academia. Convites enviados por e-mail seguem valendo até serem usados ou cancelados."],
        ["Como vejo quem alterou o quê?", "Em \"Gestão da equipe\", o \"Histórico de alterações\" mostra quem convidou, alterou ou removeu alguém, com data e hora (últimas 50 ações)."]
      ]});
      groups.push({ title: "Convites e níveis de acesso", items: [
        ["Como convido alguém?", "Em \"Convites\" você pode passar o código da academia (a pessoa digita ao criar a conta) ou enviar um convite por e-mail já com função e horário de trabalho. Quem entra por convite já fica ligado à academia."],
        ["Quais são os níveis de acesso?", "Profissional: bate ponto e lança as próprias horas. Coordenador(a): bate ponto e também gerencia a escala; precisa ser pessoa formada (Professor ou sem função de professor, só coordena), nunca estagiário. Gerente: gerencia equipe, convites e escala, mas não bate ponto. Sócio(a): só acompanha, sem editar nada."]
      ]});
    }
    groups.push({ title: "Exportação", items: [
      ["O que a exportação baixa?", "Uma planilha Excel (.xlsx) ou um PDF da equipe do mês atual, com nome, função e valor a pagar de cada profissional (horas de sala, e o salário fixo dos gerentes) e o total."]
    ]});
  } else {
    groups.push({ title: "Grade de horários e salário", items: [
      ["Como lanço as horas de um dia?", "Em \"Grade de horários\", toque no número do dia. Para cada horário, escolha um valor rápido, \"Outro\" para digitar um valor, \"Feriado\" ou \"Sem escala\". Dá também para repetir a semana passada ou copiar o dia para outros dias."],
      ["O que significa cada marcação da grade?", "O número é o valor lançado, em reais. FER é feriado. s/e é sem escala, ou seja, você não trabalha naquele horário. O traço (–) quer dizer que ainda não foi lançado. A coluna mais clara é fim de semana."],
      ["O que são os valores rápidos?", "Atalhos com o valor (em R$) da aula/hora, por exemplo 10 e 15, para você não digitar toda vez. Para trocar, toque em \"Valores rápidos\" acima da grade ou vá em Minha conta."],
      ["Como o salário do mês é calculado?", "Salário do mês = soma de todos os valores lançados na grade + Auxílio − Consumo Overall. O resumo mostra cada parte, tudo em reais."],
      ["O que são Auxílio e Consumo Overall?", "Auxílio é um valor somado ao total do mês (por exemplo, uma ajuda de custo). Consumo Overall é um valor descontado (por exemplo, o que foi consumido na academia). Digite os dois em reais, no Resumo do mês."],
      ["Para que serve \"Marcar feriados\"?", "Marca sozinho os feriados nacionais e de Curitiba/PR nos dias que ainda estão vazios. Dias que você já preencheu nunca são alterados."],
      ["Para que servem \"Hoje\", \"+ Novo mês\" e \"Marcar como pago\"?", "\"Hoje\" volta para o mês atual, \"+ Novo mês\" cria a grade de um mês novo e \"Marcar como pago\" registra que você já recebeu aquele mês (aparece um ✓ ao lado dele na lista de meses)."]
    ]});
    if(kind === "estagiario"){
      groups.push({ title: "Alunos VIP", items: [
        ["Como funcionam os alunos VIP?", "É uma agenda semanal fixa, de segunda a sexta, por horário. Toque numa célula para escolher ou trocar o aluno e marcar presença ou falta. Só o estagiário atende alunos VIP."]
      ]});
    } else {
      groups.push({ title: "Alunos particulares (módulo opcional)", items: [
        ["Como ligo o módulo de alunos particulares?", "Em Minha conta, ligue \"Também atendo alunos particulares\". O menu ganha a categoria \"Alunos particulares\" e a Exportação passa a ter Excel e PDF deles. Dá para desligar quando quiser; os dados continuam guardados."],
        ["Como cadastro um aluno particular?", "Em \"Alunos particulares\", toque em \"+ Novo aluno particular\" e informe nome, valor (por sessão ou mensal fixo), dias da semana e horário. Dá para tocar num horário da grade para adicionar ou editar rápido."],
        ["O total esperado do mês está certo?", "Ele é calculado sozinho a partir dos alunos e dos dias cadastrados, separado do salário da grade. Alterou algo? O total se atualiza na hora."],
        ["Quem enxerga meus alunos particulares?", "Só você. A academia (dono, sócio, gerente e coordenador) não vê nome, valor nem total de aluno particular, nem sabe se você ligou o módulo."]
      ]});
    }
    if(kind === "coordenador"){
      groups.push({ title: "Montar a escala de fim de semana", items: [
        ["Como monto a escala?", "Em \"Escala planejada\", escolha o mês e toque num dia. Para cada turno (estagiário de manhã, estagiário à tarde, professor das 10h às 14h) escolha as pessoas no seletor e, no fim, toque em \"Salvar escala do dia\" (uma vez só para o dia todo). O app só mostra, em cada turno, as pessoas que podem fazê-lo: estagiário nos turnos de estagiário e professor nos de professor. O número no calendário (ex.: 3/3) mostra quantos turnos do dia já têm alguém."],
        ["Como a equipe fica sabendo?", "Quando a escala está pronta, toque em \"Publicar escala\". A equipe passa a ver em \"Escala da equipe\" e cada pessoa escalada recebe um aviso (no app e, se o e-mail estiver configurado, por e-mail). Se você mudar algo depois, o app mostra \"alterações ainda não publicadas\": publique de novo e só quem mudou é avisado."],
        ["Como mudo os horários dos turnos?", "Toque em \"Turnos e horários\". Dá para trocar o nome e o horário, escolher para quem é o turno (estagiário, professor ou qualquer pessoa), criar turnos novos e excluir. Excluir um turno também tira as pessoas escaladas nele."],
        ["Como sei quem viu a escala?", "Abaixo do estado da publicação aparece \"Ciente: X de Y confirmaram\" com o nome de quem falta, e um botão \"Lembrar quem falta\" que manda um aviso só para essas pessoas."],
        ["Como aprovo uma troca de plantão?", "Em \"Escala planejada\", no fim da tela, \"Pedidos de troca de plantão\" lista os pedidos já aceitos pelo colega (ou sem substituto). Toque em Aprovar ou Recusar. Ao aprovar, a escala publicada já muda e as duas pessoas são avisadas. Você não aprova o seu próprio pedido: outra pessoa da gestão decide."],
        ["O que o relatório de plantões mostra?", "A lista de quantos plantões cada pessoa tem no mês, para você equilibrar. Quem está com zero aparece em destaque."]
      ]});
      groups.push({ title: "Escala da equipe", items: [
        ["O que eu faço em \"Registro de presença\"?", "Toque num dia que já passou para lançar quem trabalhou, faltou ou foi coberto (com observação, se quiser). As etiquetas mostram quem já trabalhou fim de semana/feriado no mês. O horário semanal de cada profissional você ajusta em \"Minha equipe\"."],
        ["Como fecho o mês?", "Em \"Fechamento do mês\", confira as horas de cada pessoa e toque em Fechar. Depois de fechado, as horas daquele mês ficam travadas. Quem reabre é o dono ou o gerente. O seu próprio mês, quem fecha é a gerência."],
        ["Vejo o salário da equipe?", "Não. Os valores financeiros da equipe ficam só com o dono e o(a) sócio(a). Você bate ponto e usa a grade normalmente, como qualquer profissional."]
      ]});
    }
    if(currentUser && currentUser.companyId && kind !== "coordenador"){
      groups.push({ title: "Escala e avisos", items: [
        ["Onde vejo quando vou trabalhar no fim de semana?", "Em \"Escala da equipe\" no menu. Lá aparecem os seus plantões do mês (com dia e horário, e o próximo em destaque) e a escala da equipe inteira. A escala só aparece depois que a coordenação publica."],
        ["Como sou avisado?", "Em \"Avisos\". Quando a escala sai ou a sua muda, o app mostra um aviso e um número vermelho no menu. Se o e-mail da academia estiver configurado, você também recebe por e-mail."],
        ["O que é \"mês fechado\"?", "Quando a coordenação ou a gerência confere suas horas e fecha o mês, você recebe um aviso e a grade daquele mês fica com um cadeado: não dá mais para alterar horas nem valores. Se algo estiver errado, fale com a gerência para reabrir."],
        ["O que é o \"Estou ciente\"?", "Quando a escala é publicada, aparece em \"Escala da equipe\" um aviso para você confirmar que viu os seus plantões. É só tocar em \"Estou ciente\". A coordenação enxerga quem já confirmou e pode lembrar quem falta. Se o seu plantão mudar, você confirma de novo."],
        ["Preciso trocar um plantão. E agora?", "Em \"Escala da equipe\", toque em \"Pedir troca\" no plantão. Escolha um colega (ele recebe o pedido e precisa aceitar) ou \"Sem substituto\" se só precisa sair; a coordenação decide quem cobre. Depois que o colega aceita, a coordenação aprova e a escala se atualiza sozinha. Você acompanha o andamento na própria tela e pode cancelar o pedido enquanto estiver aberto."]
      ]});
    }
    groups.push({ title: "Privacidade e avisos no celular", items: [
      ["Como recebo os avisos na tela do celular?", "Em \"Avisos\", toque em \"Ativar neste aparelho\" e permita as notificações. Você passa a ser avisado quando a escala sai ou muda, quando alguém pede troca e quando o mês é fechado, mesmo com o app fechado. No iPhone, primeiro instale o app: no Safari, Compartilhar > \"Adicionar à Tela de Início\", e ative por lá. Dá para desligar quando quiser."],
      ["Como baixo uma cópia dos meus dados?", "Em Minha conta > Privacidade e dados > \"Baixar meus dados\". Você recebe um arquivo com a sua conta, horas, escala, presença e avisos."],
      ["Como apago a minha conta?", "Em Minha conta > Privacidade e dados > \"Excluir minha conta\", confirmando com a senha. Isso apaga tudo e não dá para desfazer. A conta administradora da academia não se apaga sozinha: fale com o suporte."],
      ["Onde leio os Termos de uso e a Política de privacidade?", "Em Minha conta > Privacidade e dados, ou no cadastro."]
    ]});
    groups.push({ title: "O que a academia enxerga", items: [
      ["Quem vê as minhas horas?", "Se você está ligado a uma academia, o dono, o sócio e o gerente veem o total das suas horas de sala no mês (grade + auxílio − consumo). Os alunos particulares nunca aparecem."],
      ["Quem define o meu horário de trabalho?", "Quando você está ligado a uma academia, o horário de segunda a sexta e o de fim de semana são definidos pelo gerente ou coordenador. Se precisar mudar, fale com eles."]
    ]});
    groups.push({ title: "Exportação", items: [
      ["Como baixo ou imprimo o mês?", "Em \"Exportação\", baixe a planilha Excel (.xlsx) ou gere o PDF pela impressão do navegador (escolha \"Salvar como PDF\"), tanto das horas e do salário quanto, se o módulo estiver ligado, dos alunos particulares. O mês exportado é o selecionado no topo da tela. Lá também ficam o backup e a restauração dos seus dados."]
    ]});
  }

  groups.push({ title: "Conta e aparelhos", items: [
    ["Como troco o tema e as cores?", (admin || kind === "coordenador")
      ? "Toque em \"Tema e cores\" no menu. Você escolhe entre o modo claro e o escuro. As cores da sua conta seguem o padrão da Overall (azul, vermelho e branco) e não mudam; só professores e estagiários trocam a combinação."
      : "Toque em \"Tema e cores\" no menu. Escolha o modo claro ou escuro e a combinação de cores. O padrão são as cores da Overall (azul, vermelho e branco), mas você pode usar roxo, verde, rosa ou outra, e a escolha acompanha a sua conta em outros aparelhos."],
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

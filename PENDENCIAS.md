# Pendências do Ponto Overall

Lista viva do que falta fazer, separada por quem faz. Marque com `[x]` quando concluir. Atualizada em 08/10/2026.

## 1. Publicar esta versão (Neon, GitHub e Render)

Nada disso foi feito ainda. O código está na branch `claude/auditoria-sync-privacidade`.

- [ ] **Backup no Neon antes de publicar.** Projeto `ponto-overall` > Branches > Create branch, a partir da `main`, com nome `backup-antes-unidades`. Sem "auto-delete" (o backup anterior, `backup-antes-do-deploy`, foi criado para expirar em 1 dia e provavelmente já sumiu).
- [ ] **Merge na `main`** (comandos no fim da conversa; resumo: `git merge origin/claude/auditoria-sync-privacidade` e `git push origin main`).
- [ ] **Chaves do push no Render.** No serviço `ponto-overall-api` > Environment, criar `VAPID_PUBLIC_KEY` e `VAPID_PRIVATE_KEY` (gerar com `npx web-push generate-vapid-keys`). Opcional: `VAPID_SUBJECT` (um `mailto:` seu). Salvar e esperar o deploy.
- [ ] Esperar `ponto-overall-api` e o site ficarem **Live** no Render (API primeiro: ela cria as tabelas novas ao subir).
- [ ] Abrir `https://ponto-overall-api.onrender.com/health` e conferir `{"ok":true}`.
- [ ] No Render, abrir **Logs** da API e conferir que não há erro ao subir (não deve aparecer "Chaves VAPID invalidas").
- [ ] Atualizar o app com Ctrl+Shift+R; no celular, fechar e abrir. Quem já tinha conta verá uma vez a tela de **aceite dos termos**.
- [ ] No GitHub, aba **Actions**: o workflow "Testes" roda sozinho na primeira vez e nunca foi executado na nuvem. Se ficar vermelho, abrir a execução, baixar o artefato `testes-saida` e me chamar.
- [ ] **Testar o push de verdade** num celular: Avisos > "Ativar neste aparelho" > "Enviar teste". No iPhone, instalar o app na tela inicial antes.
- [ ] Conferir no UptimeRobot que o monitor de `/health` está **Up**.

## 2. Configurações suas (infraestrutura)

- [x] **Banco aproximado do servidor (feito em 09/10/2026).** O banco foi copiado de São Paulo para **Oregon (us-west-2)**, na mesma região da API do Render. Projeto novo no Neon: `ponto-overall-oregon` (id `sweet-smoke-90957724`), com histórico de **7 dias** para restauração. `DATABASE_URL` da API já aponta para ele. Os dados foram conferidos (mesmo conteúdo, linha por linha, por soma de verificação).
- [ ] **Depois de alguns dias de uso sem problema**, apagar o projeto antigo `ponto-overall` (São Paulo, id `sparkling-cell-41987870`) e suas branches de backup (`backup-antes-oregon`, `backup-antes-do-deploy`). Até lá ele fica intacto como plano B: para voltar atrás basta trocar o `DATABASE_URL` no Render pela conexão dele (mas dados criados depois da troca ficam só no banco novo).
- [ ] Plano pago do Render (a API gratuita tem CPU compartilhada pequena).

- [ ] **Plano pago do Render** para a API (cerca de US$ 7 por mês) para o servidor nunca dormir.
- [ ] **Retenção do backup no Neon** (hoje o histórico é de 1 dia): subir para 7 a 30 dias.
- [ ] **E-mail com domínio próprio** (hoje é Gmail, com limite e risco de spam). Define quem recebe "esqueci minha senha" e os avisos por e-mail. Depois, configurar `SMTP_USER` e `SMTP_PASS` (ou outro SMTP) no Render.
- [ ] **Contato de privacidade**: preencher `PRIVACY_CONTACT` em `js/legal.js` (hoje vazio, a linha não aparece).
- [ ] **Advogado** revisando os Termos de uso e a Política de privacidade antes de vender (textos em `index.html`; ao mudar o texto, trocar `TERMS_VERSION` em `server/server.js`).
- [ ] **Preço e forma de cobrança** (no mês de teste, Pix manual basta). Depois atualizar o documento de implantação.

## 3. Antes de entregar à academia

- [ ] **Trocar a conta de teste pelo dono real.** Hoje a dona da empresa Overall no banco é `gerente.overall@teste.com`. Não apagar as contas `@teste.com` antes de o dono real existir e estar vinculado; me peça que eu faço a troca com segurança.
- [ ] **Apagar a equipe fictícia de teste** (Betina, Vitor, Juan, Gabriel, Yuri, Tina, Denis, Vinicius). No SQL Editor do Neon, branch principal, nesta ordem:

```sql
DELETE FROM company_roster_entries WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@equipe-teste.invalid');
DELETE FROM user_notifications WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@equipe-teste.invalid');
DELETE FROM users WHERE email LIKE '%@equipe-teste.invalid';
```

- [ ] **Adri (`adri.kern@hotmail.com`)** foi vinculada à empresa Overall só para os testes de escala (só o campo da empresa mudou). Para desvincular: `UPDATE users SET company_id = NULL WHERE email = 'adri.kern@hotmail.com';`
- [ ] Remover o usuário de teste "Paulin" (`sdasdas@hotmail.com`) e renomear "Coordenador Teste" quando houver o coordenador real (Harlisson), em Gestão da equipe.
- [ ] Fazer o **mês de teste** com o coordenador e 3 a 5 pessoas: combinar prazo, critério de sucesso e suporte (roteiro no documento "Implantação do Ponto Overall — mês de teste").

## 4. Posso construir (eu)

- [ ] **Controle do mês de teste**: data de início e fim, aviso "seu teste termina em X dias" para o dono e, depois do prazo, o app vira só leitura (nunca apaga dados).
- [ ] **Teste de carga** com 20 a 30 pessoas ao mesmo tempo (nunca foi feito), vendo servidor e banco, inclusive no plano gratuito.
- [ ] **Ambiente de ensaio** (cópia do app e do banco) para testar mudanças antes de irem para quem usa.
- [ ] **Unidades, o que falta:** mudar uma pessoa de unidade mantendo o histórico; gerente de rede (cuida de várias unidades); relatório da rede em Excel.
- [ ] **Cobrança automática** (Asaas ou Stripe): plano, vencimento e bloqueio por falta de pagamento. `organizations.plan` e `max_units` já existem como ponto de encaixe (limite padrão: 5 unidades).
- [ ] **Monitoramento externo de erros** (por exemplo Sentry). Hoje os erros do navegador e da API vão para o log do Render (busque por `[client-error]`).

## 5. Limitações conhecidas

- O fechamento do mês trava horas, valores, auxílio e consumo. Alunos VIP e alunos particulares não entram no fechamento (não fazem parte do pagamento da academia). "Marcar como pago" e observações continuam livres.
- Uma pessoa só pertence a uma unidade por vez. Para mudar de unidade: remover da atual e convidar na nova.
- O push só funciona com HTTPS, permissão da pessoa e, no iPhone, o app instalado na tela inicial. O envio real a um celular ainda não foi testado (só com um serviço simulado).
- Limites de tentativas (login, cadastro) ficam na memória do servidor: com mais de uma instância da API, cada uma conta separado.
- A vitrine de telas ("Prévia Ponto Overall", artefato) é uma foto de uma data: precisa ser refeita quando as telas mudarem. A galeria anterior está desatualizada.

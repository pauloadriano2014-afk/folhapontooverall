# Ponto Overall

Aplicativo (PWA) de ponto e escala para a equipe de uma academia: cada profissional lança as próprias horas, a coordenação monta e publica a escala de fim de semana, a gerência confere e fecha o mês, e o dono acompanha valores e histórico.

- **Site (PWA):** HTML, CSS e JavaScript puro, sem build. Os arquivos de `js/` compartilham o mesmo escopo global e carregam na ordem do `index.html`.
- **API:** Node.js + Express (`server/server.js`), banco Postgres (Neon).
- **Hospedagem:** Render (site estático + serviço `ponto-overall-api`). Cada push na `main` publica sozinho.

## Quem faz o quê

| Nível | Pode |
| --- | --- |
| Dono | Tudo: equipe, convites, valores, escala, fechamento e reabertura, histórico e, se tiver mais de uma academia, as unidades |
| Gerente | Equipe, convites, escala, fechamento e reabertura, histórico |
| Sócio(a) | Só acompanha (valores, escala, histórico), sem editar |
| Coordenador(a) | Escala, presença, horários da equipe, fecha o mês (nunca o próprio). Vê horas, não valores em R$ |
| Professor / Estagiário | Lança as próprias horas, vê a escala, dá o "ciente" e pede troca de plantão |

Alunos particulares (módulo opcional do professor) são sempre privados: nenhum nível da academia vê nomes, valores nem totais.

## Várias unidades

Cada unidade é uma academia (`companies`) com equipe, escala, fechamento e código de convite próprios. Uma **rede** (`organizations`) agrupa as unidades de um mesmo dono (`organization_owners`):

- O dono ativa a rede em **Unidades > Adicionar unidade** (cria a rede e a nova unidade).
- Ele **alterna** entre as unidades com "Entrar" (a conta dele passa a estar na unidade escolhida, sempre como dono) e vê um **comparativo do mês** (pessoas, horários, valor, plantões, faltas, fechamento).
- `organizations.max_units` e `plan` são o ponto de encaixe da cobrança: hoje o limite padrão é 5 unidades; para vender planos, basta alterar esse valor por rede.
- Ainda não existe: mudar uma pessoa de unidade mantendo o histórico, gerente de rede (um gerente que cuida de várias unidades), relatórios consolidados em Excel e cobrança por unidade.

## Estrutura

```
index.html, styles.css, sw.js, manifest.json   o app e o service worker (cache + push)
js/                  telas e lógica (state, auth, grade, escala, fechamento, histórico, push...)
server/server.js     API (login, sincronização, equipe, escala, fechamento, LGPD, push)
tests/               testes de ponta a ponta (Playwright) e o runner
.github/workflows/   verificação automática (GitHub Actions)
```

Dados de cada pessoa ficam num JSON versionado (`user_state`) sincronizado com controle de versão (`X-Base-Version`, 409 em conflito). Escala, presença, fechamentos, trocas, avisos e inscrições de push têm tabelas próprias; todas são criadas/migradas ao subir o servidor (`ensureTables`).

## Rodar na sua máquina

Precisa de Node 18+ e um Postgres.

```bash
# 1) banco descartável (exemplo com Docker)
docker run -d --name ponto-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=ponto -p 5432:5432 postgres:16

# 2) API
cd server && npm install
DATABASE_URL=postgres://postgres:postgres@localhost:5432/ponto DATABASE_SSL=off JWT_SECRET=dev PORT=3000 node server.js

# 3) site (em outro terminal, na raiz do projeto)
python3 -m http.server 8080      # abra http://localhost:8080
```

O endereço da API usado pelo site está em `API_BASE` (`js/auth.js`); aponte para `http://localhost:3000` ao desenvolver.

## Variáveis de ambiente da API

| Variável | Para quê |
| --- | --- |
| `DATABASE_URL` | Conexão do Postgres (obrigatória) |
| `JWT_SECRET` | Assinatura das sessões (obrigatória, longa e secreta) |
| `DATABASE_SSL=off` | Só para Postgres local sem SSL |
| `APP_URL` | Endereço público do site (links de e-mail) |
| `SMTP_USER`, `SMTP_PASS` | E-mail de "esqueci a senha" e avisos (senha de app do Gmail, ou outro SMTP) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Notificação push no celular. Gere com `npx web-push generate-vapid-keys`. Sem elas o push fica desligado |

## Testes

Os testes abrem o app num navegador de verdade e cobrem login, tema, equipe, escala, ciente e trocas, fechamento, histórico, LGPD e push.

```bash
cd tests && npm install && npx playwright install chromium && cd ..
DATABASE_URL=postgres://postgres:postgres@localhost:5432/ponto_test bash tests/run-all.sh
bash tests/run-all.sh 15        # só os testes cujo nome contém "15"
```

Atenção: o banco indicado em `DATABASE_URL` é **apagado a cada teste**; use um banco só para isso. Logs e imagens das telas ficam em `tests/.out/`. No GitHub, o workflow **Testes** roda sozinho a cada push na `main` e em todo pull request.

## Publicar uma atualização

1. Altere o código e rode os testes.
2. Se mudou algum arquivo que o app guarda em cache (`js/`, `styles.css`, `index.html`), aumente `CACHE_VERSION` em `sw.js` (v54, v55...). Sem isso, quem já abriu o app pode continuar vendo a versão antiga.
3. Faça merge na `main`. O Render publica a API primeiro (cria tabelas novas ao subir) e depois o site.
4. Atualize o navegador com Ctrl+Shift+R (no celular, feche e abra o app).

Antes de mudanças grandes no banco, crie uma branch de backup no Neon.

## Monitoramento

- `GET /health` responde `{"ok":true}`. Um monitor (por exemplo UptimeRobot, a cada 5 minutos) mantém o servidor acordado no plano gratuito do Render e avisa se cair.
- Erros do navegador são enviados para a API (`POST /api/client-error`) e aparecem nos logs do Render com o prefixo `[client-error]`. Erros inesperados da API aparecem com o prefixo `Erro no ...`.

## Privacidade (LGPD)

Termos e política ficam em `index.html` (versão em `TERMS_VERSION` no servidor: ao mudar o texto, troque a versão e todos aceitam de novo). Cada pessoa pode baixar uma cópia dos dados e apagar a conta em Minha conta, Privacidade e dados. Os textos são um ponto de partida e devem ser revisados por um advogado antes de vender.

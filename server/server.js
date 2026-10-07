// Backend do Ponto Overall, com login multiusuario.
//
// Cada pessoa (estagiario, professor, personal trainer...) cria sua propria conta
// (nome, funcao, e-mail e senha) e tem seus proprios dados guardados no Neon Postgres,
// sincronizados entre os aparelhos onde ela usar o app. Ninguem ve os dados de outra
// pessoa: nao existe painel de administrador.
//
// Rotas de conta:
//   POST /api/register         -> cria a conta (nome, role, email, password) e devolve um token
//   POST /api/login            -> confere email/senha e devolve um token
//   GET  /api/me               -> dados da conta logada (a partir do token)
//   POST /api/change-password  -> troca a senha (precisa da senha atual, exige estar logado)
//   POST /api/forgot-password  -> manda um e-mail com link para redefinir a senha
//   POST /api/reset-password   -> define uma nova senha a partir do token desse link
//
// Rotas de dados (exigem o token no header "Authorization: Bearer <token>"):
//   GET  /api/state   -> devolve o JSON salvo dessa conta (ou null se nunca salvou)
//   PUT  /api/state   -> substitui o JSON salvo dessa conta pelo corpo da requisicao
//                        (com header X-Base-Version: 409 se outro aparelho salvou antes)
//
//   GET  /health      -> healthcheck simples
//
// Gestao da equipe (dono e gerente; ver managerCanManage):
//   PUT    /api/company/staff/:id/access  -> troca funcao e/ou nivel de acesso de alguem
//   DELETE /api/company/staff/:id         -> tira alguem da academia (a conta e os dados dela continuam dela)
//   POST   /api/company/invite-code/rotate -> gera um novo codigo de convite (o antigo para de valer)
//   GET    /api/company/audit             -> historico das alteracoes de equipe
//   GET/POST /api/company/closings, DELETE /api/company/closings/:userId/:month -> fechamento do mes
//   GET    /api/me/closings               -> meses fechados da propria pessoa
//
// Escala planejada por turno e avisos:
//   GET    /api/company/roster?month=     -> rascunho + estado da publicacao (dono/gerente/coordenador/socio)
//   POST   /api/company/roster/entries    -> escala alguem num turno de um dia (DELETE .../:id tira)
//   POST   /api/company/roster/publish    -> publica o mes e avisa quem foi afetado
//   GET    /api/me/roster?month=          -> a escala PUBLICADA, para qualquer pessoa da academia
//   *      /api/company/shift-types       -> turnos e horarios (padrao: estagiario 8-13 e 13-18, professor 10-14)
//   POST   /api/me/roster/ack, /api/company/roster/remind -> "ciente" da escala e lembrete
//   *      /api/me/swaps, /api/company/swaps -> pedidos de troca de plantao (aceite do colega + aprovacao da coordenacao)
//   GET    /api/me/notifications          -> avisos da pessoa (POST .../read marca como lidos)
//
// "Esqueci minha senha" manda o e-mail usando uma conta Gmail configurada nas
// variaveis de ambiente SMTP_USER / SMTP_PASS (uma "senha de app" do Gmail, nao a
// senha normal da conta) — nao precisa de dominio proprio nem configuracao de DNS.
// Se essas variaveis nao estiverem configuradas, o recurso fica desligado e quem
// administra o banco (Paulo) pode resetar a senha de alguem manualmente no Neon.

const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const { Pool } = require("pg");

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_TTL = "180d"; // fica logado por ~6 meses sem precisar logar de novo
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // link de redefinicao de senha vale 1 hora

// URL onde o app (frontend) esta publicado — usada soh para montar o link que vai
// no e-mail de redefinicao de senha.
const APP_URL = process.env.APP_URL || "https://ponto-overall.onrender.com";

const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;

if (!DATABASE_URL) {
  console.error("Faltando variavel de ambiente DATABASE_URL");
  process.exit(1);
}
if (!JWT_SECRET) {
  console.error("Faltando variavel de ambiente JWT_SECRET");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  // DATABASE_SSL=off so pra rodar com um Postgres local, sem SSL (testes).
  ssl: process.env.DATABASE_SSL === "off" ? false : { rejectUnauthorized: false },
});

// O banco (Neon) derruba conexoes ociosas de vez em quando. Sem este tratamento,
// o evento de erro de uma conexao parada derrubaria o servidor inteiro; com ele,
// o pool apenas descarta a conexao e abre outra na proxima consulta.
pool.on("error", (err) => {
  console.error("Conexao ociosa com o banco encerrada (normal; o pool reconecta):", err.message);
});

var mailer = null;
if (SMTP_USER && SMTP_PASS) {
  mailer = nodemailer.createTransport({
    service: "gmail",
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
} else {
  console.warn(
    "SMTP_USER/SMTP_PASS nao configurados: o recurso 'esqueci minha senha' vai ficar desativado ate configurar essas variaveis."
  );
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function sendResetEmail(user, link) {
  return mailer.sendMail({
    from: "Ponto Overall <" + SMTP_USER + ">",
    to: user.email,
    subject: "Redefinir senha — Ponto Overall",
    text:
      "Oi, " + user.name + "!\n\n" +
      "Recebemos um pedido para redefinir sua senha do Ponto Overall.\n\n" +
      "Clique no link abaixo para escolher uma nova senha (vale por 1 hora):\n" +
      link +
      "\n\nSe voce nao pediu isso, pode ignorar este e-mail.",
    html:
      "<p>Oi, " + escapeHtml(user.name) + "!</p>" +
      "<p>Recebemos um pedido para redefinir sua senha do <strong>Ponto Overall</strong>.</p>" +
      "<p><a href=\"" + escapeHtml(link) + "\" style=\"background:#a855f7;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;\">Escolher nova senha</a></p>" +
      "<p>Ou copie e cole este link no navegador (vale por 1 hora):<br>" + escapeHtml(link) + "</p>" +
      "<p style=\"color:#888;font-size:12px;\">Se voce nao pediu isso, pode ignorar este e-mail.</p>",
  });
}

async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id serial PRIMARY KEY,
      name text NOT NULL,
      role text,
      email text UNIQUE NOT NULL,
      password_hash text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_state (
      user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  // Colunas do "esqueci minha senha": token de uso unico (guardado com hash,
  // igual senha) com prazo de validade.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_hash text;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires timestamptz;`);
  // Tabela antiga, de antes de existir login (um unico blob compartilhado).
  // Mantida so para nao perder o historico; a migracao pro primeiro usuario
  // e feita manualmente uma unica vez. Nada mais escreve nela.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      id text PRIMARY KEY,
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  // Camada de "empresa" (academia): opcional e aditiva — uma conta que nunca
  // usou codigo de convite nem virou dona de academia continua exatamente
  // como sempre foi (company_id fica null). Uma "empresa" e apenas um dono
  // (company_role = 'owner') mais zero ou mais profissionais vinculados
  // (company_role null) que entraram usando o codigo de convite no cadastro.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS companies (
      id serial PRIMARY KEY,
      name text NOT NULL,
      invite_code text UNIQUE NOT NULL,
      owner_user_id integer REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS company_id integer REFERENCES companies(id);`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS company_role text;`);
  // Convite por e-mail: a academia digita nome/e-mail/funcao (e, opcionalmente,
  // o horario de trabalho) uma vez, a gente manda um link, e quem se cadastra
  // por ele ja entra vinculado e com a escala preenchida — sem precisar copiar
  // e colar codigo nenhum. Tambem aditivo, nao afeta o fluxo de codigo manual.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS company_invites (
      id serial PRIMARY KEY,
      company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      token text UNIQUE NOT NULL,
      name text NOT NULL,
      role text,
      email text NOT NULL,
      shift_start text,
      shift_end text,
      weekend_shift boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      used_at timestamptz,
      redeemed_user_id integer REFERENCES users(id)
    );
  `);
  // Nivel de acesso do convite: 'staff' (profissional comum, padrao — mantem
  // o comportamento de sempre), 'coordinator' (tambem bate ponto, mas alem
  // disso gerencia a escala de fim de semana/feriado da equipe) ou 'partner'
  // (socio(a) da academia: so acompanha, sem editar nada financeiro nem de
  // escala). Aditivo — convites antigos ja tem o default 'staff'.
  await pool.query(`ALTER TABLE company_invites ADD COLUMN IF NOT EXISTS access_role text NOT NULL DEFAULT 'staff';`);
  // Escala/roster da equipe: quem trabalhou, faltou ou foi coberto em cada
  // dia (pensado sobretudo pra fim de semana/feriado, onde a escala muda
  // semana a semana). Uma linha por (profissional, dia) — editar de novo no
  // mesmo dia so atualiza a linha existente.
  // Sessoes: trocar/redefinir a senha incrementa token_version e derruba os
  // tokens antigos (o JWT carrega a versao com que foi emitido).
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version integer NOT NULL DEFAULT 0;`);
  // Salario mensal fixo de quem e 100% administrativo e nao bate ponto (gerente):
  // definido so pelo dono; dono e socio veem. Nao e usado para mais ninguem.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS monthly_salary numeric(12,2);`);
  // "Modulo de alunos particulares" do gerente: ele mesmo liga se tambem atende
  // aluno particular. Os dados ficam so na conta dele (a academia nunca ve).
  var moduleCol = await pool.query("SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'personal_module'");
  var firstModuleRun = moduleCol.rows.length === 0;
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS personal_module boolean NOT NULL DEFAULT false;`);
  // Uma unica vez: quem ja era professor/coordenador ate agora via a tela de
  // alunos particulares; mantem isso ligado para ninguem perder acesso.
  if (firstModuleRun) {
    await pool.query(`UPDATE users SET personal_module = true
                      WHERE (company_role IS NULL OR company_role = 'coordinator')
                        AND (role ILIKE '%professor%' OR role ILIKE '%personal%')`);
  }
  // "Personal Trainer" deixou de ser funcao: e o modulo de alunos particulares
  // do professor. Converte as contas e convites antigos (sempre seguro repetir).
  await pool.query(`UPDATE users SET role = 'Professor', personal_module = true WHERE role ILIKE '%personal%'`);
  await pool.query(`UPDATE company_invites SET role = 'Professor' WHERE role ILIKE '%personal%'`);
  // Coordenador(a) nao pode ser estagiario(a): quem estava assim passa a "so coordena" (sem funcao).
  await pool.query(`UPDATE users SET role = '' WHERE company_role = 'coordinator' AND role ILIKE '%estagi%'`);
  await pool.query(`UPDATE company_invites SET role = '' WHERE access_role = 'coordinator' AND role ILIKE '%estagi%'`);
  await pool.query(`ALTER TABLE company_invites ADD COLUMN IF NOT EXISTS monthly_salary numeric(12,2);`);
  // Historico das alteracoes de equipe (quem fez o que, e quando) — base para
  // qualquer necessidade futura de auditoria.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS company_audit (
      id serial PRIMARY KEY,
      company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      actor_user_id integer REFERENCES users(id) ON DELETE SET NULL,
      action text NOT NULL,
      target_user_id integer REFERENCES users(id) ON DELETE SET NULL,
      target_name text,
      detail text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  // Escala planejada por turno (estagiario de manha/tarde, professor das 10 as 14...),
  // publicada para a equipe, e avisos para quem foi escalado.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS company_shift_types (
      id serial PRIMARY KEY,
      company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      name text NOT NULL,
      start_time text NOT NULL,
      end_time text NOT NULL,
      kind text NOT NULL DEFAULT 'any',
      sort_order integer NOT NULL DEFAULT 0,
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS company_roster_entries (
      id serial PRIMARY KEY,
      company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      date text NOT NULL,
      shift_type_id integer NOT NULL REFERENCES company_shift_types(id) ON DELETE CASCADE,
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_by integer REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(date, shift_type_id, user_id)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_roster_entries_company_date ON company_roster_entries(company_id, date);`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS company_roster_months (
      company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      month text NOT NULL,
      published_at timestamptz,
      published_by integer REFERENCES users(id) ON DELETE SET NULL,
      snapshot jsonb,
      PRIMARY KEY (company_id, month)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_notifications (
      id serial PRIMARY KEY,
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      company_id integer REFERENCES companies(id) ON DELETE CASCADE,
      kind text NOT NULL,
      title text NOT NULL,
      body text,
      created_at timestamptz NOT NULL DEFAULT now(),
      read_at timestamptz
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_notifications_user ON user_notifications(user_id, read_at);`);
  // "Ciente" da escala publicada e pedidos de troca de plantao.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS company_roster_acks (
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      month text NOT NULL,
      acked_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, month)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS roster_swap_requests (
      id serial PRIMARY KEY,
      company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      date text NOT NULL,
      shift_type_id integer NOT NULL REFERENCES company_shift_types(id) ON DELETE CASCADE,
      requester_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_id integer REFERENCES users(id) ON DELETE CASCADE,
      note text,
      status text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      resolved_at timestamptz,
      resolved_by integer REFERENCES users(id) ON DELETE SET NULL
    );
  `);
  // Fechamento do mes: foto (snapshot) das horas de uma pessoa naquele mes.
  // Enquanto existir, o servidor nao deixa as horas/valores desse mes mudarem.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS company_month_closings (
      company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      month text NOT NULL,
      closed_at timestamptz NOT NULL DEFAULT now(),
      closed_by integer REFERENCES users(id) ON DELETE SET NULL,
      snapshot jsonb NOT NULL,
      hours integer NOT NULL DEFAULT 0,
      total numeric NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, month)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS company_schedule (
      id serial PRIMARY KEY,
      company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date text NOT NULL,
      status text NOT NULL,
      note text,
      covered_by_user_id integer REFERENCES users(id),
      created_by integer REFERENCES users(id),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(user_id, date)
    );
  `);
}

// 'owner' sempre pode tudo. 'manager' (gerente) convida/gerencia a equipe e a
// escala igual ao dono, mas nao ve o quanto cada profissional ganha com
// alunos particulares (so o valor de grade/sala, pago pela academia — ver
// isCompanyManager e o /api/company/overview abaixo). 'coordinator' gerencia
// a escala (mas nao ve valores financeiros da equipe). 'partner' (socio) so
// acompanha, sem editar nada.
function isScheduleManager(role) {
  return role === "owner" || role === "manager" || role === "coordinator";
}
function isScheduleViewer(role) {
  return role === "owner" || role === "manager" || role === "coordinator" || role === "partner";
}
// Quem pode convidar/gerenciar quem entra na equipe (nivel "administrativo"
// de gerenciamento, nao de leitura): dono e gerente. Socio(a) fica de fora de
// proposito (acesso so leitura).
function isCompanyManager(role) {
  return role === "owner" || role === "manager";
}

// Funcoes de quem trabalha na academia: Estagiario ou Professor. "Personal" nao
// e funcao: e o modulo de alunos particulares que o professor (ou coordenador,
// ou gerente) liga para si mesmo, e que so ele enxerga.
var ALLOWED_ROLES = ["Estagiário", "Professor"];
function stripAccents(t) {
  return String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
// Devolve { role, module } (module = veio como "personal", entao liga o modulo)
// ou { invalid: true } se a funcao nao existe.
function canonicalRole(raw) {
  var t = String(raw || "").trim();
  if (!t) return { role: "", module: false };
  var norm = stripAccents(t).toLowerCase();
  if (norm.indexOf("personal") >= 0) return { role: "Professor", module: true };
  for (var i = 0; i < ALLOWED_ROLES.length; i++) {
    if (stripAccents(ALLOWED_ROLES[i]).toLowerCase() === norm) return { role: ALLOWED_ROLES[i], module: false };
  }
  // formas no feminino ("Estagiária", "Professora") valem como a funcao correspondente
  if (norm.indexOf("estagi") === 0) return { role: "Estagiário", module: false };
  if (norm.indexOf("professor") === 0) return { role: "Professor", module: false };
  return { invalid: true };
}
var INVALID_ROLE_MSG = "Função inválida. Escolha Estagiário ou Professor.";
// Coordenador(a) precisa ser pessoa formada: professor(a) ou alguem sem funcao
// de professor (so coordena). Nunca estagiario(a).
function isTraineeRole(role) {
  return stripAccents(role).toLowerCase().indexOf("estagi") >= 0;
}
var COORDINATOR_NOT_TRAINEE_MSG = "Coordenador(a) não pode ser estagiário(a): a função precisa ser Professor ou ficar em branco (só coordena).";

var INVITE_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem O/0 e I/1, pra nao confundir na hora de digitar
function randomInviteCode() {
  var out = "";
  for (var i = 0; i < 6; i++) {
    out += INVITE_CODE_CHARS[crypto.randomInt(INVITE_CODE_CHARS.length)];
  }
  return out;
}

function randomInviteToken() {
  return crypto.randomBytes(24).toString("hex");
}

function pad2Hour(n) {
  return (n < 10 ? "0" : "") + n;
}

// A partir de "entrada"/"saida" (so hora, ex "05:00"/"13:00"), gera os blocos
// de 1h no mesmo formato que a grade ja usa (ex "05:00–06:00"). Sem
// entrada/saida definidos no convite, devolve null (a pessoa configura os
// proprios horarios como sempre, sem nada pre-preenchido).
function buildSuggestedSchedule(shiftStart, shiftEnd, weekendShift) {
  if (!shiftStart || !shiftEnd) return null;
  var startH = parseInt(String(shiftStart).split(":")[0], 10);
  var endH = parseInt(String(shiftEnd).split(":")[0], 10);
  if (isNaN(startH) || isNaN(endH) || startH === endH) return null;
  var slots = [];
  var h = startH;
  var guard = 0;
  while (h !== endH && guard < 24) {
    var next = (h + 1) % 24;
    slots.push(pad2Hour(h) + ":00–" + pad2Hour(next) + ":00");
    h = next;
    guard++;
  }
  if (slots.length === 0) return null;
  return { timeSlots: slots, weekendShiftEnabled: !!weekendShift };
}

function sendInviteEmail(toEmail, name, companyName, link) {
  return mailer.sendMail({
    from: "Ponto Overall <" + SMTP_USER + ">",
    to: toEmail,
    subject: "Convite para o Ponto Overall — " + companyName,
    text:
      "Oi, " + name + "!\n\n" +
      companyName + " te convidou pra usar o Ponto Overall.\n\n" +
      "Clique no link abaixo pra completar seu cadastro (a conta já vem vinculada):\n" +
      link +
      "\n\nSe você não esperava esse convite, pode ignorar este e-mail.",
    html:
      "<p>Oi, " + escapeHtml(name) + "!</p>" +
      "<p><strong>" + escapeHtml(companyName) + "</strong> te convidou pra usar o <strong>Ponto Overall</strong>.</p>" +
      "<p><a href=\"" + escapeHtml(link) + "\" style=\"background:#a855f7;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;\">Completar cadastro</a></p>" +
      "<p>Ou copie e cole este link no navegador:<br>" + escapeHtml(link) + "</p>" +
      "<p style=\"color:#888;font-size:12px;\">Se você não esperava esse convite, pode ignorar este e-mail.</p>",
  });
}

async function createCompanyForOwner(ownerUserId, companyName) {
  // Tenta gerar um codigo de convite unico; colisao e raridade estatistica,
  // mas a unicidade e uma constraint do banco, entao tenta de novo se bater.
  for (var attempt = 0; attempt < 5; attempt++) {
    var code = randomInviteCode();
    try {
      var result = await pool.query(
        "INSERT INTO companies (name, invite_code, owner_user_id) VALUES ($1, $2, $3) RETURNING id, name, invite_code",
        [companyName, code, ownerUserId]
      );
      return result.rows[0];
    } catch (err) {
      if (err && err.code === "23505") continue; // invite_code duplicado, tenta outro
      throw err;
    }
  }
  throw new Error("nao_foi_possivel_gerar_codigo_de_convite");
}

// ---- gestao de equipe: quem pode mexer em quem ----
// Hierarquia: dono > gerente > coordenador(a) > profissional. O dono gerencia
// qualquer um (menos ele mesmo); o gerente so gerencia coordenador(a) e
// profissional. Socio(a) e coordenador(a) nao gerenciam ninguem.
function managerCanManage(actorRole, targetRole) {
  if (targetRole === "owner") return false;
  if (actorRole === "owner") return true;
  if (actorRole === "manager") return !targetRole || targetRole === "coordinator";
  return false;
}
// Niveis que cada um pode atribuir ("staff" = profissional comum, company_role nulo).
function assignableAccessRoles(actorRole) {
  if (actorRole === "owner") return ["staff", "coordinator", "manager", "partner"];
  if (actorRole === "manager") return ["staff", "coordinator"];
  return [];
}
// Nomes em portugues dos niveis de acesso (usados no historico, que a pessoa le).
var ACCESS_LABELS_PT = { owner: "Dono", manager: "Gerente", coordinator: "Coordenador(a)", partner: "Sócio(a)", staff: "Profissional" };
function accessLabelPt(role) {
  return ACCESS_LABELS_PT[role || "staff"] || String(role);
}

function accessRoleToDb(accessRole) {
  return accessRole === "staff" ? null : accessRole;
}

async function audit(companyId, actorId, action, targetId, targetName, detail) {
  try {
    await pool.query(
      "INSERT INTO company_audit (company_id, actor_user_id, action, target_user_id, target_name, detail) VALUES ($1, $2, $3, $4, $5, $6)",
      [companyId, actorId, action, targetId || null, targetName || null, detail || null]
    );
  } catch (err) {
    console.error("Falha ao registrar historico:", err);
  }
}

// Limite de tentativas simples, em memoria (suficiente para uma instancia so):
// segura forca bruta de senha e envio em massa de e-mails.
function rateLimit(options) {
  var hits = new Map();
  var timer = setInterval(function () {
    var now = Date.now();
    hits.forEach(function (entry, key) { if (entry.reset <= now) hits.delete(key); });
  }, options.windowMs);
  if (timer.unref) timer.unref();
  return function (req, res, next) {
    var key = options.key(req);
    var now = Date.now();
    var entry = hits.get(key);
    if (!entry || entry.reset <= now) {
      entry = { count: 0, reset: now + options.windowMs };
      hits.set(key, entry);
    }
    entry.count++;
    if (entry.count > options.max) {
      res.set("Retry-After", String(Math.ceil((entry.reset - now) / 1000)));
      return res.status(429).json({ error: "too_many_requests", message: options.message });
    }
    next();
  };
}
function bodyEmail(req) {
  return String((req.body && req.body.email) || "").trim().toLowerCase();
}
var MIN = 60 * 1000;
var limitLogin = rateLimit({ windowMs: 15 * MIN, max: 8, key: function (r) { return "login:" + r.ip + ":" + bodyEmail(r); }, message: "Muitas tentativas de login. Aguarde alguns minutos e tente de novo." });
var limitLoginIp = rateLimit({ windowMs: 15 * MIN, max: 60, key: function (r) { return "loginip:" + r.ip; }, message: "Muitas tentativas de login. Aguarde alguns minutos e tente de novo." });
var limitRegister = rateLimit({ windowMs: 60 * MIN, max: 15, key: function (r) { return "reg:" + r.ip; }, message: "Muitos cadastros deste aparelho. Tente de novo mais tarde." });
var limitForgotIp = rateLimit({ windowMs: 60 * MIN, max: 8, key: function (r) { return "forgotip:" + r.ip; }, message: "Muitos pedidos de redefinição. Tente de novo mais tarde." });
var limitForgotEmail = rateLimit({ windowMs: 60 * MIN, max: 3, key: function (r) { return "forgot:" + bodyEmail(r); }, message: "Já enviamos links para esse e-mail. Confira a caixa de entrada e o spam, ou tente mais tarde." });
var limitReset = rateLimit({ windowMs: 60 * MIN, max: 15, key: function (r) { return "reset:" + r.ip; }, message: "Muitas tentativas. Tente de novo mais tarde." });
var limitChangePassword = rateLimit({ windowMs: 15 * MIN, max: 10, key: function (r) { return "chpw:" + r.ip; }, message: "Muitas tentativas. Aguarde alguns minutos." });
var limitInvite = rateLimit({ windowMs: 60 * MIN, max: 40, key: function (r) { return "invite:" + r.ip; }, message: "Muitos convites em pouco tempo. Tente de novo mais tarde." });

const app = express();
app.set("trust proxy", 1); // atras do proxy do Render: r.ip e o IP real de quem chamou
app.use(cors());
app.use(express.json({ limit: "2mb" }));

function publicUser(row) {
  return {
    id: row.id,
    name: row.name,
    role: row.role || "",
    email: row.email,
    companyId: row.company_id || null,
    companyRole: row.company_role || null,
    personalModule: !!row.personal_module,
  };
}

function signToken(row) {
  return jwt.sign({ uid: row.id, tv: row.token_version || 0 }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

async function auth(req, res, next) {
  var header = req.header("authorization") || "";
  var token = header.indexOf("Bearer ") === 0 ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "no_token" });
  var payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return res.status(401).json({ error: "invalid_token" });
  }
  try {
    // Token emitido antes de uma troca/redefinicao de senha deixa de valer.
    var r = await pool.query("SELECT token_version FROM users WHERE id = $1", [payload.uid]);
    if (r.rows.length === 0 || (r.rows[0].token_version || 0) !== (payload.tv || 0)) {
      return res.status(401).json({ error: "invalid_token" });
    }
    req.userId = payload.uid;
    next();
  } catch (err) {
    console.error("Erro ao validar sessao:", err);
    res.status(500).json({ error: "internal_error" });
  }
}

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.post("/api/register", limitRegister, async (req, res) => {
  var body = req.body || {};
  var accountType = String(body.accountType || "profissional").trim(); // "profissional" (padrao, compativel com o app antigo) ou "empresa"
  var name = String(body.name || "").trim();
  var roleInput = canonicalRole(body.role);
  var role = roleInput.invalid ? "" : roleInput.role;
  var companyName = String(body.companyName || "").trim();
  var inviteCode = String(body.inviteCode || "").trim().toUpperCase();
  var inviteToken = String(body.inviteToken || "").trim();
  var email = String(body.email || "").trim().toLowerCase();
  var password = String(body.password || "");

  if (!name || !email || !password) {
    return res.status(400).json({ error: "invalid_input", message: "Preencha nome, e-mail e senha." });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "weak_password", message: "A senha precisa ter pelo menos 6 caracteres." });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "invalid_email", message: "E-mail inválido." });
  }
  if (roleInput.invalid) {
    return res.status(400).json({ error: "invalid_role", message: INVALID_ROLE_MSG });
  }
  if (accountType === "empresa" && !companyName) {
    return res.status(400).json({ error: "invalid_input", message: "Informe o nome da academia." });
  }

  try {
    var existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "email_in_use", message: "Já existe uma conta com esse e-mail." });
    }

    // Se veio um token de convite por e-mail, ele manda mais que o codigo
    // manual: ja resolve a academia E carrega o horario de trabalho que ela
    // definiu (se definiu). Se veio um codigo de convite normal, confere
    // antes de criar a conta pra dar um erro claro em vez de criar um
    // profissional "solto" por engano.
    var invitedCompany = null;
    var inviteRow = null;
    if (accountType !== "empresa" && inviteToken) {
      var inviteLookup = await pool.query(
        "SELECT id, company_id, shift_start, shift_end, weekend_shift, access_role, monthly_salary FROM company_invites WHERE token = $1 AND used_at IS NULL",
        [inviteToken]
      );
      if (inviteLookup.rows.length === 0) {
        return res.status(400).json({ error: "invite_token_invalid", message: "Esse link de convite não é mais válido. Peça um novo pra academia." });
      }
      inviteRow = inviteLookup.rows[0];
      invitedCompany = { id: inviteRow.company_id };
      if (inviteRow.access_role === "coordinator" && isTraineeRole(role)) {
        return res.status(400).json({ error: "coordinator_not_trainee", message: COORDINATOR_NOT_TRAINEE_MSG });
      }
    } else if (accountType !== "empresa" && inviteCode) {
      var companyLookup = await pool.query("SELECT id, name FROM companies WHERE invite_code = $1", [inviteCode]);
      if (companyLookup.rows.length === 0) {
        return res.status(400).json({ error: "invite_code_invalid", message: "Código de convite inválido. Confira com a academia." });
      }
      invitedCompany = companyLookup.rows[0];
    }

    var hash = await bcrypt.hash(password, 10);
    var result = await pool.query(
      "INSERT INTO users (name, role, email, password_hash, company_id, personal_module) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, role, email, company_id, company_role, personal_module",
      [name, role, email, hash, invitedCompany ? invitedCompany.id : null, accountType !== "empresa" && roleInput.module]
    );
    var user = result.rows[0];

    if (accountType === "empresa") {
      var company = await createCompanyForOwner(user.id, companyName);
      await pool.query("UPDATE users SET company_id = $1, company_role = 'owner' WHERE id = $2", [company.id, user.id]);
      user.company_id = company.id;
      user.company_role = "owner";
    }

    if (inviteRow) {
      await pool.query("UPDATE company_invites SET used_at = now(), redeemed_user_id = $1 WHERE id = $2", [user.id, inviteRow.id]);
      // Convite de coordenador(a), socio(a) ou gerente: a conta ja nasce com
      // esse nivel de acesso, sem precisar de nenhum passo manual depois.
      if (inviteRow.access_role === "coordinator" || inviteRow.access_role === "partner" || inviteRow.access_role === "manager") {
        await pool.query("UPDATE users SET company_role = $1 WHERE id = $2", [inviteRow.access_role, user.id]);
        user.company_role = inviteRow.access_role;
        // salario mensal fixo combinado no convite de gerente
        if (inviteRow.access_role === "manager" && inviteRow.monthly_salary !== null) {
          await pool.query("UPDATE users SET monthly_salary = $1 WHERE id = $2", [inviteRow.monthly_salary, user.id]);
        }
      }
    }

    var publicUserObj = publicUser(user);
    // Socio(a) e gerente sao 100% administrativos (nao batem ponto), entao
    // nenhum horario sugerido faz sentido pra eles.
    if (inviteRow && inviteRow.access_role !== "partner" && inviteRow.access_role !== "manager") {
      var suggested = buildSuggestedSchedule(inviteRow.shift_start, inviteRow.shift_end, inviteRow.weekend_shift);
      if (suggested) publicUserObj.suggestedSchedule = suggested;
    }

    res.json({ token: signToken(user), user: publicUserObj });
  } catch (err) {
    console.error("Erro no /api/register:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

app.post("/api/login", limitLoginIp, limitLogin, async (req, res) => {
  var body = req.body || {};
  var email = String(body.email || "").trim().toLowerCase();
  var password = String(body.password || "");
  if (!email || !password) {
    return res.status(400).json({ error: "invalid_input", message: "Preencha e-mail e senha." });
  }
  try {
    var result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: "invalid_credentials", message: "E-mail ou senha incorretos." });
    }
    var user = result.rows[0];
    var ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: "invalid_credentials", message: "E-mail ou senha incorretos." });
    }
    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    console.error("Erro no /api/login:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

app.get("/api/me", auth, async (req, res) => {
  try {
    var result = await pool.query("SELECT id, name, role, email, company_id, company_role, personal_module FROM users WHERE id = $1", [req.userId]);
    if (result.rows.length === 0) return res.status(404).json({ error: "not_found" });
    res.json({ user: publicUser(result.rows[0]) });
  } catch (err) {
    console.error("Erro no /api/me:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// Professor, coordenador(a) ou gerente liga/desliga, para si mesmo, o modulo de alunos particulares.
app.put("/api/me/personal-module", auth, async (req, res) => {
  try {
    var enabled = !!(req.body && req.body.enabled);
    var me = await pool.query("SELECT company_role, role FROM users WHERE id = $1", [req.userId]);
    if (me.rows.length === 0) return res.status(404).json({ error: "not_found" });
    var cr = me.rows[0].company_role;
    var isTrainee = stripAccents(me.rows[0].role).toLowerCase().indexOf("estagi") >= 0;
    // Professor, coordenador(a) e gerente podem; estagiario (que atende so os VIP),
    // dono e socio(a) nao.
    if (cr === "owner" || cr === "partner" || (cr !== "manager" && isTrainee)) {
      return res.status(403).json({ error: "not_allowed", message: "Esse módulo é para professor, coordenador(a) e gerente." });
    }
    await pool.query("UPDATE users SET personal_module = $1 WHERE id = $2", [enabled, req.userId]);
    res.json({ ok: true, personalModule: enabled });
  } catch (err) {
    console.error("Erro no PUT /api/me/personal-module:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// Painel da academia: dono, socio(a) e gerente conseguem ver a lista de
// profissionais vinculados e o "data" (jsonb) de cada um, que e o mesmo
// formato que o proprio app usa pra calcular o total do mes — o painel
// reaproveita esse mesmo calculo no front-end, em vez de duplicar a logica
// financeira aqui no servidor. Excecao: gerente NAO tem acesso ao dinheiro
// que um profissional ganha com aluno particular (isso e renda pessoal do
// profissional, nao da academia) — so ao valor de grade/sala (o que ele
// trabalhou PRA academia). Por isso, pra gerente, a gente nem manda o
// "clients" de cada profissional — assim nem o total nem a lista de alunos
// particulares vazam pra quem nao devia ver.
app.get("/api/company/overview", auth, async (req, res) => {
  try {
    var me = await pool.query("SELECT company_id, company_role FROM users WHERE id = $1", [req.userId]);
    if (me.rows.length === 0) return res.status(404).json({ error: "not_found" });
    var myRole = me.rows[0].company_role;
    // Coordenador(a) nao tem acesso a valores financeiros, entao nao usa
    // esse endpoint (ver isScheduleViewer/isScheduleManager pra escala).
    if ((myRole !== "owner" && myRole !== "partner" && myRole !== "manager") || !me.rows[0].company_id) {
      return res.status(403).json({ error: "not_owner", message: "Você não tem acesso a esse painel." });
    }
    var companyId = me.rows[0].company_id;
    var company = await pool.query("SELECT id, name, invite_code FROM companies WHERE id = $1", [companyId]);
    if (company.rows.length === 0) return res.status(404).json({ error: "not_found" });

    var staff = await pool.query(
      `SELECT u.id, u.name, u.role, u.email, u.company_role, u.monthly_salary, s.data
       FROM users u
       LEFT JOIN user_state s ON s.user_id = u.id
       WHERE u.company_id = $1
       ORDER BY (u.company_role = 'owner') DESC, u.name ASC`,
      [companyId]
    );

    res.json({
      viewerRole: myRole,
      company: { name: company.rows[0].name, inviteCode: company.rows[0].invite_code },
      staff: staff.rows.map((row) => {
        // Alunos particulares sao renda pessoal do profissional: ninguem da
        // academia (nem dono, nem socio, nem gerente) ve — o servidor nem manda.
        var staffData = row.data || null;
        if (staffData) {
          staffData = Object.assign({}, staffData, { clients: [] });
        }
        return {
          id: row.id,
          name: row.name,
          role: row.role || "",
          email: row.email,
          isOwner: row.company_role === "owner",
          companyRole: row.company_role || null,
          // Salario fixo do gerente: dono e socio(a) veem o de todos os gerentes;
          // um gerente so ve o proprio (nunca o de outro gerente).
          monthlySalary: row.company_role === "manager" && row.monthly_salary !== null &&
            (myRole === "owner" || myRole === "partner" || row.id === req.userId)
            ? Number(row.monthly_salary) : null,
          data: staffData,
        };
      }),
    });
  } catch (err) {
    console.error("Erro no /api/company/overview:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// Convidar por e-mail: a academia digita nome/e-mail/funcao (e, opcionalmente,
// o horario de trabalho) uma unica vez, a gente gera um link de uso unico e
// manda por e-mail (reaproveitando o mesmo SMTP do "esqueci minha senha").
// Continua tambem devolvendo o link na resposta, pra quem preferir mandar
// por WhatsApp em vez de depender do e-mail.
app.post("/api/company/invite", auth, limitInvite, async (req, res) => {
  var body = req.body || {};
  var name = String(body.name || "").trim();
  var email = String(body.email || "").trim().toLowerCase();
  var inviteRoleInput = canonicalRole(body.role);
  var role = inviteRoleInput.invalid ? "" : inviteRoleInput.role;
  var accessRole = String(body.accessRole || "staff").trim();
  if (["staff", "coordinator", "partner", "manager"].indexOf(accessRole) === -1) accessRole = "staff";
  // Socio(a) e gerente sao 100% administrativos — nao faz sentido pedir
  // horario de trabalho pra eles.
  var isAdminInvite = accessRole === "partner" || accessRole === "manager";
  var shiftStart = isAdminInvite ? "" : String(body.shiftStart || "").trim();
  var shiftEnd = isAdminInvite ? "" : String(body.shiftEnd || "").trim();
  var weekendShift = isAdminInvite ? false : !!body.weekendShift;
  if (!name || !email) {
    return res.status(400).json({ error: "invalid_input", message: "Informe nome e e-mail." });
  }
  if (!isAdminInvite && inviteRoleInput.invalid) {
    return res.status(400).json({ error: "invalid_role", message: INVALID_ROLE_MSG });
  }
  if (accessRole === "coordinator" && isTraineeRole(role)) {
    return res.status(400).json({ error: "coordinator_not_trainee", message: COORDINATOR_NOT_TRAINEE_MSG });
  }
  var inviteSalary = null;
  if (body.monthlySalary !== undefined && body.monthlySalary !== null && body.monthlySalary !== "") {
    inviteSalary = Number(body.monthlySalary);
    if (!isFinite(inviteSalary) || inviteSalary < 0 || inviteSalary > 9999999) {
      return res.status(400).json({ error: "invalid_input", message: "Salário inválido." });
    }
    inviteSalary = Math.round(inviteSalary * 100) / 100;
  }
  try {
    var me = await pool.query("SELECT company_id, company_role FROM users WHERE id = $1", [req.userId]);
    if (me.rows.length === 0) return res.status(404).json({ error: "not_found" });
    if (!isCompanyManager(me.rows[0].company_role) || !me.rows[0].company_id) {
      return res.status(403).json({ error: "not_owner", message: "Só o dono ou o(a) gerente da academia podem convidar." });
    }
    // Quem convida so pode dar niveis que tambem poderia atribuir (um gerente
    // nao convida outro gerente nem socio).
    if (assignableAccessRoles(me.rows[0].company_role).indexOf(accessRole) === -1) {
      return res.status(403).json({ error: "not_allowed", message: "Você não pode convidar com esse nível de acesso." });
    }
    // O salario fixo e coisa do dono e so existe para gerente.
    if (accessRole !== "manager" || me.rows[0].company_role !== "owner") inviteSalary = null;
    var companyId = me.rows[0].company_id;
    var companyRow = await pool.query("SELECT name FROM companies WHERE id = $1", [companyId]);
    var companyName = companyRow.rows[0] ? companyRow.rows[0].name : "sua academia";
    var token = randomInviteToken();
    await pool.query(
      `INSERT INTO company_invites (company_id, token, name, role, email, shift_start, shift_end, weekend_shift, access_role, monthly_salary)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [companyId, token, name, role, email, shiftStart || null, shiftEnd || null, weekendShift, accessRole, inviteSalary]
    );
    await audit(companyId, req.userId, "invite_created", null, name, accessLabelPt(accessRole) + (role ? " · " + role : "") + " · " + email);
    var link = APP_URL.replace(/\/+$/, "") + "/?invite=" + token;
    var emailSent = false;
    if (mailer) {
      try {
        await sendInviteEmail(email, name, companyName, link);
        emailSent = true;
      } catch (mailErr) {
        console.error("Falha ao enviar e-mail de convite:", mailErr);
      }
    }
    res.json({ ok: true, inviteLink: link, emailSent: emailSent });
  } catch (err) {
    console.error("Erro no /api/company/invite:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// Publico (sem login) — a tela de cadastro usa isso pra pre-preencher
// nome/funcao/e-mail quando a pessoa abre o link do convite.
app.get("/api/company/invite/:token", async (req, res) => {
  try {
    var token = String(req.params.token || "");
    var result = await pool.query(
      `SELECT ci.name, ci.role, ci.email, ci.access_role, c.name AS company_name
       FROM company_invites ci JOIN companies c ON c.id = ci.company_id
       WHERE ci.token = $1 AND ci.used_at IS NULL`,
      [token]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ valid: false, error: "invite_not_found", message: "Convite inválido ou já usado." });
    }
    var row = result.rows[0];
    res.json({ valid: true, name: row.name, role: row.role || "", email: row.email, companyName: row.company_name, accessRole: row.access_role || "staff" });
  } catch (err) {
    console.error("Erro no GET /api/company/invite/:token:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// Lista de convites da academia (pendentes e ja usados), pro dono acompanhar
// quem ainda nao entrou e reenviar o link se precisar.
app.get("/api/company/invites", auth, async (req, res) => {
  try {
    var me = await pool.query("SELECT company_id, company_role FROM users WHERE id = $1", [req.userId]);
    if (me.rows.length === 0) return res.status(404).json({ error: "not_found" });
    if (!isCompanyManager(me.rows[0].company_role) || !me.rows[0].company_id) {
      return res.status(403).json({ error: "not_owner" });
    }
    var result = await pool.query(
      `SELECT id, name, role, email, token, used_at, access_role
       FROM company_invites
       WHERE company_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [me.rows[0].company_id]
    );
    var invites = result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      role: row.role || "",
      email: row.email,
      status: row.used_at ? "used" : "pending",
      accessRole: row.access_role || "staff",
      inviteLink: APP_URL.replace(/\/+$/, "") + "/?invite=" + row.token,
    }));
    res.json({ invites: invites });
  } catch (err) {
    console.error("Erro no GET /api/company/invites:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// Cancela um convite ainda nao usado (nao apaga o historico dos ja usados).
app.delete("/api/company/invite/:id", auth, async (req, res) => {
  try {
    var me = await pool.query("SELECT company_id, company_role FROM users WHERE id = $1", [req.userId]);
    if (me.rows.length === 0) return res.status(404).json({ error: "not_found" });
    if (!isCompanyManager(me.rows[0].company_role) || !me.rows[0].company_id) {
      return res.status(403).json({ error: "not_owner" });
    }
    var cancelled = await pool.query(
      "DELETE FROM company_invites WHERE id = $1 AND company_id = $2 AND used_at IS NULL RETURNING name, email",
      [req.params.id, me.rows[0].company_id]
    );
    if (cancelled.rows.length) await audit(me.rows[0].company_id, req.userId, "invite_cancelled", null, cancelled.rows[0].name, cancelled.rows[0].email);
    res.json({ ok: true });
  } catch (err) {
    console.error("Erro no DELETE /api/company/invite/:id:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// ---------- gestao da equipe ----------
// Dados de quem esta agindo (papel e academia), usado pelas rotas abaixo.
async function loadActor(userId) {
  var me = await pool.query("SELECT id, name, company_id, company_role FROM users WHERE id = $1", [userId]);
  return me.rows[0] || null;
}

// Trocar a funcao (estagiario/professor/personal) e/ou o nivel de acesso de alguem.
app.put("/api/company/staff/:id/access", auth, async (req, res) => {
  try {
    var actor = await loadActor(req.userId);
    if (!actor || !actor.company_id || !isCompanyManager(actor.company_role)) {
      return res.status(403).json({ error: "not_allowed", message: "Só o dono ou o(a) gerente podem alterar a equipe." });
    }
    var targetId = parseInt(req.params.id, 10);
    if (isNaN(targetId)) return res.status(400).json({ error: "invalid_input" });
    if (targetId === actor.id) {
      return res.status(400).json({ error: "invalid_target", message: "Você não pode alterar o seu próprio acesso." });
    }
    var target = await pool.query("SELECT id, name, role, company_id, company_role FROM users WHERE id = $1", [targetId]);
    var t = target.rows[0];
    if (!t || t.company_id !== actor.company_id) return res.status(404).json({ error: "not_found" });
    if (!managerCanManage(actor.company_role, t.company_role)) {
      return res.status(403).json({ error: "not_allowed", message: "Você não tem permissão para alterar essa pessoa." });
    }
    var body = req.body || {};
    var newRole = null;
    if (typeof body.role === "string") {
      var editRole = canonicalRole(body.role);
      if (editRole.invalid) return res.status(400).json({ error: "invalid_role", message: INVALID_ROLE_MSG });
      newRole = editRole.role;
    }
    var newAccess = typeof body.accessRole === "string" ? body.accessRole.trim() : null;
    var hasSalary = Object.prototype.hasOwnProperty.call(body, "monthlySalary");
    var newSalary = null;
    if (hasSalary && body.monthlySalary !== null && body.monthlySalary !== "") {
      newSalary = Number(body.monthlySalary);
      if (!isFinite(newSalary) || newSalary < 0 || newSalary > 9999999) {
        return res.status(400).json({ error: "invalid_input", message: "Salário inválido." });
      }
      newSalary = Math.round(newSalary * 100) / 100;
    }
    if (hasSalary && actor.company_role !== "owner") {
      return res.status(403).json({ error: "not_allowed", message: "Só o dono define o salário do gerente." });
    }
    if (newRole !== null && newRole.length > 60) return res.status(400).json({ error: "invalid_input", message: "Função muito longa." });
    if (newAccess !== null && assignableAccessRoles(actor.company_role).indexOf(newAccess) === -1) {
      return res.status(403).json({ error: "not_allowed", message: "Você não pode atribuir esse nível de acesso." });
    }
    var finalRole = newRole !== null ? newRole : (t.role || "");
    var finalAccess = newAccess !== null ? accessRoleToDb(newAccess) : (t.company_role || null);
    if (finalAccess === "coordinator" && isTraineeRole(finalRole)) {
      return res.status(400).json({ error: "coordinator_not_trainee", message: COORDINATOR_NOT_TRAINEE_MSG });
    }
    var changes = [];
    if (newRole !== null && newRole !== (t.role || "")) {
      await pool.query("UPDATE users SET role = $1 WHERE id = $2", [newRole, targetId]);
      changes.push("função: " + (t.role || "—") + " → " + (newRole || "—"));
    }
    if (newAccess !== null && accessRoleToDb(newAccess) !== (t.company_role || null)) {
      await pool.query("UPDATE users SET company_role = $1 WHERE id = $2", [accessRoleToDb(newAccess), targetId]);
      changes.push("acesso: " + accessLabelPt(t.company_role) + " → " + accessLabelPt(newAccess));
    }
    var resultingRole = newAccess !== null ? accessRoleToDb(newAccess) : (t.company_role || null);
    if (resultingRole !== "manager") {
      // quem deixa de ser gerente perde o salario fixo
      await pool.query("UPDATE users SET monthly_salary = NULL WHERE id = $1 AND monthly_salary IS NOT NULL", [targetId]);
    } else if (hasSalary) {
      var salaryBefore = await pool.query("SELECT monthly_salary FROM users WHERE id = $1", [targetId]);
      var before = salaryBefore.rows[0].monthly_salary === null ? null : Number(salaryBefore.rows[0].monthly_salary);
      if (before !== newSalary) {
        await pool.query("UPDATE users SET monthly_salary = $1 WHERE id = $2", [newSalary, targetId]);
        // o historico e lido por gerente/socio: registra que mudou, sem o valor
        changes.push("salário mensal alterado");
      }
    }
    if (changes.length) await audit(actor.company_id, actor.id, "member_updated", targetId, t.name, changes.join("; "));
    res.json({ ok: true, changed: changes.length > 0 });
  } catch (err) {
    console.error("Erro no PUT /api/company/staff/:id/access:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// Tira alguem da academia. A conta e os dados pessoais da pessoa (horas,
// alunos particulares) continuam dela — so o vinculo com a academia acaba, e
// com ele o acesso do dono/gerente aos valores e a presenca na escala. O
// historico de escala ja lancado fica guardado.
app.delete("/api/company/staff/:id", auth, async (req, res) => {
  try {
    var actor = await loadActor(req.userId);
    if (!actor || !actor.company_id || !isCompanyManager(actor.company_role)) {
      return res.status(403).json({ error: "not_allowed", message: "Só o dono ou o(a) gerente podem remover alguém da equipe." });
    }
    var targetId = parseInt(req.params.id, 10);
    if (isNaN(targetId)) return res.status(400).json({ error: "invalid_input" });
    if (targetId === actor.id) {
      return res.status(400).json({ error: "invalid_target", message: "Você não pode remover a si mesmo." });
    }
    var target = await pool.query("SELECT id, name, company_id, company_role FROM users WHERE id = $1", [targetId]);
    var t = target.rows[0];
    if (!t || t.company_id !== actor.company_id) return res.status(404).json({ error: "not_found" });
    if (!managerCanManage(actor.company_role, t.company_role)) {
      return res.status(403).json({ error: "not_allowed", message: "Você não tem permissão para remover essa pessoa." });
    }
    await pool.query("UPDATE users SET company_id = NULL, company_role = NULL WHERE id = $1", [targetId]);
    await audit(actor.company_id, actor.id, "member_removed", targetId, t.name, "acesso que tinha: " + accessLabelPt(t.company_role));
    res.json({ ok: true });
  } catch (err) {
    console.error("Erro no DELETE /api/company/staff/:id:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// Gera um codigo de convite novo; o antigo deixa de valer na hora (quem ja
// entrou continua na academia).
app.post("/api/company/invite-code/rotate", auth, async (req, res) => {
  try {
    var actor = await loadActor(req.userId);
    if (!actor || !actor.company_id || !isCompanyManager(actor.company_role)) {
      return res.status(403).json({ error: "not_allowed", message: "Só o dono ou o(a) gerente podem gerar um novo código." });
    }
    for (var attempt = 0; attempt < 5; attempt++) {
      var code = randomInviteCode();
      try {
        await pool.query("UPDATE companies SET invite_code = $1 WHERE id = $2", [code, actor.company_id]);
        await audit(actor.company_id, actor.id, "invite_code_rotated", null, null, null);
        return res.json({ ok: true, inviteCode: code });
      } catch (err) {
        if (err && err.code === "23505") continue;
        throw err;
      }
    }
    res.status(500).json({ error: "internal_error" });
  } catch (err) {
    console.error("Erro no POST /api/company/invite-code/rotate:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// Historico das alteracoes de equipe (dono, gerente e socio(a) so leem).
app.get("/api/company/audit", auth, async (req, res) => {
  try {
    var actor = await loadActor(req.userId);
    if (!actor || !actor.company_id || ["owner", "manager", "partner"].indexOf(actor.company_role) === -1) {
      return res.status(403).json({ error: "not_allowed" });
    }
    var result = await pool.query(
      `SELECT a.id, a.action, a.target_name, a.detail, a.created_at, u.name AS actor_name
       FROM company_audit a LEFT JOIN users u ON u.id = a.actor_user_id
       WHERE a.company_id = $1
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT 50`,
      [actor.company_id]
    );
    res.json({ entries: result.rows.map((r) => ({
      id: r.id, action: r.action, targetName: r.target_name || "", detail: r.detail || "",
      actorName: r.actor_name || "—", createdAt: r.created_at,
    })) });
  } catch (err) {
    console.error("Erro no GET /api/company/audit:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// Editar o horario de trabalho (grade de segunda a sexta + turno de fim de
// semana) de um profissional ja vinculado — depois do convite, so gerente e
// coordenador(a) mexem nisso (quem toca a operacao no dia a dia). Dono e
// socio(a) so acompanham esse dado (na lista da equipe), sem editar, de
// proposito — pra nao correr o risco de mudar horario de alguem sem querer;
// isCompanyManager (dono+gerente) e usado pra convidar/gerenciar QUEM entra
// na equipe, mas editar O HORARIO de quem ja entrou e mais restrito ainda.
function isStaffScheduleEditor(role) {
  return role === "manager" || role === "coordinator";
}
app.put("/api/company/staff/:id/schedule", auth, async (req, res) => {
  try {
    var me = await pool.query("SELECT company_id, company_role FROM users WHERE id = $1", [req.userId]);
    if (me.rows.length === 0) return res.status(404).json({ error: "not_found" });
    if (!isStaffScheduleEditor(me.rows[0].company_role) || !me.rows[0].company_id) {
      return res.status(403).json({ error: "not_allowed", message: "Só gerente ou coordenador(a) podem editar o horário da equipe." });
    }
    var companyId = me.rows[0].company_id;
    var targetId = parseInt(req.params.id, 10);
    if (isNaN(targetId)) return res.status(400).json({ error: "invalid_input" });
    var target = await pool.query("SELECT id, company_id, company_role FROM users WHERE id = $1", [targetId]);
    if (target.rows.length === 0 || target.rows[0].company_id !== companyId) {
      return res.status(404).json({ error: "not_found" });
    }
    if (target.rows[0].company_role && target.rows[0].company_role !== "coordinator") {
      return res.status(400).json({ error: "invalid_target", message: "Esse acesso não tem horário de grade pra editar." });
    }
    var body = req.body || {};
    var shiftStart = String(body.shiftStart || "").trim();
    var shiftEnd = String(body.shiftEnd || "").trim();
    var weekendShift = !!body.weekendShift;
    var suggested = buildSuggestedSchedule(shiftStart, shiftEnd, weekendShift);
    if (!suggested) {
      return res.status(400).json({ error: "invalid_input", message: "Informe um horário de início e fim válidos." });
    }
    var stateRes = await pool.query("SELECT data FROM user_state WHERE user_id = $1", [targetId]);
    var targetData = (stateRes.rows[0] && stateRes.rows[0].data) || null;
    if (!targetData || typeof targetData !== "object") {
      return res.status(400).json({ error: "no_data", message: "Esse profissional ainda não abriu o app pela primeira vez." });
    }
    if (!targetData.settings || typeof targetData.settings !== "object") targetData.settings = {};
    targetData.settings.timeSlots = suggested.timeSlots;
    targetData.settings.weekendShiftEnabled = suggested.weekendShiftEnabled;
    // Carimba como "agora" de proposito: essa mudanca deve vencer qualquer
    // dado mais antigo que o aparelho do profissional ainda tenha guardado,
    // e a resolucao de sincronizacao (ver state.js/resolveInitialSync) ja
    // trata "servidor mais novo" corretamente.
    targetData.updatedAt = new Date().toISOString();
    await pool.query(
      `INSERT INTO user_state (user_id, data, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (user_id) DO UPDATE SET data = $2, updated_at = now()`,
      [targetId, targetData]
    );
    res.json({ ok: true, timeSlots: suggested.timeSlots, weekendShiftEnabled: suggested.weekendShiftEnabled });
  } catch (err) {
    console.error("Erro no PUT /api/company/staff/:id/schedule:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// ---------- escala planejada (por turno) + avisos ----------
// O coordenador (ou gerente/dono) monta quem faz cada turno nos fins de semana e
// feriados e PUBLICA; a equipe so ve a versao publicada, e quem foi afetado
// recebe um aviso (dentro do app e, se o e-mail estiver configurado, por e-mail).
var PT_WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
var PT_MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
function monthNamePt(month) {
  var p = month.split("-");
  return PT_MONTHS[parseInt(p[1], 10) - 1] + " de " + p[0];
}
function dateLabelPt(date) {
  var d = new Date(date + "T12:00:00Z");
  return PT_WEEKDAYS[d.getUTCDay()] + " " + date.slice(8, 10) + "/" + date.slice(5, 7);
}
function isHHMM(t) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(t || "")); }
function timeToMin(t) { var p = String(t).split(":"); return parseInt(p[0], 10) * 60 + parseInt(p[1], 10); }
var SHIFT_KINDS = ["estagiario", "professor", "any"];
// Estagiario so entra em turno de estagiario; professor (e coordenador) em turno de professor.
function kindAllows(kind, userRole) {
  var trainee = isTraineeRole(userRole);
  if (kind === "estagiario") return trainee;
  if (kind === "professor") return !trainee;
  return true;
}
function validMonth(m) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(m || "")); }

async function ensureDefaultShiftTypes(companyId) {
  var has = await pool.query("SELECT 1 FROM company_shift_types WHERE company_id = $1 LIMIT 1", [companyId]);
  if (has.rows.length > 0) return;
  var defaults = [
    ["Estagiário — manhã", "08:00", "13:00", "estagiario"],
    ["Estagiário — tarde", "13:00", "18:00", "estagiario"],
    ["Professor", "10:00", "14:00", "professor"],
  ];
  for (var i = 0; i < defaults.length; i++) {
    await pool.query(
      "INSERT INTO company_shift_types (company_id, name, start_time, end_time, kind, sort_order) VALUES ($1, $2, $3, $4, $5, $6)",
      [companyId, defaults[i][0], defaults[i][1], defaults[i][2], defaults[i][3], i]
    );
  }
}

async function rosterTypes(companyId) {
  var r = await pool.query(
    "SELECT id, name, start_time, end_time, kind FROM company_shift_types WHERE company_id = $1 AND active ORDER BY sort_order, id",
    [companyId]
  );
  return r.rows.map((t) => ({ id: t.id, name: t.name, startTime: t.start_time, endTime: t.end_time, kind: t.kind }));
}

async function rosterSnapshotKeys(companyId, month) {
  var r = await pool.query(
    "SELECT user_id, date, shift_type_id FROM company_roster_entries WHERE company_id = $1 AND date LIKE $2",
    [companyId, month + "-%"]
  );
  return r.rows.map((e) => e.user_id + "|" + e.date + "|" + e.shift_type_id).sort();
}

function sameKeys(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

async function rosterActor(userId) {
  var r = await pool.query("SELECT id, name, role, company_id, company_role FROM users WHERE id = $1", [userId]);
  return r.rows[0] || null;
}

// Visao de quem gerencia/acompanha: rascunho completo + estado da publicacao.
app.get("/api/company/roster", auth, async (req, res) => {
  try {
    var me = await rosterActor(req.userId);
    if (!me || !me.company_id || !isScheduleViewer(me.company_role)) {
      return res.status(403).json({ error: "not_allowed", message: "Você não tem acesso à escala da equipe." });
    }
    var month = String(req.query.month || "").trim();
    if (!validMonth(month)) return res.status(400).json({ error: "invalid_month" });
    await ensureDefaultShiftTypes(me.company_id);
    var types = await rosterTypes(me.company_id);
    var staff = await pool.query(
      `SELECT id, name, role, company_role FROM users
       WHERE company_id = $1 AND (company_role IS NULL OR company_role = 'coordinator') ORDER BY name ASC`,
      [me.company_id]
    );
    var entries = await pool.query(
      "SELECT id, date, shift_type_id, user_id FROM company_roster_entries WHERE company_id = $1 AND date LIKE $2 ORDER BY date, id",
      [me.company_id, month + "-%"]
    );
    var mrow = await pool.query("SELECT published_at, snapshot FROM company_roster_months WHERE company_id = $1 AND month = $2", [me.company_id, month]);
    var published = mrow.rows[0] && mrow.rows[0].published_at ? mrow.rows[0] : null;
    var current = entries.rows.map((e) => e.user_id + "|" + e.date + "|" + e.shift_type_id).sort();
    var pubUsers = {};
    if (published) (published.snapshot || []).forEach((k) => { pubUsers[parseInt(k.split("|")[0], 10)] = true; });
    var ackRows = await pool.query("SELECT user_id FROM company_roster_acks WHERE company_id = $1 AND month = $2", [me.company_id, month]);
    var pendSw = await pool.query("SELECT COUNT(*)::int AS n FROM roster_swap_requests WHERE company_id = $1 AND status = 'pending_manager'", [me.company_id]);
    res.json({
      publishedUserIds: Object.keys(pubUsers).map((u) => parseInt(u, 10)),
      ackedUserIds: ackRows.rows.map((r) => r.user_id),
      pendingSwaps: pendSw.rows[0].n,
      canManage: isScheduleManager(me.company_role),
      shiftTypes: types,
      staff: staff.rows.map((u) => ({ id: u.id, name: u.name, role: u.role || "", companyRole: u.company_role || null })),
      entries: entries.rows.map((e) => ({ id: e.id, date: e.date, shiftTypeId: e.shift_type_id, userId: e.user_id })),
      publication: {
        published: !!published,
        publishedAt: published ? published.published_at : null,
        changedSincePublish: !!published && !sameKeys((published.snapshot || []).slice().sort(), current),
      },
    });
  } catch (err) {
    console.error("Erro no GET /api/company/roster:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// Visao da equipe: so a versao PUBLICADA, para qualquer pessoa da academia.
app.get("/api/me/roster", auth, async (req, res) => {
  try {
    var me = await rosterActor(req.userId);
    if (!me || !me.company_id) return res.status(403).json({ error: "not_allowed", message: "Você não está ligado a uma academia." });
    var month = String(req.query.month || "").trim();
    if (!validMonth(month)) return res.status(400).json({ error: "invalid_month" });
    var mrow = await pool.query("SELECT published_at, snapshot FROM company_roster_months WHERE company_id = $1 AND month = $2", [me.company_id, month]);
    var row = mrow.rows[0];
    if (!row || !row.published_at) return res.json({ published: false, shiftTypes: [], entries: [] });
    var types = await rosterTypes(me.company_id);
    var typeIds = {}; types.forEach((t) => { typeIds[t.id] = true; });
    var users = await pool.query("SELECT id, name, role FROM users WHERE company_id = $1 AND (company_role IS NULL OR company_role = 'coordinator')", [me.company_id]);
    var names = {}; users.rows.forEach((u) => { names[u.id] = u.name; });
    var entries = [];
    (row.snapshot || []).forEach((k) => {
      var p = k.split("|");
      var uid = parseInt(p[0], 10), sid = parseInt(p[2], 10);
      if (names[uid] && typeIds[sid]) entries.push({ date: p[1], shiftTypeId: sid, userId: uid, userName: names[uid] });
    });
    entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.shiftTypeId - b.shiftTypeId));
    var ack = await pool.query("SELECT acked_at FROM company_roster_acks WHERE user_id = $1 AND month = $2", [me.id, month]);
    var team = users.rows.filter((u) => u.id !== me.id).map((u) => ({ id: u.id, name: u.name, role: u.role || "" }));
    res.json({ published: true, publishedAt: row.published_at, shiftTypes: types, entries: entries, me: me.id,
      acked: ack.rows.length > 0, ackedAt: ack.rows[0] ? ack.rows[0].acked_at : null, team: team });
  } catch (err) {
    console.error("Erro no GET /api/me/roster:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

app.post("/api/company/roster/entries", auth, async (req, res) => {
  try {
    var me = await rosterActor(req.userId);
    if (!me || !me.company_id || !isScheduleManager(me.company_role)) {
      return res.status(403).json({ error: "not_allowed", message: "Você não pode editar a escala da equipe." });
    }
    var body = req.body || {};
    var date = String(body.date || "").trim();
    var typeId = parseInt(body.shiftTypeId, 10), userId = parseInt(body.userId, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !typeId || !userId) return res.status(400).json({ error: "invalid_input" });
    var type = await pool.query("SELECT id, name, start_time, end_time, kind FROM company_shift_types WHERE id = $1 AND company_id = $2 AND active", [typeId, me.company_id]);
    if (type.rows.length === 0) return res.status(400).json({ error: "invalid_shift", message: "Turno não encontrado." });
    var target = await pool.query("SELECT id, name, role, company_role FROM users WHERE id = $1 AND company_id = $2", [userId, me.company_id]);
    var t = target.rows[0];
    if (!t || !(t.company_role === null || t.company_role === "coordinator")) {
      return res.status(400).json({ error: "invalid_user", message: "Essa pessoa não entra na escala de turnos." });
    }
    if (!kindAllows(type.rows[0].kind, t.role)) {
      var needs = type.rows[0].kind === "estagiario" ? "estagiário(a)" : "professor(a)";
      return res.status(400).json({ error: "wrong_kind", message: t.name + " não pode fazer este turno: ele é para " + needs + "." });
    }
    // a mesma pessoa nao pode ter dois turnos que se sobrepoem no mesmo dia
    var others = await pool.query(
      `SELECT s.name, s.start_time, s.end_time FROM company_roster_entries e JOIN company_shift_types s ON s.id = e.shift_type_id
       WHERE e.company_id = $1 AND e.user_id = $2 AND e.date = $3 AND e.shift_type_id <> $4`,
      [me.company_id, userId, date, typeId]
    );
    var ns = timeToMin(type.rows[0].start_time), ne = timeToMin(type.rows[0].end_time);
    for (var i = 0; i < others.rows.length; i++) {
      var os = timeToMin(others.rows[i].start_time), oe = timeToMin(others.rows[i].end_time);
      if (ns < oe && os < ne) {
        return res.status(409).json({ error: "overlap", message: t.name + " já está escalado(a) em \"" + others.rows[i].name + "\" (" + others.rows[i].start_time + "–" + others.rows[i].end_time + "), que se sobrepõe a este turno." });
      }
    }
    var ins = await pool.query(
      `INSERT INTO company_roster_entries (company_id, date, shift_type_id, user_id, created_by)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (date, shift_type_id, user_id) DO NOTHING RETURNING id`,
      [me.company_id, date, typeId, userId, req.userId]
    );
    res.json({ ok: true, id: ins.rows[0] ? ins.rows[0].id : null });
  } catch (err) {
    console.error("Erro no POST /api/company/roster/entries:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

app.delete("/api/company/roster/entries/:id", auth, async (req, res) => {
  try {
    var me = await rosterActor(req.userId);
    if (!me || !me.company_id || !isScheduleManager(me.company_role)) return res.status(403).json({ error: "not_allowed" });
    await pool.query("DELETE FROM company_roster_entries WHERE id = $1 AND company_id = $2", [parseInt(req.params.id, 10), me.company_id]);
    res.json({ ok: true });
  } catch (err) {
    console.error("Erro no DELETE /api/company/roster/entries/:id:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// Turnos e horarios editaveis (padrao: estagiario 08-13, estagiario 13-18, professor 10-14).
function readShiftBody(body) {
  var name = String((body && body.name) || "").trim();
  var start = String((body && body.startTime) || "").trim(), end = String((body && body.endTime) || "").trim();
  var kind = String((body && body.kind) || "any").trim();
  if (!name || name.length > 40) return { error: "Dê um nome ao turno (até 40 letras)." };
  if (!isHHMM(start) || !isHHMM(end) || timeToMin(start) >= timeToMin(end)) return { error: "Informe um horário de início e um de fim válidos (o fim depois do início)." };
  if (SHIFT_KINDS.indexOf(kind) === -1) return { error: "Escolha para quem é o turno." };
  return { name: name, start: start, end: end, kind: kind };
}

app.post("/api/company/shift-types", auth, async (req, res) => {
  try {
    var me = await rosterActor(req.userId);
    if (!me || !me.company_id || !isScheduleManager(me.company_role)) return res.status(403).json({ error: "not_allowed", message: "Você não pode editar os turnos." });
    var b = readShiftBody(req.body);
    if (b.error) return res.status(400).json({ error: "invalid_input", message: b.error });
    var next = await pool.query("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM company_shift_types WHERE company_id = $1", [me.company_id]);
    var r = await pool.query(
      "INSERT INTO company_shift_types (company_id, name, start_time, end_time, kind, sort_order) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
      [me.company_id, b.name, b.start, b.end, b.kind, next.rows[0].n]
    );
    res.json({ ok: true, id: r.rows[0].id });
  } catch (err) {
    console.error("Erro no POST /api/company/shift-types:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

app.put("/api/company/shift-types/:id", auth, async (req, res) => {
  try {
    var me = await rosterActor(req.userId);
    if (!me || !me.company_id || !isScheduleManager(me.company_role)) return res.status(403).json({ error: "not_allowed", message: "Você não pode editar os turnos." });
    var b = readShiftBody(req.body);
    if (b.error) return res.status(400).json({ error: "invalid_input", message: b.error });
    var r = await pool.query(
      "UPDATE company_shift_types SET name = $1, start_time = $2, end_time = $3, kind = $4 WHERE id = $5 AND company_id = $6 AND active RETURNING id",
      [b.name, b.start, b.end, b.kind, parseInt(req.params.id, 10), me.company_id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true });
  } catch (err) {
    console.error("Erro no PUT /api/company/shift-types/:id:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// Excluir um turno apaga tambem as pessoas escaladas nele.
app.delete("/api/company/shift-types/:id", auth, async (req, res) => {
  try {
    var me = await rosterActor(req.userId);
    if (!me || !me.company_id || !isScheduleManager(me.company_role)) return res.status(403).json({ error: "not_allowed" });
    await pool.query("DELETE FROM company_shift_types WHERE id = $1 AND company_id = $2", [parseInt(req.params.id, 10), me.company_id]);
    res.json({ ok: true });
  } catch (err) {
    console.error("Erro no DELETE /api/company/shift-types/:id:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

function sendRosterEmail(toEmail, name, companyName, title, lines) {
  var items = lines.map((l) => "<li>" + escapeHtml(l) + "</li>").join("");
  return mailer.sendMail({
    from: "Ponto Overall <" + SMTP_USER + ">",
    to: toEmail,
    subject: title + " — " + companyName,
    text: "Oi, " + name + "!\n\n" + title + ":\n\n" + lines.join("\n") + "\n\nVeja no app: " + APP_URL,
    html: "<p>Oi, " + escapeHtml(name) + "!</p><p><strong>" + escapeHtml(title) + "</strong></p><ul>" + items + "</ul>" +
      "<p><a href=\"" + escapeHtml(APP_URL) + "\">Abrir o Ponto Overall</a></p>",
  });
}

// Publica a escala do mes: a equipe passa a ver e quem foi afetado e avisado.
app.post("/api/company/roster/publish", auth, async (req, res) => {
  try {
    var me = await rosterActor(req.userId);
    if (!me || !me.company_id || !isScheduleManager(me.company_role)) {
      return res.status(403).json({ error: "not_allowed", message: "Você não pode publicar a escala." });
    }
    var month = String((req.body && req.body.month) || "").trim();
    if (!validMonth(month)) return res.status(400).json({ error: "invalid_month" });
    var current = await rosterSnapshotKeys(me.company_id, month);
    if (current.length === 0) return res.status(400).json({ error: "empty", message: "Monte a escala antes de publicar: ainda não há ninguém escalado neste mês." });
    var prevRow = await pool.query("SELECT published_at, snapshot FROM company_roster_months WHERE company_id = $1 AND month = $2", [me.company_id, month]);
    var wasPublished = !!(prevRow.rows[0] && prevRow.rows[0].published_at);
    var prev = wasPublished ? (prevRow.rows[0].snapshot || []).slice().sort() : [];
    if (wasPublished && sameKeys(prev, current)) return res.json({ ok: true, notified: 0, unchanged: true });
    await pool.query(
      `INSERT INTO company_roster_months (company_id, month, published_at, published_by, snapshot)
       VALUES ($1, $2, now(), $3, $4::jsonb)
       ON CONFLICT (company_id, month) DO UPDATE SET published_at = now(), published_by = $3, snapshot = $4::jsonb`,
      [me.company_id, month, req.userId, JSON.stringify(current)]
    );
    // quem foi afetado: tem algum turno novo, mudou ou saiu
    var byUser = function (keys) { var m = {}; keys.forEach((k) => { var u = k.split("|")[0]; (m[u] = m[u] || []).push(k); }); return m; };
    var before = byUser(prev), after = byUser(current);
    var affected = {};
    Object.keys(after).forEach((u) => { if (!sameKeys((before[u] || []).slice().sort(), after[u].slice().sort())) affected[u] = true; });
    Object.keys(before).forEach((u) => { if (!after[u]) affected[u] = true; });
    var ids = Object.keys(affected).map((u) => parseInt(u, 10));
    // quem teve a escala alterada precisa dar "ciente" de novo
    if (ids.length) await pool.query("DELETE FROM company_roster_acks WHERE company_id = $1 AND month = $2 AND user_id = ANY($3::int[])", [me.company_id, month, ids]);
    var company = await pool.query("SELECT name FROM companies WHERE id = $1", [me.company_id]);
    var companyName = company.rows[0] ? company.rows[0].name : "sua academia";
    var types = await pool.query("SELECT id, name, start_time, end_time FROM company_shift_types WHERE company_id = $1", [me.company_id]);
    var typeMap = {}; types.rows.forEach((t) => { typeMap[t.id] = t; });
    var users = ids.length ? await pool.query("SELECT id, name, email FROM users WHERE id = ANY($1::int[]) AND company_id = $2", [ids, me.company_id]) : { rows: [] };
    var monthName = monthNamePt(month);
    for (var i = 0; i < users.rows.length; i++) {
      var u = users.rows[i];
      var mine = (after[u.id] || []).map((k) => { var p = k.split("|"); return { date: p[1], shift: typeMap[parseInt(p[2], 10)] }; })
        .filter((x) => x.shift).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      var lines = mine.map((x) => dateLabelPt(x.date) + " · " + x.shift.name + " (" + x.shift.start_time + "–" + x.shift.end_time + ")");
      var title, bodyText;
      if (mine.length === 0) { title = "Você saiu da escala de " + monthName; bodyText = "Você não está mais escalado(a) neste mês."; lines = [bodyText]; }
      else { title = wasPublished ? "Sua escala de " + monthName + " mudou" : "Escala de " + monthName + " publicada"; bodyText = lines.join("\n"); }
      await pool.query("INSERT INTO user_notifications (user_id, company_id, kind, title, body) VALUES ($1, $2, 'roster', $3, $4)", [u.id, me.company_id, title, bodyText]);
      if (mailer && u.email && !/\.invalid$/i.test(u.email)) {
        sendRosterEmail(u.email, u.name, companyName, title, lines).catch((e) => console.error("Falha ao enviar e-mail da escala:", e.message));
      }
    }
    await audit(me.company_id, req.userId, "roster_published", null, null, monthName + " · " + users.rows.length + " pessoa(s) avisada(s)");
    res.json({ ok: true, notified: users.rows.length });
  } catch (err) {
    console.error("Erro no POST /api/company/roster/publish:", err);
    res.status(500).json({ error: "internal_error" });
  }
});


// ---------- "Ciente" da escala e troca de plantao ----------
app.post("/api/me/roster/ack", auth, async (req, res) => {
  try {
    var me = await rosterActor(req.userId);
    if (!me || !me.company_id) return res.status(403).json({ error: "not_allowed" });
    var month = String((req.body && req.body.month) || "").trim();
    if (!validMonth(month)) return res.status(400).json({ error: "invalid_month" });
    var mrow = await pool.query("SELECT snapshot FROM company_roster_months WHERE company_id = $1 AND month = $2 AND published_at IS NOT NULL", [me.company_id, month]);
    var has = mrow.rows[0] && (mrow.rows[0].snapshot || []).some((k) => parseInt(k.split("|")[0], 10) === me.id);
    if (!has) return res.status(400).json({ error: "no_shifts", message: "Você não tem plantão publicado neste mês." });
    await pool.query(
      `INSERT INTO company_roster_acks (user_id, company_id, month) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, month) DO UPDATE SET acked_at = now()`, [me.id, me.company_id, month]);
    res.json({ ok: true });
  } catch (err) {
    console.error("Erro no POST /api/me/roster/ack:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// Lembrete para quem ainda nao deu "ciente".
app.post("/api/company/roster/remind", auth, async (req, res) => {
  try {
    var me = await rosterActor(req.userId);
    if (!me || !me.company_id || !isScheduleManager(me.company_role)) return res.status(403).json({ error: "not_allowed", message: "Você não pode lembrar a equipe." });
    var month = String((req.body && req.body.month) || "").trim();
    if (!validMonth(month)) return res.status(400).json({ error: "invalid_month" });
    var mrow = await pool.query("SELECT snapshot FROM company_roster_months WHERE company_id = $1 AND month = $2 AND published_at IS NOT NULL", [me.company_id, month]);
    if (!mrow.rows[0]) return res.status(400).json({ error: "not_published", message: "Publique a escala antes de lembrar a equipe." });
    var ids = {}; (mrow.rows[0].snapshot || []).forEach((k) => { ids[parseInt(k.split("|")[0], 10)] = true; });
    var acked = await pool.query("SELECT user_id FROM company_roster_acks WHERE company_id = $1 AND month = $2", [me.company_id, month]);
    acked.rows.forEach((r) => { delete ids[r.user_id]; });
    var pending = Object.keys(ids).map((u) => parseInt(u, 10));
    var monthName = monthNamePt(month);
    for (var i = 0; i < pending.length; i++) {
      await pool.query("INSERT INTO user_notifications (user_id, company_id, kind, title, body) VALUES ($1, $2, 'roster', $3, $4)",
        [pending[i], me.company_id, "Confirme a sua escala de " + monthName, "Abra \"Escala da equipe\" e toque em \"Estou ciente\" para confirmar que viu os seus plantões."]);
    }
    res.json({ ok: true, reminded: pending.length });
  } catch (err) {
    console.error("Erro no POST /api/company/roster/remind:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

async function swapContext(row) {
  var t = await pool.query("SELECT id, name, start_time, end_time, kind FROM company_shift_types WHERE id = $1", [row.shift_type_id]);
  return t.rows[0] || null;
}
function swapLabel(row, type) {
  return dateLabelPt(row.date) + " · " + (type ? type.name + " (" + type.start_time + "–" + type.end_time + ")" : "turno");
}
async function notifyUsers(companyId, userIds, title, body) {
  for (var i = 0; i < userIds.length; i++) {
    await pool.query("INSERT INTO user_notifications (user_id, company_id, kind, title, body) VALUES ($1, $2, 'swap', $3, $4)", [userIds[i], companyId, title, body]);
  }
}
async function managerIds(companyId, exceptId) {
  var r = await pool.query("SELECT id FROM users WHERE company_id = $1 AND company_role IN ('owner','manager','coordinator') AND id <> $2", [companyId, exceptId || 0]);
  return r.rows.map((x) => x.id);
}
// Mesma regra de "pode fazer este turno" usada ao montar a escala.
async function canTakeShift(companyId, userId, date, type) {
  var u = await pool.query("SELECT id, name, role, company_role FROM users WHERE id = $1 AND company_id = $2", [userId, companyId]);
  var t = u.rows[0];
  if (!t || !(t.company_role === null || t.company_role === "coordinator")) return { ok: false, message: "Essa pessoa não entra na escala de turnos." };
  if (!kindAllows(type.kind, t.role)) return { ok: false, message: t.name + " não pode fazer este turno." };
  var others = await pool.query(
    `SELECT s.name, s.start_time, s.end_time FROM company_roster_entries e JOIN company_shift_types s ON s.id = e.shift_type_id
     WHERE e.company_id = $1 AND e.user_id = $2 AND e.date = $3`, [companyId, userId, date]);
  var ns = timeToMin(type.start_time), ne = timeToMin(type.end_time);
  for (var i = 0; i < others.rows.length; i++) {
    if (ns < timeToMin(others.rows[i].end_time) && timeToMin(others.rows[i].start_time) < ne) return { ok: false, message: t.name + " já está escalado(a) em outro turno nesse horário." };
  }
  return { ok: true, user: t };
}

function swapOut(r, names, types) {
  var t = types[r.shift_type_id];
  return { id: r.id, date: r.date, shiftTypeId: r.shift_type_id, shiftName: t ? t.name : "", startTime: t ? t.start_time : "", endTime: t ? t.end_time : "",
    requesterId: r.requester_id, requesterName: names[r.requester_id] || "", targetId: r.target_id, targetName: r.target_id ? (names[r.target_id] || "") : "",
    note: r.note || "", status: r.status, createdAt: r.created_at, resolvedAt: r.resolved_at };
}
async function swapMaps(companyId) {
  var us = await pool.query("SELECT id, name FROM users WHERE company_id = $1", [companyId]);
  var names = {}; us.rows.forEach((u) => { names[u.id] = u.name; });
  var ts = await pool.query("SELECT id, name, start_time, end_time FROM company_shift_types WHERE company_id = $1", [companyId]);
  var types = {}; ts.rows.forEach((t) => { types[t.id] = t; });
  return { names: names, types: types };
}

// Pedir troca: de um plantao publicado seu, com uma pessoa (ela aceita antes) ou sem substituto.
app.post("/api/me/swaps", auth, async (req, res) => {
  try {
    var me = await rosterActor(req.userId);
    if (!me || !me.company_id) return res.status(403).json({ error: "not_allowed" });
    var b = req.body || {};
    var date = String(b.date || "").trim(), typeId = parseInt(b.shiftTypeId, 10);
    var targetId = b.targetId ? parseInt(b.targetId, 10) : null;
    var note = String(b.note || "").trim().slice(0, 300);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !typeId) return res.status(400).json({ error: "invalid_input" });
    if (date < new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10)) return res.status(400).json({ error: "past", message: "Esse plantão já passou." });
    var month = date.slice(0, 7);
    var mrow = await pool.query("SELECT snapshot FROM company_roster_months WHERE company_id = $1 AND month = $2 AND published_at IS NOT NULL", [me.company_id, month]);
    var key = me.id + "|" + date + "|" + typeId;
    if (!mrow.rows[0] || (mrow.rows[0].snapshot || []).indexOf(key) < 0) return res.status(400).json({ error: "not_yours", message: "Esse plantão não está publicado para você." });
    var type = (await pool.query("SELECT id, name, start_time, end_time, kind FROM company_shift_types WHERE id = $1 AND company_id = $2", [typeId, me.company_id])).rows[0];
    if (!type) return res.status(400).json({ error: "invalid_shift" });
    var dup = await pool.query("SELECT 1 FROM roster_swap_requests WHERE requester_id = $1 AND date = $2 AND shift_type_id = $3 AND status IN ('pending_target','pending_manager')", [me.id, date, typeId]);
    if (dup.rows.length) return res.status(409).json({ error: "duplicate", message: "Você já tem um pedido de troca aberto para esse plantão." });
    var target = null;
    if (targetId) {
      if (targetId === me.id) return res.status(400).json({ error: "invalid_input" });
      var can = await canTakeShift(me.company_id, targetId, date, type);
      if (!can.ok) return res.status(400).json({ error: "target_not_allowed", message: can.message });
      target = can.user;
    }
    var status = target ? "pending_target" : "pending_manager";
    var ins = await pool.query(
      "INSERT INTO roster_swap_requests (company_id, date, shift_type_id, requester_id, target_id, note, status) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
      [me.company_id, date, typeId, me.id, targetId, note || null, status]);
    var label = swapLabel({ date: date }, type);
    if (target) {
      await notifyUsers(me.company_id, [target.id], me.name + " pediu para trocar de plantão com você", label + (note ? "\nMotivo: " + note : "") + "\nAbra \"Escala da equipe\" para aceitar ou recusar.");
    } else {
      await notifyUsers(me.company_id, await managerIds(me.company_id, me.id), me.name + " pediu para sair de um plantão", label + (note ? "\nMotivo: " + note : "") + "\nSem substituto. Veja em \"Escala planejada\" > Pedidos de troca.");
    }
    res.json({ ok: true, id: ins.rows[0].id, status: status });
  } catch (err) {
    console.error("Erro no POST /api/me/swaps:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

app.get("/api/me/swaps", auth, async (req, res) => {
  try {
    var me = await rosterActor(req.userId);
    if (!me || !me.company_id) return res.status(403).json({ error: "not_allowed" });
    var maps = await swapMaps(me.company_id);
    var r = await pool.query(
      `SELECT * FROM roster_swap_requests WHERE company_id = $1 AND (requester_id = $2 OR target_id = $2)
       AND (status IN ('pending_target','pending_manager') OR resolved_at > now() - interval '14 days') ORDER BY created_at DESC LIMIT 40`, [me.company_id, me.id]);
    res.json({ me: me.id, swaps: r.rows.map((x) => swapOut(x, maps.names, maps.types)) });
  } catch (err) {
    console.error("Erro no GET /api/me/swaps:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

app.post("/api/me/swaps/:id/respond", auth, async (req, res) => {
  try {
    var me = await rosterActor(req.userId);
    if (!me || !me.company_id) return res.status(403).json({ error: "not_allowed" });
    var id = parseInt(req.params.id, 10);
    var sw = (await pool.query("SELECT * FROM roster_swap_requests WHERE id = $1 AND company_id = $2", [id, me.company_id])).rows[0];
    if (!sw || sw.target_id !== me.id || sw.status !== "pending_target") return res.status(404).json({ error: "not_found", message: "Pedido não encontrado ou já respondido." });
    var type = await swapContext(sw), label = swapLabel(sw, type);
    var requester = (await pool.query("SELECT name FROM users WHERE id = $1", [sw.requester_id])).rows[0];
    if (req.body && req.body.accept) {
      var can = await canTakeShift(me.company_id, me.id, sw.date, type);
      if (!can.ok) return res.status(400).json({ error: "cannot", message: "Você não pode assumir esse plantão: " + can.message });
      await pool.query("UPDATE roster_swap_requests SET status = 'pending_manager' WHERE id = $1", [id]);
      await notifyUsers(me.company_id, [sw.requester_id], me.name + " aceitou a troca", label + "\nAgora falta a aprovação da coordenação.");
      await notifyUsers(me.company_id, await managerIds(me.company_id, sw.requester_id), "Troca de plantão para aprovar", requester.name + " → " + me.name + "\n" + label + "\nVeja em \"Escala planejada\" > Pedidos de troca.");
      return res.json({ ok: true, status: "pending_manager" });
    }
    await pool.query("UPDATE roster_swap_requests SET status = 'rejected', resolved_at = now(), resolved_by = $2 WHERE id = $1", [id, me.id]);
    await notifyUsers(me.company_id, [sw.requester_id], me.name + " recusou a troca", label + "\nVocê continua escalado(a) nesse plantão. Tente outra pessoa ou fale com a coordenação.");
    res.json({ ok: true, status: "rejected" });
  } catch (err) {
    console.error("Erro no POST /api/me/swaps/:id/respond:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

app.post("/api/me/swaps/:id/cancel", auth, async (req, res) => {
  try {
    var id = parseInt(req.params.id, 10);
    var r = await pool.query(
      "UPDATE roster_swap_requests SET status = 'cancelled', resolved_at = now(), resolved_by = $2 WHERE id = $1 AND requester_id = $2 AND status IN ('pending_target','pending_manager') RETURNING id", [id, req.userId]);
    if (r.rows.length === 0) return res.status(404).json({ error: "not_found", message: "Pedido não encontrado ou já resolvido." });
    res.json({ ok: true });
  } catch (err) {
    console.error("Erro no POST /api/me/swaps/:id/cancel:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// Fila de aprovacao (coordenacao/gerencia/dono; socio so ve).
app.get("/api/company/swaps", auth, async (req, res) => {
  try {
    var me = await rosterActor(req.userId);
    if (!me || !me.company_id || !isScheduleViewer(me.company_role)) return res.status(403).json({ error: "not_allowed" });
    var maps = await swapMaps(me.company_id);
    var r = await pool.query(
      `SELECT * FROM roster_swap_requests WHERE company_id = $1 AND (status = 'pending_manager' OR (status IN ('approved','rejected') AND resolved_at > now() - interval '14 days'))
       ORDER BY (status = 'pending_manager') DESC, created_at DESC LIMIT 40`, [me.company_id]);
    res.json({ canDecide: isScheduleManager(me.company_role), me: me.id, swaps: r.rows.map((x) => swapOut(x, maps.names, maps.types)) });
  } catch (err) {
    console.error("Erro no GET /api/company/swaps:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

app.post("/api/company/swaps/:id/decide", auth, async (req, res) => {
  try {
    var me = await rosterActor(req.userId);
    if (!me || !me.company_id || !isScheduleManager(me.company_role)) return res.status(403).json({ error: "not_allowed", message: "Você não pode decidir trocas." });
    var id = parseInt(req.params.id, 10);
    var sw = (await pool.query("SELECT * FROM roster_swap_requests WHERE id = $1 AND company_id = $2", [id, me.company_id])).rows[0];
    if (!sw || sw.status !== "pending_manager") return res.status(404).json({ error: "not_found", message: "Pedido não encontrado ou já decidido." });
    if (sw.requester_id === me.id) return res.status(403).json({ error: "self", message: "Você não pode aprovar o seu próprio pedido: outra pessoa da gestão decide." });
    var type = await swapContext(sw), label = swapLabel(sw, type);
    var maps = await swapMaps(me.company_id);
    var who = (maps.names[sw.requester_id] || "") + (sw.target_id ? " → " + (maps.names[sw.target_id] || "") : " (sem substituto)");
    var month = sw.date.slice(0, 7);
    if (!(req.body && req.body.approve)) {
      await pool.query("UPDATE roster_swap_requests SET status = 'rejected', resolved_at = now(), resolved_by = $2 WHERE id = $1", [id, me.id]);
      await notifyUsers(me.company_id, [sw.requester_id].concat(sw.target_id ? [sw.target_id] : []), "Troca de plantão recusada", label + "\nA escala continua como estava (" + (maps.names[sw.requester_id] || "") + " no plantão).");
      await audit(me.company_id, me.id, "swap_rejected", sw.requester_id, maps.names[sw.requester_id], label);
      return res.json({ ok: true, status: "rejected" });
    }
    // aprovar: troca quem faz o plantao (ou deixa o turno vago)
    if (sw.target_id) {
      var can = await canTakeShift(me.company_id, sw.target_id, sw.date, type);
      if (!can.ok) return res.status(400).json({ error: "cannot", message: "Não dá para aprovar: " + can.message });
    }
    var cur = await pool.query("SELECT id FROM company_roster_entries WHERE company_id = $1 AND date = $2 AND shift_type_id = $3 AND user_id = $4", [me.company_id, sw.date, sw.shift_type_id, sw.requester_id]);
    if (cur.rows.length === 0) return res.status(409).json({ error: "changed", message: "A escala mudou: esse plantão já não é mais dessa pessoa." });
    if (sw.target_id) await pool.query("UPDATE company_roster_entries SET user_id = $2 WHERE id = $1", [cur.rows[0].id, sw.target_id]);
    else await pool.query("DELETE FROM company_roster_entries WHERE id = $1", [cur.rows[0].id]);
    // a escala ja publicada acompanha a troca, e o novo responsavel precisa dar ciente
    var mrow = await pool.query("SELECT snapshot FROM company_roster_months WHERE company_id = $1 AND month = $2 AND published_at IS NOT NULL", [me.company_id, month]);
    if (mrow.rows[0]) {
      var oldKey = sw.requester_id + "|" + sw.date + "|" + sw.shift_type_id;
      var snap = (mrow.rows[0].snapshot || []).filter((k) => k !== oldKey);
      if (sw.target_id) snap.push(sw.target_id + "|" + sw.date + "|" + sw.shift_type_id);
      await pool.query("UPDATE company_roster_months SET snapshot = $3::jsonb WHERE company_id = $1 AND month = $2", [me.company_id, month, JSON.stringify(snap.sort())]);
    }
    if (sw.target_id) await pool.query("DELETE FROM company_roster_acks WHERE user_id = $1 AND month = $2", [sw.target_id, month]);
    await pool.query("UPDATE roster_swap_requests SET status = 'approved', resolved_at = now(), resolved_by = $2 WHERE id = $1", [id, me.id]);
    await notifyUsers(me.company_id, [sw.requester_id], "Troca de plantão aprovada", label + "\nVocê saiu desse plantão.");
    if (sw.target_id) await notifyUsers(me.company_id, [sw.target_id], "Você assumiu um plantão", label + "\nConfirme em \"Escala da equipe\" com \"Estou ciente\".");
    await audit(me.company_id, me.id, "swap_approved", sw.requester_id, maps.names[sw.requester_id], label + " · " + who);
    res.json({ ok: true, status: "approved" });
  } catch (err) {
    console.error("Erro no POST /api/company/swaps/:id/decide:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// Avisos da pessoa logada.
app.get("/api/me/notifications", auth, async (req, res) => {
  try {
    var r = await pool.query(
      "SELECT id, kind, title, body, created_at, read_at FROM user_notifications WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 30",
      [req.userId]
    );
    var unread = await pool.query("SELECT COUNT(*)::int AS n FROM user_notifications WHERE user_id = $1 AND read_at IS NULL", [req.userId]);
    res.json({
      unread: unread.rows[0].n,
      items: r.rows.map((n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body || "", createdAt: n.created_at, read: !!n.read_at })),
    });
  } catch (err) {
    console.error("Erro no GET /api/me/notifications:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

app.post("/api/me/notifications/read", auth, async (req, res) => {
  try {
    await pool.query("UPDATE user_notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL", [req.userId]);
    res.json({ ok: true });
  } catch (err) {
    console.error("Erro no POST /api/me/notifications/read:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// Escala da equipe (pensada sobretudo pra fim de semana/feriado, onde a
// escala muda toda semana): quem trabalhou, faltou ou foi coberto em cada
// dia. Dono e coordenador(a) editam; socio(a) so acompanha (leitura).
app.get("/api/company/schedule", auth, async (req, res) => {
  try {
    var me = await pool.query("SELECT company_id, company_role FROM users WHERE id = $1", [req.userId]);
    if (me.rows.length === 0) return res.status(404).json({ error: "not_found" });
    var role = me.rows[0].company_role;
    if (!isScheduleViewer(role) || !me.rows[0].company_id) {
      return res.status(403).json({ error: "not_allowed", message: "Você não tem acesso à escala da equipe." });
    }
    var companyId = me.rows[0].company_id;
    var monthKey = String(req.query.month || "").trim();
    if (!/^\d{4}-\d{2}$/.test(monthKey)) {
      return res.status(400).json({ error: "invalid_month" });
    }
    var staffRes = await pool.query(
      `SELECT u.id, u.name, u.role, u.email, u.company_role, us.data AS state_data
       FROM users u
       LEFT JOIN user_state us ON us.user_id = u.id
       WHERE u.company_id = $1 AND (u.company_role IS NULL OR u.company_role = 'coordinator')
       ORDER BY u.name ASC`,
      [companyId]
    );
    var entriesRes = await pool.query(
      `SELECT id, user_id, date, status, note, covered_by_user_id
       FROM company_schedule
       WHERE company_id = $1 AND date LIKE $2`,
      [companyId, monthKey + "-%"]
    );
    res.json({
      canManage: isScheduleManager(role),
      // Distinto de canManage: gerente/coordenador editam o horario semanal
      // fixo de cada profissional (grade), enquanto dono/socio(a) so
      // acompanham essa parte pra nao correr o risco de mudar sem querer —
      // eles continuam podendo lancar/editar a escala de fim de semana acima.
      canEditStaffSchedule: isStaffScheduleEditor(role),
      staff: staffRes.rows.map((row) => {
        var settings = (row.state_data && row.state_data.settings) || {};
        var timeSlots = Array.isArray(settings.timeSlots) ? settings.timeSlots : [];
        var shiftStart = null;
        var shiftEnd = null;
        if (timeSlots.length) {
          shiftStart = String(timeSlots[0]).split("–")[0] || null;
          shiftEnd = String(timeSlots[timeSlots.length - 1]).split("–")[1] || null;
        }
        return {
          id: row.id,
          name: row.name,
          role: row.role || "",
          email: row.email,
          companyRole: row.company_role || null,
          shiftStart: shiftStart,
          shiftEnd: shiftEnd,
          weekendShiftEnabled: !!settings.weekendShiftEnabled,
        };
      }),
      entries: entriesRes.rows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        date: row.date,
        status: row.status,
        note: row.note || "",
        coveredByUserId: row.covered_by_user_id || null,
      })),
    });
  } catch (err) {
    console.error("Erro no GET /api/company/schedule:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

app.post("/api/company/schedule", auth, async (req, res) => {
  var body = req.body || {};
  var userId = parseInt(body.userId, 10);
  var date = String(body.date || "").trim();
  var status = String(body.status || "").trim();
  var note = String(body.note || "").trim();
  var coveredByUserId = body.coveredByUserId ? parseInt(body.coveredByUserId, 10) : null;
  if (!userId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || ["trabalhou", "falta", "coberto"].indexOf(status) === -1) {
    return res.status(400).json({ error: "invalid_input" });
  }
  try {
    var me = await pool.query("SELECT company_id, company_role FROM users WHERE id = $1", [req.userId]);
    if (me.rows.length === 0) return res.status(404).json({ error: "not_found" });
    var role = me.rows[0].company_role;
    if (!isScheduleManager(role) || !me.rows[0].company_id) {
      return res.status(403).json({ error: "not_allowed", message: "Você não pode editar a escala da equipe." });
    }
    var companyId = me.rows[0].company_id;
    var target = await pool.query("SELECT u.id FROM users u WHERE u.id = $1 AND u.company_id = $2", [userId, companyId]);
    if (target.rows.length === 0) return res.status(400).json({ error: "invalid_user" });
    var result = await pool.query(
      `INSERT INTO company_schedule (company_id, user_id, date, status, note, covered_by_user_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, date) DO UPDATE SET status = $4, note = $5, covered_by_user_id = $6, updated_at = now()
       RETURNING id`,
      [companyId, userId, date, status, note || null, status === "coberto" ? coveredByUserId : null, req.userId]
    );
    res.json({ ok: true, id: result.rows[0].id });
  } catch (err) {
    console.error("Erro no POST /api/company/schedule:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

app.delete("/api/company/schedule/:id", auth, async (req, res) => {
  try {
    var me = await pool.query("SELECT company_id, company_role FROM users WHERE id = $1", [req.userId]);
    if (me.rows.length === 0) return res.status(404).json({ error: "not_found" });
    var role = me.rows[0].company_role;
    if (!isScheduleManager(role) || !me.rows[0].company_id) {
      return res.status(403).json({ error: "not_allowed" });
    }
    await pool.query(
      "DELETE FROM company_schedule WHERE id = $1 AND company_id = $2",
      [req.params.id, me.rows[0].company_id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("Erro no DELETE /api/company/schedule/:id:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

app.post("/api/change-password", auth, limitChangePassword, async (req, res) => {
  var body = req.body || {};
  var currentPassword = String(body.currentPassword || "");
  var newPassword = String(body.newPassword || "");
  if (newPassword.length < 6) {
    return res.status(400).json({ error: "weak_password", message: "A nova senha precisa ter pelo menos 6 caracteres." });
  }
  try {
    var result = await pool.query("SELECT password_hash FROM users WHERE id = $1", [req.userId]);
    if (result.rows.length === 0) return res.status(404).json({ error: "not_found" });
    var ok = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: "wrong_password", message: "Senha atual incorreta." });
    var hash = await bcrypt.hash(newPassword, 10);
    var updated = await pool.query(
      "UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2 RETURNING id, token_version",
      [hash, req.userId]
    );
    // As outras sessoes (outros aparelhos) caem; esta recebe um token novo.
    res.json({ ok: true, token: signToken(updated.rows[0]) });
  } catch (err) {
    console.error("Erro no /api/change-password:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

app.post("/api/forgot-password", limitForgotIp, limitForgotEmail, async (req, res) => {
  var body = req.body || {};
  var email = String(body.email || "").trim().toLowerCase();
  if (!email) {
    return res.status(400).json({ error: "invalid_input", message: "Informe o e-mail." });
  }
  if (!mailer) {
    return res.status(503).json({
      error: "email_not_configured",
      message: "A redefinição de senha por e-mail ainda não está configurada. Peça pra quem administra o sistema resetar sua senha.",
    });
  }
  try {
    var result = await pool.query("SELECT id, name, email FROM users WHERE email = $1", [email]);
    if (result.rows.length > 0) {
      var user = result.rows[0];
      var token = crypto.randomBytes(32).toString("hex");
      var tokenHash = hashToken(token);
      var expires = new Date(Date.now() + RESET_TOKEN_TTL_MS);
      await pool.query(
        "UPDATE users SET reset_token_hash = $1, reset_token_expires = $2 WHERE id = $3",
        [tokenHash, expires, user.id]
      );
      var link = APP_URL.replace(/\/+$/, "") + "/?reset=" + token;
      try {
        await sendResetEmail(user, link);
      } catch (mailErr) {
        console.error("Falha ao enviar e-mail de redefinição:", mailErr);
      }
    }
    // Mesma resposta exista ou nao a conta, pra nao dar pra descobrir quais
    // e-mails estao cadastrados so tentando "esqueci minha senha".
    res.json({ ok: true, message: "Se esse e-mail tiver uma conta, enviamos um link de redefinição de senha." });
  } catch (err) {
    console.error("Erro no /api/forgot-password:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

app.post("/api/reset-password", limitReset, async (req, res) => {
  var body = req.body || {};
  var token = String(body.token || "");
  var newPassword = String(body.newPassword || "");
  if (!token) {
    return res.status(400).json({ error: "invalid_input", message: "Link inválido." });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: "weak_password", message: "A nova senha precisa ter pelo menos 6 caracteres." });
  }
  try {
    var tokenHash = hashToken(token);
    var result = await pool.query(
      "SELECT id FROM users WHERE reset_token_hash = $1 AND reset_token_expires > now()",
      [tokenHash]
    );
    if (result.rows.length === 0) {
      return res.status(400).json({ error: "invalid_or_expired_token", message: "Esse link é inválido ou já expirou. Peça um novo em \"Esqueci minha senha\"." });
    }
    var userId = result.rows[0].id;
    var hash = await bcrypt.hash(newPassword, 10);
    await pool.query(
      "UPDATE users SET password_hash = $1, reset_token_hash = NULL, reset_token_expires = NULL, token_version = token_version + 1 WHERE id = $2",
      [hash, userId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("Erro no /api/reset-password:", err);
    res.status(500).json({ error: "internal_error" });
  }
});


// ---------- Fechamento do mes ----------
// Quem confere e fecha: dono, gerente e coordenador(a). Quem reabre: dono e
// gerente. Socio(a) so acompanha. Valores em R$ so aparecem para dono, gerente e
// socio(a) — o coordenador ve horas, nunca dinheiro.
function canCloseMonth(role) { return role === "owner" || role === "manager" || role === "coordinator"; }
function canReopenMonth(role) { return role === "owner" || role === "manager"; }
function seesClosingValues(role) { return role === "owner" || role === "manager" || role === "partner"; }

function currentMonthBr() {
  var d = new Date(Date.now() - 3 * 3600 * 1000); // horario de Brasilia, aproximado
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
}

// Mesma conta da grade do app: soma dos valores dos horarios + auxilio - consumo.
function gradeSummary(stateData, month) {
  var m = stateData && stateData.months && stateData.months[month];
  if (!m || typeof m !== "object") return { hours: 0, total: 0, month: null };
  var ts = stateData.settings && stateData.settings.timeSlots;
  var n = Array.isArray(ts) && ts.length ? ts.length : 6;
  var sum = 0, hours = 0;
  Object.keys(m.days || {}).forEach(function (k) {
    var d = m.days[k];
    if (!d || !Array.isArray(d.slots)) return;
    for (var i = 0; i < n; i++) {
      if (typeof d.slots[i] === "number") { sum += d.slots[i]; if (d.slots[i] > 0) hours++; }
    }
  });
  return { hours: hours, total: sum + (Number(m.auxilio) || 0) - (Number(m.consumo) || 0), month: m };
}

// So o que muda dinheiro: valores de cada horario, turno do dia, auxilio e consumo.
// (observacoes e o "marcar como pago" continuam livres.)
function monthCore(m) {
  var days = {};
  Object.keys((m && m.days) || {}).sort().forEach(function (k) {
    var d = m.days[k] || {};
    var slots = Array.isArray(d.slots) ? d.slots.map(function (v) { return v === "" || v === undefined ? null : v; }) : [];
    var shift = d.shift === undefined ? null : d.shift;
    if (shift === null && slots.every(function (v) { return v === null; })) return;
    days[k] = { slots: slots, shift: shift };
  });
  return JSON.stringify({ days: days, auxilio: Number(m && m.auxilio) || 0, consumo: Number(m && m.consumo) || 0 });
}

// Antes de gravar o estado de alguem: se algum mes dele esta fechado, devolve a
// versao fechada (menos o "pago"). Retorna true se precisou corrigir.
async function applyClosedMonths(userId, payload) {
  var r = await pool.query(
    `SELECT c.month, c.snapshot FROM company_month_closings c
     JOIN users u ON u.id = c.user_id AND u.company_id = c.company_id WHERE c.user_id = $1`, [userId]);
  if (r.rows.length === 0) return false;
  if (!payload.months || typeof payload.months !== "object") payload.months = {};
  var overridden = false;
  r.rows.forEach(function (row) {
    var cur = payload.months[row.month];
    if (cur && monthCore(cur) === monthCore(row.snapshot)) return;
    var paid = cur && typeof cur.paid === "boolean" ? cur.paid : !!row.snapshot.paid;
    payload.months[row.month] = Object.assign({}, row.snapshot, { paid: paid });
    overridden = true;
  });
  return overridden;
}

function closingMembers(companyId) {
  return pool.query(
    `SELECT u.id, u.name, u.role, u.company_role, us.data
     FROM users u LEFT JOIN user_state us ON us.user_id = u.id
     WHERE u.company_id = $1 AND (u.company_role IS NULL OR u.company_role = 'coordinator')
     ORDER BY u.name ASC`, [companyId]);
}

app.get("/api/company/closings", auth, async (req, res) => {
  try {
    var me = await rosterActor(req.userId);
    if (!me || !me.company_id || !isScheduleViewer(me.company_role)) {
      return res.status(403).json({ error: "not_allowed", message: "Você não tem acesso ao fechamento do mês." });
    }
    var month = String(req.query.month || "").trim();
    if (!validMonth(month)) return res.status(400).json({ error: "invalid_month" });
    var values = seesClosingValues(me.company_role);
    var members = await closingMembers(me.company_id);
    var closed = await pool.query(
      `SELECT c.user_id, c.closed_at, c.hours, c.total, b.name AS closed_by_name
       FROM company_month_closings c LEFT JOIN users b ON b.id = c.closed_by
       WHERE c.company_id = $1 AND c.month = $2`, [me.company_id, month]);
    var byUser = {}; closed.rows.forEach(function (c) { byUser[c.user_id] = c; });
    res.json({
      canClose: canCloseMonth(me.company_role),
      canReopen: canReopenMonth(me.company_role),
      showValues: values,
      myId: req.userId,
      isCurrentOrFuture: month >= currentMonthBr(),
      isFuture: month > currentMonthBr(),
      members: members.rows.map(function (u) {
        var c = byUser[u.id];
        var live = gradeSummary(u.data, month);
        var out = {
          id: u.id, name: u.name, role: u.role || "", companyRole: u.company_role || null,
          status: c ? "closed" : "open",
          hours: c ? c.hours : live.hours,
          closedAt: c ? c.closed_at : null,
          closedByName: c ? c.closed_by_name : null,
          hasData: !!live.month || !!c,
        };
        if (values) out.total = c ? Number(c.total) : live.total;
        return out;
      }),
    });
  } catch (err) {
    console.error("Erro no GET /api/company/closings:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

app.post("/api/company/closings", auth, async (req, res) => {
  try {
    var me = await rosterActor(req.userId);
    if (!me || !me.company_id || !canCloseMonth(me.company_role)) {
      return res.status(403).json({ error: "not_allowed", message: "Só dono, gerente e coordenador(a) fecham o mês." });
    }
    var body = req.body || {};
    var month = String(body.month || "").trim();
    if (!validMonth(month)) return res.status(400).json({ error: "invalid_month" });
    if (month > currentMonthBr()) return res.status(400).json({ error: "future_month", message: "Esse mês ainda não começou, não dá para fechar." });
    var members = (await closingMembers(me.company_id)).rows;
    var ids = Array.isArray(body.userIds) ? body.userIds.map(function (x) { return parseInt(x, 10); }) : null;
    var already = await pool.query("SELECT user_id FROM company_month_closings WHERE company_id = $1 AND month = $2", [me.company_id, month]);
    var isClosed = {}; already.rows.forEach(function (r) { isClosed[r.user_id] = true; });
    var targets = members.filter(function (u) {
      if (isClosed[u.id]) return false;
      if (ids && ids.indexOf(u.id) < 0) return false;
      if (me.company_role === "coordinator" && u.id === me.id) return false; // ninguem fecha o proprio mes sozinho
      return !!gradeSummary(u.data, month).month; // sem horas lancadas nao ha o que fechar
    });
    var monthName = monthNamePt(month), closedNames = [];
    for (var i = 0; i < targets.length; i++) {
      var u = targets[i], sum = gradeSummary(u.data, month);
      await pool.query(
        `INSERT INTO company_month_closings (company_id, user_id, month, closed_by, snapshot, hours, total)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (user_id, month) DO NOTHING`,
        [me.company_id, u.id, month, me.id, sum.month, sum.hours, sum.total]);
      await pool.query(
        "INSERT INTO user_notifications (user_id, company_id, kind, title, body) VALUES ($1, $2, 'closing', $3, $4)",
        [u.id, me.company_id, "Seu mês de " + monthName + " foi fechado", "Conferido por " + me.name + ". As horas desse mês não podem mais ser alteradas. Se algo estiver errado, fale com a gerência para reabrir."]);
      closedNames.push(u.name);
    }
    if (targets.length) {
      await audit(me.company_id, me.id, "month_closed", targets.length === 1 ? targets[0].id : null,
        targets.length === 1 ? targets[0].name : null, monthName + " · " + targets.length + " pessoa(s)");
    }
    res.json({ ok: true, closed: targets.length, names: closedNames });
  } catch (err) {
    console.error("Erro no POST /api/company/closings:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

app.delete("/api/company/closings/:userId/:month", auth, async (req, res) => {
  try {
    var me = await rosterActor(req.userId);
    if (!me || !me.company_id || !canReopenMonth(me.company_role)) {
      return res.status(403).json({ error: "not_allowed", message: "Só o dono ou o gerente podem reabrir um mês fechado." });
    }
    var uid = parseInt(req.params.userId, 10), month = String(req.params.month || "");
    if (!uid || !validMonth(month)) return res.status(400).json({ error: "invalid_input" });
    var del = await pool.query(
      `DELETE FROM company_month_closings WHERE company_id = $1 AND user_id = $2 AND month = $3 RETURNING user_id`,
      [me.company_id, uid, month]);
    if (del.rows.length === 0) return res.status(404).json({ error: "not_found" });
    var tu = await pool.query("SELECT name FROM users WHERE id = $1", [uid]);
    var monthName = monthNamePt(month);
    await pool.query(
      "INSERT INTO user_notifications (user_id, company_id, kind, title, body) VALUES ($1, $2, 'closing', $3, $4)",
      [uid, me.company_id, "Seu mês de " + monthName + " foi reaberto", me.name + " reabriu o mês para ajustes. Você será avisado(a) quando for fechado de novo."]);
    await audit(me.company_id, me.id, "month_reopened", uid, tu.rows[0] ? tu.rows[0].name : null, monthName);
    res.json({ ok: true });
  } catch (err) {
    console.error("Erro no DELETE /api/company/closings:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// Os meses fechados da propria pessoa (o app trava a edicao deles).
app.get("/api/me/closings", auth, async (req, res) => {
  try {
    var r = await pool.query(
      `SELECT c.month, c.closed_at, b.name AS closed_by_name
       FROM company_month_closings c
       JOIN users u ON u.id = c.user_id AND u.company_id = c.company_id
       LEFT JOIN users b ON b.id = c.closed_by
       WHERE c.user_id = $1 ORDER BY c.month DESC`, [req.userId]);
    res.json({ closings: r.rows.map(function (x) { return { month: x.month, closedAt: x.closed_at, closedByName: x.closed_by_name }; }) });
  } catch (err) {
    console.error("Erro no GET /api/me/closings:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

app.get("/api/state", auth, async (req, res) => {
  try {
    var result = await pool.query("SELECT data, updated_at FROM user_state WHERE user_id = $1", [req.userId]);
    if (result.rows.length === 0) {
      return res.json({ data: null, updated_at: null });
    }
    res.json({ data: result.rows[0].data, updated_at: result.rows[0].updated_at });
  } catch (err) {
    console.error("Erro no GET /api/state:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// Salvar com controle de versao: o app manda no header X-Base-Version o
// "updated_at" que ele viu por ultimo (ou "none" se o servidor ainda nao tinha
// nada). Se o servidor mudou desde entao (outro aparelho salvou, ou a gerencia
// editou o horario), a gravacao e recusada com 409 e devolve a versao atual —
// assim nenhum aparelho sobrescreve em silencio o que outro salvou. Sem o
// header (app antigo em cache) mantem o comportamento de antes.
app.put("/api/state", auth, async (req, res) => {
  var payload = req.body;
  if (!payload || typeof payload !== "object") {
    return res.status(400).json({ error: "invalid_body" });
  }
  var base = req.header("x-base-version");
  try {
    var overridden = await applyClosedMonths(req.userId, payload);
    var result;
    if (!base) {
      result = await pool.query(
        `INSERT INTO user_state (user_id, data, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (user_id) DO UPDATE SET data = $2, updated_at = now()
         RETURNING updated_at`,
        [req.userId, payload]
      );
    } else if (base === "none") {
      result = await pool.query(
        `INSERT INTO user_state (user_id, data, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (user_id) DO NOTHING
         RETURNING updated_at`,
        [req.userId, payload]
      );
    } else {
      if (isNaN(new Date(base).getTime())) {
        return res.status(400).json({ error: "invalid_base_version" });
      }
      result = await pool.query(
        `UPDATE user_state SET data = $2, updated_at = now()
         WHERE user_id = $1 AND date_trunc('milliseconds', updated_at) = $3::timestamptz
         RETURNING updated_at`,
        [req.userId, payload, base]
      );
    }
    if (result.rows.length === 0) {
      var current = await pool.query("SELECT data, updated_at FROM user_state WHERE user_id = $1", [req.userId]);
      return res.status(409).json({
        error: "version_conflict",
        data: current.rows[0] ? current.rows[0].data : null,
        updated_at: current.rows[0] ? current.rows[0].updated_at : null,
      });
    }
    res.json({ ok: true, updated_at: result.rows[0].updated_at, overridden: overridden });
  } catch (err) {
    console.error("Erro no PUT /api/state:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

ensureTables()
  .then(() => {
    app.listen(PORT, () => {
      console.log("Ponto Overall server (com login) rodando na porta " + PORT);
    });
  })
  .catch((err) => {
    console.error("Falha ao preparar o banco:", err);
    process.exit(1);
  });

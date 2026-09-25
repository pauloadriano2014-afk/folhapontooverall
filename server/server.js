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
//
//   GET  /health      -> healthcheck simples
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
  ssl: { rejectUnauthorized: false },
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
      "<p>Oi, " + user.name + "!</p>" +
      "<p>Recebemos um pedido para redefinir sua senha do <strong>Ponto Overall</strong>.</p>" +
      "<p><a href=\"" + link + "\" style=\"background:#a855f7;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;\">Escolher nova senha</a></p>" +
      "<p>Ou copie e cole este link no navegador (vale por 1 hora):<br>" + link + "</p>" +
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
      "<p>Oi, " + name + "!</p>" +
      "<p><strong>" + companyName + "</strong> te convidou pra usar o <strong>Ponto Overall</strong>.</p>" +
      "<p><a href=\"" + link + "\" style=\"background:#a855f7;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;\">Completar cadastro</a></p>" +
      "<p>Ou copie e cole este link no navegador:<br>" + link + "</p>" +
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

const app = express();
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
  };
}

function signToken(row) {
  return jwt.sign({ uid: row.id }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

function auth(req, res, next) {
  var header = req.header("authorization") || "";
  var token = header.indexOf("Bearer ") === 0 ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "no_token" });
  try {
    var payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.uid;
    next();
  } catch (e) {
    return res.status(401).json({ error: "invalid_token" });
  }
}

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.post("/api/register", async (req, res) => {
  var body = req.body || {};
  var accountType = String(body.accountType || "profissional").trim(); // "profissional" (padrao, compativel com o app antigo) ou "empresa"
  var name = String(body.name || "").trim();
  var role = String(body.role || "").trim();
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
        "SELECT id, company_id, shift_start, shift_end, weekend_shift, access_role FROM company_invites WHERE token = $1 AND used_at IS NULL",
        [inviteToken]
      );
      if (inviteLookup.rows.length === 0) {
        return res.status(400).json({ error: "invite_token_invalid", message: "Esse link de convite não é mais válido. Peça um novo pra academia." });
      }
      inviteRow = inviteLookup.rows[0];
      invitedCompany = { id: inviteRow.company_id };
    } else if (accountType !== "empresa" && inviteCode) {
      var companyLookup = await pool.query("SELECT id, name FROM companies WHERE invite_code = $1", [inviteCode]);
      if (companyLookup.rows.length === 0) {
        return res.status(400).json({ error: "invite_code_invalid", message: "Código de convite inválido. Confira com a academia." });
      }
      invitedCompany = companyLookup.rows[0];
    }

    var hash = await bcrypt.hash(password, 10);
    var result = await pool.query(
      "INSERT INTO users (name, role, email, password_hash, company_id) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, role, email, company_id, company_role",
      [name, role, email, hash, invitedCompany ? invitedCompany.id : null]
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

app.post("/api/login", async (req, res) => {
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
    var result = await pool.query("SELECT id, name, role, email, company_id, company_role FROM users WHERE id = $1", [req.userId]);
    if (result.rows.length === 0) return res.status(404).json({ error: "not_found" });
    res.json({ user: publicUser(result.rows[0]) });
  } catch (err) {
    console.error("Erro no /api/me:", err);
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
      `SELECT u.id, u.name, u.role, u.email, u.company_role, s.data
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
        var staffData = row.data || null;
        if (staffData && myRole === "manager") {
          staffData = Object.assign({}, staffData, { clients: [] });
        }
        return {
          id: row.id,
          name: row.name,
          role: row.role || "",
          email: row.email,
          isOwner: row.company_role === "owner",
          companyRole: row.company_role || null,
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
app.post("/api/company/invite", auth, async (req, res) => {
  var body = req.body || {};
  var name = String(body.name || "").trim();
  var email = String(body.email || "").trim().toLowerCase();
  var role = String(body.role || "").trim();
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
  try {
    var me = await pool.query("SELECT company_id, company_role FROM users WHERE id = $1", [req.userId]);
    if (me.rows.length === 0) return res.status(404).json({ error: "not_found" });
    if (!isCompanyManager(me.rows[0].company_role) || !me.rows[0].company_id) {
      return res.status(403).json({ error: "not_owner", message: "Só o dono ou o(a) gerente da academia podem convidar." });
    }
    var companyId = me.rows[0].company_id;
    var companyRow = await pool.query("SELECT name FROM companies WHERE id = $1", [companyId]);
    var companyName = companyRow.rows[0] ? companyRow.rows[0].name : "sua academia";
    var token = randomInviteToken();
    await pool.query(
      `INSERT INTO company_invites (company_id, token, name, role, email, shift_start, shift_end, weekend_shift, access_role)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [companyId, token, name, role, email, shiftStart || null, shiftEnd || null, weekendShift, accessRole]
    );
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
    await pool.query(
      "DELETE FROM company_invites WHERE id = $1 AND company_id = $2 AND used_at IS NULL",
      [req.params.id, me.rows[0].company_id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("Erro no DELETE /api/company/invite/:id:", err);
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
      `SELECT id, name, role, company_role FROM users
       WHERE company_id = $1 AND (company_role IS NULL OR company_role = 'coordinator')
       ORDER BY name ASC`,
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
      staff: staffRes.rows.map((row) => ({ id: row.id, name: row.name, role: row.role || "", companyRole: row.company_role || null })),
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
    var target = await pool.query("SELECT id FROM users WHERE id = $1 AND company_id = $2", [userId, companyId]);
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

app.post("/api/change-password", auth, async (req, res) => {
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
    await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [hash, req.userId]);
    res.json({ ok: true });
  } catch (err) {
    console.error("Erro no /api/change-password:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

app.post("/api/forgot-password", async (req, res) => {
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

app.post("/api/reset-password", async (req, res) => {
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
      "UPDATE users SET password_hash = $1, reset_token_hash = NULL, reset_token_expires = NULL WHERE id = $2",
      [hash, userId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("Erro no /api/reset-password:", err);
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

app.put("/api/state", auth, async (req, res) => {
  var payload = req.body;
  if (!payload || typeof payload !== "object") {
    return res.status(400).json({ error: "invalid_body" });
  }
  try {
    var result = await pool.query(
      `INSERT INTO user_state (user_id, data, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (user_id) DO UPDATE SET data = $2, updated_at = now()
       RETURNING updated_at`,
      [req.userId, payload]
    );
    res.json({ ok: true, updated_at: result.rows[0].updated_at });
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

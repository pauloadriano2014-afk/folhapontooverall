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
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

function publicUser(row) {
  return { id: row.id, name: row.name, role: row.role || "", email: row.email };
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
  var name = String(body.name || "").trim();
  var role = String(body.role || "").trim();
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

  try {
    var existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "email_in_use", message: "Já existe uma conta com esse e-mail." });
    }
    var hash = await bcrypt.hash(password, 10);
    var result = await pool.query(
      "INSERT INTO users (name, role, email, password_hash) VALUES ($1, $2, $3, $4) RETURNING id, name, role, email",
      [name, role, email, hash]
    );
    var user = result.rows[0];
    res.json({ token: signToken(user), user: publicUser(user) });
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
    var result = await pool.query("SELECT id, name, role, email FROM users WHERE id = $1", [req.userId]);
    if (result.rows.length === 0) return res.status(404).json({ error: "not_found" });
    res.json({ user: publicUser(result.rows[0]) });
  } catch (err) {
    console.error("Erro no /api/me:", err);
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

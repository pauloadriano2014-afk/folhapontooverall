// Backend minimo para o Ponto Overall.
// Guarda um unico blob JSON (a mesma estrutura que o app ja usa no localStorage)
// numa tabela do Neon Postgres, para sincronizar entre aparelhos.
//
// Rotas:
//   GET  /api/state   -> devolve o JSON salvo (ou {} se nunca foi salvo)
//   PUT  /api/state   -> substitui o JSON salvo pelo corpo da requisicao
//   GET  /health      -> healthcheck simples
//
// Autenticacao: header "x-api-key" precisa bater com API_KEY (variavel de ambiente).
// E uma protecao simples (nao e nivel bancario), suficiente para um app pessoal.

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;
const DATABASE_URL = process.env.DATABASE_URL;
const STATE_ID = "ponto-overall";

if (!DATABASE_URL) {
  console.error("Faltando variavel de ambiente DATABASE_URL");
  process.exit(1);
}
if (!API_KEY) {
  console.error("Faltando variavel de ambiente API_KEY");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function ensureTable() {
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

function checkApiKey(req, res, next) {
  const key = req.header("x-api-key");
  if (key !== API_KEY) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/state", checkApiKey, async (req, res) => {
  try {
    const result = await pool.query("SELECT data, updated_at FROM app_state WHERE id = $1", [STATE_ID]);
    if (result.rows.length === 0) {
      return res.json({ data: null, updated_at: null });
    }
    res.json({ data: result.rows[0].data, updated_at: result.rows[0].updated_at });
  } catch (err) {
    console.error("Erro no GET /api/state:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

app.put("/api/state", checkApiKey, async (req, res) => {
  const payload = req.body;
  if (!payload || typeof payload !== "object") {
    return res.status(400).json({ error: "invalid_body" });
  }
  try {
    const result = await pool.query(
      `INSERT INTO app_state (id, data, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = now()
       RETURNING updated_at`,
      [STATE_ID, payload]
    );
    res.json({ ok: true, updated_at: result.rows[0].updated_at });
  } catch (err) {
    console.error("Erro no PUT /api/state:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

ensureTable()
  .then(() => {
    app.listen(PORT, () => {
      console.log("Ponto Overall server rodando na porta " + PORT);
    });
  })
  .catch((err) => {
    console.error("Falha ao preparar o banco:", err);
    process.exit(1);
  });

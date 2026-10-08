#!/usr/bin/env bash
# Roda todos os testes de ponta a ponta do Ponto Overall.
#
# Precisa de um Postgres vazio e descartavel (ele e APAGADO a cada teste):
#   DATABASE_URL=postgres://postgres:postgres@localhost:5432/ponto_test bash tests/run-all.sh
# Rodar so um teste:  bash tests/run-all.sh 15   (parte do nome do arquivo)
#
# Cada teste roda com o servidor reiniciado e o banco zerado, para que um nao
# atrapalhe o outro (limites de tentativas de login, contas repetidas etc.).
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export DATABASE_URL="${DATABASE_URL:-postgres://postgres:postgres@localhost:5432/ponto_test}"
API_PORT="${API_PORT:-3111}"; APP_PORT="${APP_PORT:-8088}"
# (nomes TEST_* de proposito: APP_URL puro e uma variavel do servidor)
export TEST_API_URL="http://localhost:$API_PORT" TEST_APP_URL="http://localhost:$APP_PORT/index.html" APP_PORT
API_URL="$TEST_API_URL"
OUT="$ROOT/tests/.out"; rm -rf "$OUT"; mkdir -p "$OUT/shots" "$OUT/logs"
FILTER="${1:-}"

if curl -fs -m 2 "$API_URL/health" >/dev/null 2>&1; then
  echo "Ja existe um servidor respondendo em $API_URL. Encerre-o ou use API_PORT=outra_porta."; exit 1
fi

echo "== verificacao de sintaxe =="
bad=0
for f in js/*.js sw.js server/server.js tests/e2e/*.js; do node --check "$f" 2>"$OUT/syntax.err" || { echo "ERRO em $f"; cat "$OUT/syntax.err"; bad=1; }; done
[ "$bad" = 1 ] && exit 1
echo "ok"

# chaves de push so para os testes (o servico de push dos testes e um servidor local de mentira)
VAPID="$(cd server && node -e "const w=require('web-push');const k=w.generateVAPIDKeys();console.log(k.publicKey+' '+k.privateKey)")"
export VAPID_PUBLIC_KEY="${VAPID% *}" VAPID_PRIVATE_KEY="${VAPID#* }"

node tests/static-server.js >"$OUT/logs/static.log" 2>&1 &
STATIC_PID=$!
SERVER_PID=""
stop_server() { [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null && wait "$SERVER_PID" 2>/dev/null; SERVER_PID=""; }
cleanup() { stop_server; kill "$STATIC_PID" 2>/dev/null; }
trap cleanup EXIT

start_server() {
  psql "$DATABASE_URL" -q -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" >/dev/null 2>&1 || { echo "Nao consegui zerar o banco de teste ($DATABASE_URL)"; exit 1; }
  (cd server && exec env DATABASE_SSL=off JWT_SECRET=test PORT="$API_PORT" NODE_TLS_REJECT_UNAUTHORIZED=0 node server.js >"$OUT/logs/server.log" 2>&1) &
  SERVER_PID=$!
  for _ in $(seq 1 60); do curl -fs "$API_URL/health" >/dev/null 2>&1 && return 0; sleep 0.5; done
  echo "Servidor de teste nao subiu:"; tail -20 "$OUT/logs/server.log"; exit 1
}

pass=0; fail=0; failed=()
for t in tests/e2e/*.js; do
  name="$(basename "$t" .js)"
  [ -n "$FILTER" ] && [[ "$name" != *"$FILTER"* ]] && continue
  stop_server; start_server
  ( cd "$OUT" && timeout 300 node "$ROOT/$t" ) >"$OUT/logs/$name.log" 2>&1
  code=$?
  if [ "$code" = 0 ] && ! grep -qE "^FAIL |FALHA" "$OUT/logs/$name.log"; then
    echo "OK    $name"; pass=$((pass+1))
  else
    echo "FALHOU $name (codigo $code)"; grep -E "^FAIL |FALHA|Error" "$OUT/logs/$name.log" | head -8; fail=$((fail+1)); failed+=("$name")
  fi
done
echo
echo "$pass passaram, $fail falharam"
[ "$fail" = 0 ] || { echo "Falharam: ${failed[*]} (logs em tests/.out/logs)"; exit 1; }

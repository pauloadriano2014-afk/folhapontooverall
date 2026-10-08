// Erros do navegador chegam ao servidor (log) e o servidor limita o volume.
const { chromium } = require('playwright');
const API = 'https://ponto-overall-api.onrender.com', LOCAL = process.env.TEST_API_URL || 'http://localhost:3111', APP = process.env.TEST_APP_URL || 'http://localhost:8088/index.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const post = (b) => fetch(LOCAL + '/api/client-error', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  ok((await post({ message: 'teste', source: 'x.js', line: 1 })).status === 204, 'servidor aceita o relatorio de erro (204)');
  ok((await post({ message: 'a'.repeat(100000), stack: 'b'.repeat(100000) })).status === 204, 'texto enorme e cortado, sem quebrar');
  let limited = false; for (let i = 0; i < 40; i++) { if ((await post({ message: 'spam' })).status === 429) { limited = true; break; } }
  ok(limited, 'excesso de relatorios e barrado (429)');
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  const page = await ctx.newPage(); const reports = [];
  await page.route(API + '/**', async route => { const req = route.request(); const u = new URL(req.url());
    if (u.pathname === '/api/client-error') { reports.push(JSON.parse(req.postData() || '{}')); return route.fulfill({ status: 204 }); }
    const r = await fetch(LOCAL + u.pathname + u.search, { method: req.method(), headers: req.headers(), body: req.postData() || undefined });
    const h = {}; r.headers.forEach((v, k) => { if (!['content-encoding', 'content-length', 'transfer-encoding'].includes(k)) h[k] = v; });
    route.fulfill({ status: r.status, headers: h, body: Buffer.from(await r.arrayBuffer()) }); });
  await page.goto(APP); await sleep(600);
  await page.evaluate(() => { setTimeout(() => { throw new Error('erro de teste do navegador'); }, 0); }); await sleep(500);
  ok(reports.some(r => /erro de teste do navegador/.test(r.message)), 'erro de JavaScript e enviado ao servidor');
  await page.evaluate(() => { Promise.reject(new Error('promessa de teste')); }); await sleep(500);
  ok(reports.some(r => /promessa de teste/.test(r.message)), 'promessa rejeitada tambem');
  const n = reports.length;
  await page.evaluate(() => { for (let i = 0; i < 10; i++) setTimeout(() => { throw new Error('repetido'); }, 0); }); await sleep(600);
  ok(reports.length - n <= 1, 'o mesmo erro repetido nao inunda o servidor: ' + (reports.length - n));
  await browser.close(); console.log(fails ? fails + ' FALHA(S)' : 'TUDO OK'); process.exit(fails ? 1 : 0);
})();

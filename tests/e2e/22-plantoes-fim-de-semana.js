// Teste de ponta a ponta (Playwright). Veja tests/README ou o README do projeto para rodar.
const { chromium } = require('playwright');
const API = 'https://ponto-overall-api.onrender.com', LOCAL = process.env.TEST_API_URL || 'http://localhost:3111', APP = process.env.TEST_APP_URL || 'http://localhost:8088/index.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const api = async (path, method = 'GET', body, token) => { if (path === '/api/register' && body && body.acceptTerms === undefined) body = { ...body, acceptTerms: true }; const r = await fetch(LOCAL + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, b: await r.json().catch(() => null) }; };
const U = Date.now().toString(36).slice(-5); const E = n => `${n}${U}@x.com`;
async function dev(browser, vp = { width: 1280, height: 800 }) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: vp, isMobile: vp.width < 600, deviceScaleFactor: vp.width < 600 ? 2 : 1 });
  const page = await ctx.newPage(); page.errors = []; page.on('pageerror', e => page.errors.push(e.message)); page.on('dialog', d => d.accept());
  await page.route(API + '/**', async route => { const req = route.request(); const u = new URL(req.url());
    const r = await fetch(LOCAL + u.pathname + u.search, { method: req.method(), headers: req.headers(), body: req.postData() || undefined });
    const h = {}; r.headers.forEach((v, k) => { if (!['content-encoding', 'content-length', 'transfer-encoding'].includes(k)) h[k] = v; });
    route.fulfill({ status: r.status, headers: h, body: Buffer.from(await r.arrayBuffer()) }); });
  await page.goto(APP); return page;
}
async function login(page, email) {
  await page.fill('#loginEmail', email); await page.fill('#loginPassword', '123456'); await page.click('#loginSubmit');
  await page.waitForFunction(() => document.getElementById('authScreen').style.display === 'none' && document.getElementById('appNav').style.display === 'block', null, { timeout: 15000 });
  await sleep(1400); await page.evaluate(() => closeOverlays()); await sleep(200);
}
const items = p => p.evaluate(() => [...document.querySelectorAll('#appNav .nav-item:not([hidden])')].map(b => b.dataset.view || b.id));
const vis = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); return !!e && e.offsetParent !== null; }, sel);
(async () => {
  let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
  const u = (await api('/api/register', 'POST', { name: 'Paula', email: E('paula'), password: '123456', role: 'Professor' })).b;
  ok(!!u.token, 'professora criada');
  const browser = await chromium.launch();
  const p = await dev(browser, { width: 430, height: 900 }); await login(p, E('paula'));
  await p.evaluate(() => { showView('grade'); });
  await sleep(500);
  const colsBefore = await p.evaluate(() => document.querySelectorAll('#rowDayNum th.dayhead').length);
  const wkBefore = await p.evaluate(() => document.querySelectorAll('#rowDayNum th.dayhead.weekend').length);
  ok(wkBefore > 0, 'sem o turno de fim de semana, sabado e domingo aparecem na grade (' + wkBefore + ')');
  ok(!(await vis(p, '#weekendCard')), 'lista de plantoes escondida quando o recurso esta desligado');
  await p.evaluate(() => { data.settings.weekendShiftEnabled = true; saveData(); renderGrid(); });
  await sleep(300);
  const wkAfter = await p.evaluate(() => document.querySelectorAll('#rowDayNum th.dayhead.weekend').length);
  ok(wkAfter === 0, 'com o recurso ligado, a grade fica so com seg-sex');
  ok(await vis(p, '#weekendCard'), 'lista de plantoes de fim de semana aparece');
  const rows = await p.evaluate(() => document.querySelectorAll('#weekendList .wk-row').length);
  const hol = await p.evaluate(() => dayKeysOf(currentMonthKey).filter(k => !isWeekendDow(dowOfDateKey(k)) && holidaysForDateKey(k)));
  ok(rows === wkBefore + hol.length, 'uma linha por sabado, domingo e feriado: ' + rows + ' (' + hol.length + ' feriado(s) em dia de semana)');
  if (hol.length) {
    const d = hol[0].slice(8, 10);
    const inGrid = await p.evaluate(d => [...document.querySelectorAll('#rowDayNum th .num')].some(e => e.textContent === d), d);
    ok(!inGrid, 'feriado de dia de semana (' + hol[0] + ') sai da grade');
    const txt = await p.evaluate(() => [...document.querySelectorAll('#weekendList .wk-holiday')].map(r => r.innerText.replace(/\s+/g, ' ')).join(' | '));
    ok(/Feriado · /.test(txt), 'linha do feriado mostra o nome: ' + txt);
  }
  // lanca um plantao pela lista
  await p.evaluate(() => document.querySelector('#weekendList .wk-row').click()); await sleep(400);
  await p.click('#shiftSelector [data-shift=tarde]'); await sleep(300);
  await p.evaluate(() => { var b = [...document.querySelectorAll('#slotList button')].find(x => /^15$/.test(x.textContent.trim())); b && b.click(); }); await sleep(300);
  await p.evaluate(() => closeOverlays()); await sleep(300);
  const first = await p.evaluate(() => document.querySelector('#weekendList .wk-row').innerText.replace(/\s+/g, ' '));
  ok(/13:00–18:00/.test(first) && /15/.test(first), 'linha mostra horario e valor: ' + first);
  const tot = await p.evaluate(() => document.getElementById('weekendTotal').textContent);
  ok(/1 plantão/.test(tot) && /15/.test(tot), 'total dos plantoes: ' + tot);
  await p.screenshot({ path: 'shots/22-plantoes-fds.png', fullPage: true });
  ok(p.errors.length === 0, 'sem erros de JS ' + p.errors.join('|'));
  await browser.close(); console.log(fails ? fails + ' FALHA(S)' : 'TUDO OK'); process.exit(fails ? 1 : 0);
})();

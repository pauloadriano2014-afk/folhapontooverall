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
  let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
  const owner = (await api('/api/register', 'POST', { accountType: 'empresa', companyName: 'Overall Tab', name: 'Dono', email: E('dono'), password: '123456' })).b;
  const code = async () => (await api('/api/company/overview', 'GET', null, owner.token)).b.company.inviteCode;
  const reg = async (n, role) => (await api('/api/register', 'POST', { name: n, email: E(n.toLowerCase()), password: '123456', role, inviteCode: await code() })).b;
  const coord = await reg('Harlisson', 'Professor'); await reg('Adrielle', 'Estagiária');
  await api(`/api/company/staff/${coord.user.id}/access`, 'PUT', { accessRole: 'coordinator' }, owner.token);
  const browser = await chromium.launch();
  const a = await dev(browser); await login(a, E('harlisson'));
  const ctx = a.context(); const b = await ctx.newPage();
  await b.route(API + '/**', async route => { const req = route.request(); const u = new URL(req.url());
    const r = await fetch(LOCAL + u.pathname + u.search, { method: req.method(), headers: req.headers(), body: req.postData() || undefined });
    const h = {}; r.headers.forEach((v, k) => { if (!['content-encoding', 'content-length', 'transfer-encoding'].includes(k)) h[k] = v; });
    route.fulfill({ status: r.status, headers: h, body: Buffer.from(await r.arrayBuffer()) }); });
  await b.goto(APP); await sleep(2500); ok(await b.evaluate(() => currentUser && currentUser.name) === 'Harlisson', 'aba nova herda a conta do aparelho'); await b.evaluate(() => logout()); await sleep(300); await login(b, E('adrielle'));
  const who = p => p.evaluate(() => currentUser && currentUser.name);
  ok(await who(b) === 'Adrielle', 'aba B esta como Adrielle');
  await a.reload(); await sleep(2500);
  ok(await who(a) === 'Harlisson', 'F5 na aba A continua Harlisson (veio: ' + await who(a) + ')');
  await b.reload(); await sleep(2500);
  ok(await who(b) === 'Adrielle', 'F5 na aba B continua Adrielle (veio: ' + await who(b) + ')');
  // nova aba (sem sessao fixada) abre a ultima conta usada no aparelho
  const c = await ctx.newPage(); await c.goto(APP); await sleep(2500);
  ok(await who(c) === 'Adrielle', 'aba nova abre a ultima conta do aparelho');
  // splash some depois de abrir
  ok(await a.evaluate(() => getComputedStyle(document.getElementById('bootSplash')).display === 'none'), 'tela de carregamento some');
  // sair numa aba nao derruba a outra aba ja aberta
  await browser.close(); console.log(fails ? fails + ' FALHA(S)' : 'TUDO OK'); process.exit(fails ? 1 : 0);
})();

// Teste de ponta a ponta (Playwright). Veja tests/README ou o README do projeto para rodar.
const { chromium } = require('playwright');
const API = 'https://ponto-overall-api.onrender.com', LOCAL = process.env.TEST_API_URL || 'http://localhost:3111', APP = process.env.TEST_APP_URL || 'http://localhost:8088/index.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const api = async (path, method = 'GET', body, token) => { if (path === '/api/register' && body) body = { acceptTerms: true, ...body }; const r = await fetch(LOCAL + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, b: await r.json().catch(() => null) }; };
const U = Date.now().toString(36).slice(-5); let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const owner = (await api('/api/register', 'POST', { accountType: 'empresa', companyName: 'Overall Push', name: 'Dono', email: `d${U}@x.com`, password: '123456' })).b;
  const code = (await api('/api/company/overview', 'GET', null, owner.token)).b.company.inviteCode;
  await api('/api/register', 'POST', { name: 'Lia', email: `l${U}@x.com`, password: '123456', role: 'Estagiária', inviteCode: code });
  const browser = await chromium.launch();
  for (const [label, ua, killPM, expect] of [['iPhone no Safari (sem instalar)', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1', true, /instale o app/], ['Android Chrome com suporte', null, false, /Ativar neste aparelho/]]) {
    const ctx = await browser.newContext({ serviceWorkers: 'allow', viewport: { width: 390, height: 844 }, ...(ua ? { userAgent: ua } : {}) });
    if (!killPM) await ctx.addInitScript(() => { Object.defineProperty(Notification, 'permission', { get: () => 'default' }); });
    if (killPM) await ctx.addInitScript(() => { try { delete window.PushManager; } catch (e) {} });
    const p = await ctx.newPage(); p.errors = []; p.on('pageerror', e => p.errors.push(e.message)); p.on('dialog', d => d.accept());
    await p.route(API + '/**', async route => { const req = route.request(); const u = new URL(req.url());
      const r = await fetch(LOCAL + u.pathname + u.search, { method: req.method(), headers: req.headers(), body: req.postData() || undefined });
      const h = {}; r.headers.forEach((v, k) => { if (!['content-encoding', 'content-length', 'transfer-encoding'].includes(k)) h[k] = v; });
      route.fulfill({ status: r.status, headers: h, body: Buffer.from(await r.arrayBuffer()) }); });
    await p.goto(APP);
    await p.fill('#loginEmail', `l${U}@x.com`); await p.fill('#loginPassword', '123456'); await p.click('#loginSubmit');
    await p.waitForFunction(() => document.getElementById('appNav') && document.getElementById('appNav').style.display === 'block', null, { timeout: 15000 }); await sleep(1500);
    await p.evaluate(() => closeOverlays()); await p.evaluate(() => showView('avisos')); await sleep(2500);
    const t = await p.evaluate(() => [...document.querySelectorAll('.push-box')].map(b => b.innerText).join('|'));
    ok(expect.test(t), label + ': ' + t.replace(/\s+/g, ' ').slice(0, 120));
    await p.screenshot({ path: 'shots/p1-' + (killPM ? 'ios' : 'android') + '.png' });
    ok(p.errors.length === 0, 'sem erros de JS ' + p.errors.join('|'));
    await ctx.close();
  }
  await browser.close(); console.log(fails ? fails + ' FALHA(S)' : 'TUDO OK'); process.exit(fails ? 1 : 0);
})();

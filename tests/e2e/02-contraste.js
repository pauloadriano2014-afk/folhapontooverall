// Teste de ponta a ponta (Playwright). Veja tests/README ou o README do projeto para rodar.
const { chromium } = require('playwright');
const API = 'https://ponto-overall-api.onrender.com', LOCAL = process.env.TEST_API_URL || 'http://localhost:3111', APP = process.env.TEST_APP_URL || 'http://localhost:8088/index.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const lum = c => { const [r, g, b] = c.match(/\d+/g).map(Number).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * r + .7152 * g + .0722 * b; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return ((Math.max(x, y) + .05) / (Math.min(x, y) + .05)); };
(async () => {
  const browser = await chromium.launch(); let bad = 0;
  const chk = async (p, sel, label) => { const r = await p.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const cs = getComputedStyle(e); return { c: cs.color, b: cs.backgroundColor }; }, sel); if (!r) { console.log('  (nao achei ' + label + ')'); return; } const x = ratio(r.c, r.b); const okk = x >= 4.5; if (!okk) bad++; console.log((okk ? 'PASS ' : 'FAIL ') + label + ' contraste ' + x.toFixed(1) + ':1'); };
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } }); await ctx.addInitScript(`localStorage.setItem('pontoOverallTheme_v1','${theme}')`);
    const p = await ctx.newPage(); await p.route(API + '/**', async route => { const req = route.request(); const u = new URL(req.url()); const r = await fetch(LOCAL + u.pathname + u.search, { method: req.method(), headers: req.headers(), body: req.postData() || undefined }); const h = {}; r.headers.forEach((v, k) => { if (!['content-encoding', 'content-length', 'transfer-encoding'].includes(k)) h[k] = v; }); route.fulfill({ status: r.status, headers: h, body: Buffer.from(await r.arrayBuffer()) }); });
    await p.goto(APP); await sleep(400);
    console.log('--- entrada, modo ' + theme); await chk(p, '#loginSubmit', 'botao Entrar'); await chk(p, '.auth-tab.active', 'aba ativa');
    const em = 'ct' + Date.now().toString(36) + theme + '@x.com'; await fetch(LOCAL + '/api/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ acceptTerms: true, name: 'Teste', email: em, password: '123456', role: 'Professor' }) });
    await p.fill('#loginEmail', em); await p.fill('#loginPassword', '123456'); await p.click('#loginSubmit'); await p.waitForFunction(() => document.getElementById('appNav').style.display === 'block', null, { timeout: 15000 }); await sleep(1200);
    console.log('--- app, modo ' + theme); await chk(p, '.nav-item.active', 'item ativo do menu'); await chk(p, '.ob-actions .primary', 'botao Proximo do tutorial');
    if (theme === 'light') await p.screenshot({ path: 'shots/l4-app-claro.png' });
    await ctx.close();
  }
  await browser.close(); console.log(bad ? `\n${bad} FALHA(S)` : '\nTUDO OK'); process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

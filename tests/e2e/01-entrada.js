// Teste de ponta a ponta (Playwright). Veja tests/README ou o README do projeto para rodar.
const { chromium } = require('playwright');
const API = 'https://ponto-overall-api.onrender.com', LOCAL = process.env.TEST_API_URL || 'http://localhost:3111', APP = process.env.TEST_APP_URL || 'http://localhost:8088/index.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
async function dev(browser, vp, init) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: vp, isMobile: vp.width < 600, deviceScaleFactor: 2 });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage(); page.errors = []; page.on('pageerror', e => page.errors.push(e.message));
  await page.route(API + '/**', async route => { const req = route.request(); const u = new URL(req.url());
    const r = await fetch(LOCAL + u.pathname + u.search, { method: req.method(), headers: req.headers(), body: req.postData() || undefined });
    const h = {}; r.headers.forEach((v, k) => { if (!['content-encoding', 'content-length', 'transfer-encoding'].includes(k)) h[k] = v; });
    route.fulfill({ status: r.status, headers: h, body: Buffer.from(await r.arrayBuffer()) }); });
  await page.goto(APP); await sleep(400); return page;
}
const v = (p, name) => p.evaluate(n => getComputedStyle(document.querySelector('.auth-screen')).getPropertyValue(n).trim(), name);
const bg = p => p.evaluate(() => getComputedStyle(document.querySelector('.auth-screen')).backgroundColor);
const btn = p => p.evaluate(() => getComputedStyle(document.getElementById('loginSubmit')).backgroundColor);
(async () => {
  const browser = await chromium.launch(); const M = { width: 390, height: 844 };
  for (const [theme, color, bgExp, accExp] of [['light', 'roxo', 'rgb(255, 255, 255)', '#1d4ed8'], ['dark', 'roxo', 'rgb(11, 13, 16)', '#3b82f6'], ['light', 'verde', 'rgb(255, 255, 255)', '#1d4ed8'], ['dark', 'rosa', 'rgb(11, 13, 16)', '#3b82f6'], ['dark', 'overall', 'rgb(11, 13, 16)', '#3b82f6']]) {
    const p = await dev(browser, M, `try{localStorage.setItem('pontoOverallTheme_v1','${theme}');localStorage.setItem('pontoOverallColor_v1','${color}');}catch(e){}`);
    ok(await v(p, '--accent') === accExp && await bg(p) === bgExp, `entrada com tema ${theme} e cor guardada "${color}": fundo ${await bg(p)}, destaque ${await v(p, '--accent')} (sempre Overall)`);
    if (theme === 'light' && color === 'roxo') await p.screenshot({ path: 'shots/l1-claro-roxo-guardado.png' });
    if (theme === 'dark' && color === 'roxo') await p.screenshot({ path: 'shots/l2-escuro.png' });
    ok(await p.evaluate(() => !document.getElementById('authHint') && !/Cada pessoa tem sua/.test(document.querySelector('.auth-card').innerText)), '   sem o texto de baixo');
    await p.close();
  }
  console.log('== as 4 telas da entrada continuam funcionando ==');
  const p = await dev(browser, { width: 1280, height: 800 });
  const shown = id => p.evaluate(i => getComputedStyle(document.getElementById(i)).display !== 'none', id);
  ok(await shown('loginForm') && !(await shown('registerForm')), 'entrar');
  await p.click('#tabRegister'); ok(await shown('registerForm') && !(await shown('loginForm')), 'criar conta (aba)'); await p.screenshot({ path: 'shots/l3-cadastro-desktop.png' });
  await p.click('#tabLogin'); await p.click('#btnForgotPassword'); ok(await shown('forgotForm'), 'esqueci minha senha');
  await p.click('#btnBackToLoginFromForgot'); ok(await shown('loginForm'), 'voltar para entrar');
  const p2 = await dev(browser, { width: 1280, height: 800 }); await p2.goto(APP + '?reset=abc123'); await sleep(500);
  ok(await p2.evaluate(() => getComputedStyle(document.getElementById('resetForm')).display !== 'none'), 'redefinir senha (link do e-mail)');
  const em = 'login' + Date.now().toString(36) + '@x.com';
  const r = await fetch(LOCAL + '/api/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ acceptTerms: true, name: 'Teste', email: em, password: '123456', role: 'Professor' }) });
  await p.fill('#loginEmail', em); await p.fill('#loginPassword', '123456'); await p.click('#loginSubmit');
  await p.waitForFunction(() => document.getElementById('authScreen').style.display === 'none', null, { timeout: 15000 }); ok(true, 'entrar com e-mail e senha continua funcionando');
  ok(p.errors.length === 0 && p2.errors.length === 0, 'sem erros de JS ' + p.errors.concat(p2.errors).join('|'));
  await browser.close(); console.log(fails ? `\n${fails} FALHA(S)` : '\nTUDO OK'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

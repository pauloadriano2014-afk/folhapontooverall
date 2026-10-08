// Teste de ponta a ponta (Playwright). Veja tests/README ou o README do projeto para rodar.
const { chromium } = require('playwright');
const API = 'https://ponto-overall-api.onrender.com', LOCAL = process.env.TEST_API_URL || 'http://localhost:3111', APP = process.env.TEST_APP_URL || 'http://localhost:8088/index.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const api = async (path, method = 'GET', body, token) => { if (path === '/api/register' && body && body.acceptTerms === undefined) body = { ...body, acceptTerms: true }; const r = await fetch(LOCAL + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, b: await r.json().catch(() => null) }; };
const U = Date.now().toString(36).slice(-5); const E = (n, c = '') => `${n}${c}${U}@x.com`;
async function dev(browser, vp = { width: 1280, height: 800 }) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: vp, isMobile: vp.width < 600, deviceScaleFactor: 2 });
  const page = await ctx.newPage(); page.errors = []; page.on('pageerror', e => page.errors.push(e.message));
  await page.route(API + '/**', async route => { const req = route.request(); const u = new URL(req.url());
    const r = await fetch(LOCAL + u.pathname + u.search, { method: req.method(), headers: req.headers(), body: req.postData() || undefined });
    const h = {}; r.headers.forEach((v, k) => { if (!['content-encoding', 'content-length', 'transfer-encoding'].includes(k)) h[k] = v; });
    route.fulfill({ status: r.status, headers: h, body: Buffer.from(await r.arrayBuffer()) }); });
  await page.goto(APP); return page;
}
async function login(page, email) {
  await page.fill('#loginEmail', email); await page.fill('#loginPassword', '123456'); await page.click('#loginSubmit');
  await page.waitForFunction(() => document.getElementById('authScreen').style.display === 'none' && document.getElementById('appNav').style.display === 'block', null, { timeout: 15000 });
  await sleep(1500);
}
const open = p => p.evaluate(() => document.getElementById('onboardingOverlay').classList.contains('open'));
(async () => {
  const mk = async (companyName, tag) => {
    const owner = (await api('/api/register', 'POST', { accountType: 'empresa', companyName, name: 'Dono ' + tag, email: E('dono', tag), password: '123456' })).b;
    const code = (await api('/api/company/overview', 'GET', null, owner.token)).b.company.inviteCode;
    const reg = async (n, role) => (await api('/api/register', 'POST', { name: n, email: E(n.toLowerCase(), tag), password: '123456', role, inviteCode: code })).b;
    return { owner, reg };
  };
  const A = await mk('Overall', 'a');
  const prof = await A.reg('Pri', 'Professor'), est = await A.reg('Edu', 'Estagiário'), coord = await A.reg('Cora', 'Professor'), ger = await A.reg('Gil', 'Professor'), soc = await A.reg('Sol', 'Professor');
  await api(`/api/company/staff/${coord.user.id}/access`, 'PUT', { accessRole: 'coordinator' }, A.owner.token);
  await api(`/api/company/staff/${ger.user.id}/access`, 'PUT', { accessRole: 'manager' }, A.owner.token);
  await api(`/api/company/staff/${soc.user.id}/access`, 'PUT', { accessRole: 'partner' }, A.owner.token);
  const browser = await chromium.launch();
  const expected = { dono: ['a', 5], pri: ['', 5], edu: ['', 5], cora: ['', 5], gil: ['', 5], sol: ['', 3] };
  console.log('== tutorial em passos, por perfil ==');
  for (const [who, [, n]] of Object.entries(expected)) {
    const p = await dev(browser); await login(p, E(who, 'a'));
    ok(await open(p), `${who}: tutorial abre no primeiro acesso`);
    const dots = await p.evaluate(() => document.querySelectorAll('#obDots .ob-dot').length);
    ok(dots === n, `${who}: ${dots} passos (esperado ${n})`);
    const t1 = await p.textContent('#obStepTitle');
    await p.click('#obNext'); const t2 = await p.textContent('#obStepTitle'); ok(t1 !== t2, `${who}: Proximo muda o passo ("${t1}" -> "${t2}")`);
    await p.click('#obBack'); ok((await p.textContent('#obStepTitle')) === t1, `${who}: Voltar retorna ao passo anterior`);
    ok(await p.evaluate(() => getComputedStyle(document.getElementById('obBack')).visibility === 'hidden'), `${who}: sem Voltar no primeiro passo`);
    if (who === 'dono') { await p.screenshot({ path: 'shots/o1-desktop-dono.png' }); }
    if (who === 'edu') { await p.screenshot({ path: 'shots/o2-desktop-estag.png' }); }
    for (let i = 1; i < n; i++) await p.click('#obNext');
    ok((await p.textContent('#obNext')) === 'Começar' && (await p.textContent('#obClose')) === 'Fechar', `${who}: no ultimo passo: "Começar" e "Fechar"`);
    await p.click('#obNext'); await sleep(200); ok(!(await open(p)), `${who}: "Começar" fecha o tutorial`);
    await p.reload(); await p.waitForFunction(() => document.getElementById('appNav').style.display === 'block', null, { timeout: 15000 }); await sleep(1200);
    ok(!(await open(p)), `${who}: nao reabre sozinho depois de visto`);
    ok(p.errors.length === 0, `${who}: sem erros de JS ${p.errors.join('|')}`); await p.close();
  }
  console.log('== Pular, teclado e reabrir pelas Duvidas ==');
  let p = await dev(browser); await login(p, E('pri', 'a'));
  if (await open(p)) { await p.click('#obClose'); await sleep(200); } // dispensa o 1o acesso e testa a reabertura pelas Duvidas
  await p.click('.nav-item[data-view=duvidas]'); await sleep(300);
  await p.evaluate(() => [...document.querySelectorAll('.faq-card button')].find(b => /tutorial/i.test(b.textContent)).click()); await sleep(300);
  ok(await open(p), 'Duvidas > "Rever o tutorial inicial" reabre'); await p.keyboard.press('ArrowRight'); ok(await p.evaluate(() => document.querySelector('#obDots .active') === document.querySelectorAll('#obDots .ob-dot')[1]), 'seta para a direita avanca');
  await p.click('#obClose'); await sleep(200); ok(!(await open(p)), '"Pular" fecha'); await p.close();

  console.log('== celular e tema claro (capturas) ==');
  const B = await mk('Overall Centro', 'b'); const p2 = await B.reg('Ana', 'Professor');
  p = await dev(browser, { width: 390, height: 844 }); await login(p, E('ana', 'b')); await p.screenshot({ path: 'shots/o3-celular.png' });
  await p.click('#obNext'); await sleep(300); await p.screenshot({ path: 'shots/o4-celular-passo2.png' }); await p.close();
  p = await dev(browser, { width: 390, height: 844 }); await p.evaluate(() => { localStorage.setItem('pontoOverallTheme_v1', 'light'); }); await p.reload();
  await login(p, E('dono', 'a')).catch(() => {}); await p.screenshot({ path: 'shots/o5-celular-claro.png' }); await p.close();

  console.log('== nome da academia nao repete a logo ==');
  for (const [tag, name, expectHidden] of [['a', 'Overall', true], ['b', 'Overall Centro', false]]) {
    p = await dev(browser); await login(p, E('dono', tag)); await p.evaluate(() => closeOverlays()); await sleep(300);
    const vis = await p.evaluate(() => { const e = document.getElementById('companyNameLabel'); return e.offsetParent !== null ? e.textContent : null; });
    ok(expectHidden ? vis === null : vis === name, `academia "${name}": ${expectHidden ? 'nome escondido (a logo ja diz Overall Gym)' : 'nome aparece: ' + vis}`);
    if (tag === 'a') await p.screenshot({ path: 'shots/o6-sem-repeticao.png' });
    await p.close();
  }
  for (const [n, exp] of [['Overall Gym', true], ['Academia Overall', true], ['Overall', true], ['Overall Centro', false], ['Power Gym', false]]) {
    const pp = await dev(browser); const r = await pp.evaluate(n => isRedundantCompanyName(n), n); ok(r === exp, `isRedundantCompanyName("${n}") = ${r}`); await pp.close();
  }
  await browser.close(); console.log(fails ? `\n${fails} FALHA(S)` : '\nTUDO OK'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

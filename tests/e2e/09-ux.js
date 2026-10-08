// Teste de ponta a ponta (Playwright). Veja tests/README ou o README do projeto para rodar.
const { chromium } = require('playwright');
const API = 'https://ponto-overall-api.onrender.com', LOCAL = process.env.TEST_API_URL || 'http://localhost:3111', APP = process.env.TEST_APP_URL || 'http://localhost:8088/index.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
async function dev(browser, vp = { width: 1280, height: 800 }) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: vp, acceptDownloads: true });
  const page = await ctx.newPage(); page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  await page.route(API + '/**', async route => { const req = route.request(); const u = new URL(req.url());
    const r = await fetch(LOCAL + u.pathname + u.search, { method: req.method(), headers: req.headers(), body: req.postData() || undefined });
    const h = {}; r.headers.forEach((v, k) => { if (!['content-encoding', 'content-length', 'transfer-encoding'].includes(k)) h[k] = v; });
    route.fulfill({ status: r.status, headers: h, body: Buffer.from(await r.arrayBuffer()) }); });
  await page.goto(APP); return page;
}
async function login(page, email) {
  await page.fill('#loginEmail', email); await page.fill('#loginPassword', '123456'); await page.click('#loginSubmit');
  await page.waitForFunction(() => document.getElementById('authScreen').style.display === 'none' && document.getElementById('appNav').style.display === 'block', null, { timeout: 15000 });
  await sleep(700); await page.evaluate(() => { const g = document.getElementById('termsGateOverlay'); if (g && g.classList.contains('open')) { document.getElementById('gateAccept').click(); document.getElementById('btnGateAccept').click(); } }); await sleep(600);
  await page.evaluate(() => closeOverlays()); await sleep(200);
}
const vis = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none'; }, sel);
(async () => {
  const browser = await chromium.launch();
  // contas usadas neste teste (cria se ainda nao existirem)
  const reg = (b) => fetch(LOCAL + '/api/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ acceptTerms: true, password: '123456', ...b }) }).then(r => r.json().catch(() => ({})));
  const _o = await reg({ accountType: 'empresa', companyName: 'Overall Gym', name: 'Marcos Dono', email: 'dono@x.com' });
  const _tok = _o.token || (await fetch(LOCAL + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'dono@x.com', password: '123456' }) }).then(r => r.json())).token;
  const _code = (await fetch(LOCAL + '/api/company/overview', { headers: { authorization: 'Bearer ' + _tok } }).then(r => r.json())).company.inviteCode;
  for (const [n, e, r] of [['Bruna', 'bruna@x.com', 'Estagiário'], ['Carlos Prof', 'carlos@x.com', 'Professor'], ['Rafa Personal', 'rafa@x.com', 'Personal Trainer']]) await reg({ name: n, email: e, role: r, inviteCode: _code });

  console.log('== impressao do PDF (estagiario, estando na tela Exportacao) ==');
  let p = await dev(browser); await login(p, 'bruna@x.com');
  await p.click('.nav-item[data-view=exportacao]');
  ok(!(await vis(p, '#gradeCard')), 'na tela: grade escondida');
  await p.emulateMedia({ media: 'print' });
  ok(await vis(p, '#gradeCard'), 'na impressao: grade aparece');
  ok(await vis(p, '#resumoCard'), 'na impressao: resumo aparece');
  ok(await vis(p, '#vipCard'), 'na impressao: VIP aparece (estagiario atende VIP)');
  ok(!(await vis(p, '#exportCard')) && !(await vis(p, '#appNav')) && !(await vis(p, '.faq-card')), 'na impressao: menu, exportacao e duvidas nao aparecem');
  ok(!(await vis(p, '#clientsCard')), 'na impressao: alunos particulares nao aparecem (estagiario nao tem)');
  ok(p.errors.length === 0, 'sem erros de JS ' + p.errors.join('|')); await p.close();

  console.log('== professor nao tem VIP, nem na impressao ==');
  p = await dev(browser); await login(p, 'carlos@x.com'); await p.click('.nav-item[data-view=exportacao]'); await p.emulateMedia({ media: 'print' });
  ok(!(await vis(p, '#vipCard')), 'professor: VIP nao aparece na impressao');
  ok(await vis(p, '#gradeCard'), 'professor: grade aparece na impressao');
  const navP = await p.evaluate(() => [...document.querySelectorAll('#appNav .nav-item:not([hidden])')].map(b => b.dataset.view || 'x'));
  ok(navP.indexOf('vip') < 0, 'professor: sem item VIP no menu'); await p.close();

  console.log('== cadastro exige funcao ==');
  p = await dev(browser); await p.click('#tabRegister');
  await p.fill('#regName', 'Teste'); await p.fill('#regEmail', 'teste@x.com'); await p.fill('#regPassword', '123456'); await p.check('#regAcceptTerms'); await p.click('#registerSubmit');
  ok((await p.textContent('#registerError')).includes('função'), 'mostra "Escolha a sua função." sem chamar o servidor');
  ok(await p.evaluate(() => document.querySelector('#regRole').tagName) === 'SELECT', 'funcao e uma lista de opcoes'); await p.close();

  console.log('== dono: exportar planilha da equipe ==');
  p = await dev(browser); await login(p, 'dono@x.com'); await sleep(800);
  await p.click('.nav-item[data-view=exportacao]');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#btnCompanyExport')]);
  ok(/equipe-overall-\d{4}-\d{2}\.xlsx/.test(dl.suggestedFilename()), 'exportar equipe baixa Excel: ' + dl.suggestedFilename());
  ok(p.errors.length === 0, 'sem erros de JS no painel da academia ' + p.errors.join('|'));
  await p.click('#btnNavLogout').catch(() => {}); await p.close();

  console.log('== sair pelo menu volta pro login ==');
  p = await dev(browser); await login(p, 'bruna@x.com');
  p.on('dialog', d => d.accept()); await p.click('#btnNavLogout'); await sleep(500);
  ok(await vis(p, '#authScreen') && !(await vis(p, '#appNav')), 'tela de login aparece e o menu some'); await p.close();

  await browser.close(); console.log(fails ? `\n${fails} FALHA(S)` : '\nTUDO OK'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

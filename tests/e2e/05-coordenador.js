// Teste de ponta a ponta (Playwright). Veja tests/README ou o README do projeto para rodar.
const { chromium } = require('playwright');
const API = 'https://ponto-overall-api.onrender.com', LOCAL = process.env.TEST_API_URL || 'http://localhost:3111', APP = process.env.TEST_APP_URL || 'http://localhost:8088/index.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const api = async (path, method = 'GET', body, token) => { if (path === '/api/register' && body && body.acceptTerms === undefined) body = { ...body, acceptTerms: true }; const r = await fetch(LOCAL + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, b: await r.json().catch(() => null) }; };
const U = Date.now().toString(36).slice(-5); const E = n => `${n}${U}@x.com`;
async function dev(browser) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 800 } });
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
  await sleep(1000); await page.evaluate(() => closeOverlays()); await sleep(200);
}
(async () => {
  console.log('== API: coordenador nunca e estagiario ==');
  const owner = (await api('/api/register', 'POST', { accountType: 'empresa', companyName: 'Gym ' + U, name: 'Dona', email: E('dona'), password: '123456' })).b;
  const code = async () => (await api('/api/company/overview', 'GET', null, owner.token)).b.company.inviteCode;
  const reg = async (n, role) => (await api('/api/register', 'POST', { name: n, email: E(n.toLowerCase()), password: '123456', role, inviteCode: await code() })).b;
  const est = await reg('Edu', 'Estagiário'), prof = await reg('Pri', 'Professor'), prof2 = await reg('Pam', 'Professor');
  let r = await api('/api/company/invite', 'POST', { name: 'C1', email: E('c1'), role: 'Estagiário', accessRole: 'coordinator' }, owner.token); ok(r.s === 400 && r.b.error === 'coordinator_not_trainee', 'convite de coordenador como estagiario e recusado');
  r = await api('/api/company/invite', 'POST', { name: 'C2', email: E('c2'), role: '', accessRole: 'coordinator' }, owner.token); ok(r.s === 200, 'convite de coordenador sem funcao (so coordena) e aceito');
  const tokNone = r.b.inviteLink.split('invite=')[1];
  r = await api('/api/company/invite', 'POST', { name: 'C3', email: E('c3'), role: 'Professor', accessRole: 'coordinator' }, owner.token); ok(r.s === 200, 'convite de coordenador professor e aceito'); const tokProf = r.b.inviteLink.split('invite=')[1];
  r = await api(`/api/company/staff/${est.user.id}/access`, 'PUT', { accessRole: 'coordinator' }, owner.token); ok(r.s === 400 && r.b.error === 'coordinator_not_trainee', 'promover estagiario a coordenador sem mudar a funcao e recusado');
  r = await api('/api/me', 'GET', null, est.token); ok(r.b.user.companyRole === null, 'e nada mudou na conta dele');
  r = await api(`/api/company/staff/${est.user.id}/access`, 'PUT', { accessRole: 'coordinator', role: 'Estagiário' }, owner.token); ok(r.s === 400, 'idem mandando funcao Estagiario junto');
  r = await api(`/api/company/staff/${est.user.id}/access`, 'PUT', { accessRole: 'coordinator', role: 'Professor' }, owner.token); ok(r.s === 200, 'promover mudando a funcao para Professor funciona');
  r = await api(`/api/company/staff/${prof.user.id}/access`, 'PUT', { accessRole: 'coordinator', role: '' }, owner.token); ok(r.s === 200, 'promover professor a coordenador sem funcao ("so coordena") funciona');
  r = await api(`/api/company/staff/${est.user.id}/access`, 'PUT', { role: 'Estagiário' }, owner.token); ok(r.s === 400, 'coordenador nao volta a ser estagiario so trocando a funcao');
  r = await api(`/api/company/staff/${est.user.id}/access`, 'PUT', { accessRole: 'staff', role: 'Estagiário' }, owner.token); ok(r.s === 200, 'deixando de ser coordenador, pode voltar a ser estagiario');
  r = await api('/api/register', 'POST', { name: 'C3', email: E('c3'), password: '123456', role: 'Estagiário', inviteToken: tokProf }); ok(r.s === 400 && r.b.error === 'coordinator_not_trainee', 'cadastro por convite de coordenador escolhendo Estagiario e recusado');
  r = await api('/api/register', 'POST', { name: 'C2', email: E('c2'), password: '123456', role: '', inviteToken: tokNone }); ok(r.s === 200 && r.b.user.companyRole === 'coordinator' && r.b.user.role === '', 'cadastro de coordenador sem funcao funciona e ele ja entra como coordenador');
  r = await api('/api/register', 'POST', { name: 'C3', email: E('c3'), password: '123456', role: 'Professor', inviteToken: tokProf }); ok(r.s === 200 && r.b.user.companyRole === 'coordinator', 'cadastro de coordenador professor funciona');
  const sub = await api('/api/me/personal-module', 'PUT', { enabled: true }, (await api('/api/login', 'POST', { email: E('c2'), password: '123456' })).b.token); ok(sub.s === 200, 'coordenador sem funcao pode ligar o modulo de particulares');

  console.log('== Tela ==');
  const browser = await chromium.launch();
  let p = await dev(browser); await login(p, E('dona'));
  await p.click('.nav-item[data-view=convites]'); await p.evaluate(() => document.getElementById('btnOpenInvite').click()); await sleep(300);
  const opts = () => p.evaluate(() => [...document.querySelectorAll('#inviteRole option')].filter(o => !o.hidden).map(o => o.textContent.trim()));
  ok((await opts()).join('|') === 'Selecione a função…|Estagiário|Professor', 'convite de profissional: Estagiario e Professor');
  await p.click('input[name=inviteAccessRole][value=coordinator]');
  ok((await opts()).join('|') === 'Não é professor (só coordena)|Professor', 'convite de coordenador: sem Estagiario, com "Não é professor (só coordena)": ' + (await opts()).join(' | '));
  await p.fill('#inviteName', 'Coord UI'); await p.fill('#inviteEmail', E('coordui')); await p.click('#inviteSubmit'); await sleep(900);
  ok(await p.evaluate(() => document.getElementById('inviteResult').style.display !== 'none'), 'da para enviar o convite de coordenador sem funcao de professor');
  await p.screenshot({ path: 'shots/c01-convite-coord.png' }); await p.evaluate(() => closeOverlays());
  await p.click('.nav-item[data-view=gestao]'); await sleep(600);
  await p.evaluate(() => [...document.querySelectorAll('#teamManageList .client-row')].find(r => r.textContent.includes('Edu')).querySelector('button').click()); await sleep(300);
  await p.click('#staffEditAccessGrid input[value=coordinator]');
  ok(await p.evaluate(() => { const o = [...document.querySelectorAll('#staffEditRole option')].find(x => x.value === 'Estagiário'); return o.hidden && o.disabled; }), 'edicao: ao escolher Coordenador(a), Estagiario some da funcao');
  ok(await p.evaluate(() => document.getElementById('staffEditRole').value) !== 'Estagiário', 'e a funcao deixa de ser Estagiario automaticamente');
  await p.screenshot({ path: 'shots/c02-editar-coord.png' });
  await p.click('#staffEditAccessGrid input[value=staff]');
  ok(await p.evaluate(() => { const o = [...document.querySelectorAll('#staffEditRole option')].find(x => x.value === 'Estagiário'); return !o.hidden && !o.disabled; }), 'voltando para Profissional, Estagiario reaparece'); await p.evaluate(() => closeOverlays());
  await p.click('.nav-item[data-view=equipe]'); await sleep(400);
  const t = await p.evaluate(() => [...document.querySelectorAll('#companyStaffList .client-row')].map(r => r.innerText.replace(/\s+/g, ' ')).join(' || '));
  ok(/C2[^|]*Coordenador\(a\)/.test(t) && !/C2[^|]*Sem função definida/.test(t), 'coordenador sem funcao aparece como "Coordenador(a)" (sem "Sem funcao definida")'); 
  ok(p.errors.length === 0, 'sem erros de JS ' + p.errors.join('|')); await p.close();
  // convite aberto por link: cadastro do coordenador
  const inv = (await api('/api/company/invites', 'GET', null, owner.token)).b.invites.find(i => i.name === 'Coord UI');
  p = await dev(browser); await p.goto(APP + '?invite=' + inv.inviteLink.split('invite=')[1]); await sleep(1500);
  const regOpts = await p.evaluate(() => [...document.querySelectorAll('#regRole option')].filter(o => !o.hidden).map(o => o.textContent.trim()));
  ok(regOpts.join('|') === 'Não é professor (só coordena)|Professor', 'cadastro pelo convite de coordenador: sem Estagiario: ' + regOpts.join(' | '));
  await p.fill('#regPassword', '123456'); await p.check('#regAcceptTerms'); await p.click('#registerSubmit'); await p.waitForFunction(() => document.getElementById('appNav') && document.getElementById('appNav').style.display === 'block', null, { timeout: 15000 });
  ok(true, 'coordenador sem funcao conclui o cadastro pelo link'); await p.close();
  await browser.close(); console.log(fails ? `\n${fails} FALHA(S)` : '\nTUDO OK'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

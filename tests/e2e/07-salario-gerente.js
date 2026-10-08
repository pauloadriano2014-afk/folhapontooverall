// Teste de ponta a ponta (Playwright). Veja tests/README ou o README do projeto para rodar.
const { chromium } = require('playwright');
const API = 'https://ponto-overall-api.onrender.com', LOCAL = process.env.TEST_API_URL || 'http://localhost:3111', APP = process.env.TEST_APP_URL || 'http://localhost:8088/index.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const api = async (path, method = 'GET', body, token) => { if (path === '/api/register' && body && body.acceptTerms === undefined) body = { ...body, acceptTerms: true }; const r = await fetch(LOCAL + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, b: await r.json().catch(() => null) }; };
const U = Date.now().toString(36).slice(-5); const E = n => `${n}${U}@x.com`;
async function dev(browser, vp = { width: 1280, height: 800 }) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: vp, acceptDownloads: true });
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
  await sleep(1200); await page.evaluate(() => closeOverlays()); await sleep(200);
}
const items = p => p.evaluate(() => [...document.querySelectorAll('#appNav .nav-item:not([hidden])')].map(b => b.dataset.view || b.id));
const rowText = (p, name) => p.evaluate(n => { const r = [...document.querySelectorAll('#companyStaffList .client-row')].find(x => x.textContent.includes(n)); return r ? r.innerText.replace(/\s+/g, ' ') : null; }, name);
(async () => {
  console.log('== API: salario do gerente ==');
  const owner = (await api('/api/register', 'POST', { accountType: 'empresa', companyName: 'Gym ' + U, name: 'Dona', email: E('dona'), password: '123456' })).b;
  const code = (await api('/api/company/overview', 'GET', null, owner.token)).b.company.inviteCode;
  const mk = async (n, role) => (await api('/api/register', 'POST', { name: n, email: E(n.toLowerCase()), password: '123456', role, inviteCode: code })).b;
  const g1 = await mk('Gilda', 'Professor'), g2 = await mk('Gabi', 'Professor'), soc = await mk('Sonia', 'Professor'), ana = await mk('Ana', 'Professor'), teo = await mk('Teo', 'Estagiário');
  let r = await api(`/api/company/staff/${g1.user.id}/access`, 'PUT', { accessRole: 'manager', monthlySalary: 4200 }, owner.token); ok(r.s === 200 && r.b.changed, 'dono promove Gilda a gerente com salario 4200');
  r = await api(`/api/company/staff/${g2.user.id}/access`, 'PUT', { accessRole: 'manager', monthlySalary: '3100,5'.replace(',', '.') }, owner.token); ok(r.s === 200, 'dono promove Gabi a gerente com salario 3100.5');
  await api(`/api/company/staff/${soc.user.id}/access`, 'PUT', { accessRole: 'partner' }, owner.token);
  const sal = (ov, id) => ov.b.staff.find(s => s.id === id).monthlySalary;
  let ov = await api('/api/company/overview', 'GET', null, owner.token); ok(sal(ov, g1.user.id) === 4200 && sal(ov, g2.user.id) === 3100.5, 'dono ve o salario dos dois gerentes');
  ov = await api('/api/company/overview', 'GET', null, soc.token); ok(sal(ov, g1.user.id) === 4200 && sal(ov, g2.user.id) === 3100.5, 'socio ve o salario dos dois gerentes');
  ov = await api('/api/company/overview', 'GET', null, g1.token); ok(sal(ov, g1.user.id) === 4200 && sal(ov, g2.user.id) === null, 'gerente ve so o proprio salario (nao o do outro)');
  r = await api(`/api/company/staff/${g2.user.id}/access`, 'PUT', { monthlySalary: 9999 }, g1.token); ok(r.s === 403, 'gerente NAO define salario de ninguem');
  r = await api(`/api/company/staff/${g1.user.id}/access`, 'PUT', { monthlySalary: 99999 }, g1.token); ok(r.s === 400 || r.s === 403, 'gerente nao aumenta o proprio salario');
  r = await api(`/api/company/staff/${g1.user.id}/access`, 'PUT', { accessRole: 'manager', monthlySalary: -5 }, owner.token); ok(r.s === 400, 'salario negativo e recusado');
  r = await api(`/api/company/staff/${g1.user.id}/access`, 'PUT', { accessRole: 'manager', monthlySalary: 'abc' }, owner.token); ok(r.s === 400, 'salario nao numerico e recusado');
  r = await api(`/api/company/staff/${ana.user.id}/access`, 'PUT', { accessRole: 'staff', monthlySalary: 1000 }, owner.token);
  ov = await api('/api/company/overview', 'GET', null, owner.token); ok(sal(ov, ana.user.id) === null, 'salario enviado para quem nao e gerente nao vale');
  r = await api(`/api/company/staff/${g2.user.id}/access`, 'PUT', { accessRole: 'manager', monthlySalary: 3500 }, owner.token);
  let au = await api('/api/company/audit', 'GET', null, owner.token); const txt = JSON.stringify(au.b.entries);
  ok(txt.includes('salário mensal alterado') && !txt.includes('3500') && !txt.includes('4200') && !txt.includes('3100'), 'historico registra a mudanca de salario SEM mostrar o valor');
  r = await api(`/api/company/staff/${g2.user.id}/access`, 'PUT', { accessRole: 'coordinator' }, owner.token);
  ov = await api('/api/company/overview', 'GET', null, owner.token); ok(sal(ov, g2.user.id) === null, 'quem deixa de ser gerente perde o salario fixo');

  console.log('== API: modulo personal ==');
  r = await api('/api/me/personal-module', 'PUT', { enabled: true }, teo.token); ok(r.s === 403, 'estagiario nao liga o modulo');
  r = await api('/api/me/personal-module', 'PUT', { enabled: true }, owner.token); ok(r.s === 403, 'dono nao liga o modulo (so gerente)');
  r = await api('/api/me/personal-module', 'PUT', { enabled: true }, g1.token); ok(r.s === 200 && r.b.personalModule === true, 'gerente liga o modulo');
  ok((await api('/api/me', 'GET', null, g1.token)).b.user.personalModule === true, '/api/me devolve personalModule');
  await api('/api/state', 'PUT', { settings: {}, months: {}, clients: [{ id: 'x', name: 'Aluno Secreto do Gerente', rate: 200 }] }, g1.token);
  ov = await api('/api/company/overview', 'GET', null, owner.token); ok(!JSON.stringify(ov.b).includes('Aluno Secreto'), 'dono NAO ve os alunos particulares do gerente');
  ov = await api('/api/company/overview', 'GET', null, soc.token); ok(!JSON.stringify(ov.b).includes('Aluno Secreto'), 'socio NAO ve os alunos particulares do gerente');

  console.log('== Tela ==');
  const browser = await chromium.launch();
  let p = await dev(browser); await login(p, E('dona'));
  await p.click('.nav-item[data-view=equipe]'); await sleep(500);
  let t = await rowText(p, 'Gilda'); ok(/R\$\s*4\.200,00/.test(t), 'Equipe e valores mostra o salario da Gilda: ' + t);
  ok(/Gerente/.test(t), 'identificada como Gerente');
  const total = await p.textContent('#companyMonthTotal'); ok(/4\.200,00/.test(total), 'total da equipe inclui o salario: ' + total);
  await p.click('.nav-item[data-view=gestao]'); await sleep(500);
  await p.evaluate(() => [...document.querySelectorAll('#teamManageList .client-row')].find(r => r.textContent.includes('Gilda')).querySelector('button').click()); await sleep(300);
  ok(await p.evaluate(() => document.getElementById('staffEditSalaryWrap').style.display !== 'none' && document.getElementById('staffEditSalary').value === '4200'), 'janela de edicao mostra o salario atual (4200) para o dono');
  await p.fill('#staffEditSalary', '4800'); await p.click('#staffEditSave'); await sleep(900);
  await p.click('.nav-item[data-view=equipe]'); await sleep(400);
  t = await rowText(p, 'Gilda'); ok(/4\.800,00/.test(t), 'salario atualizado na lista: ' + t);
  await p.evaluate(() => [...document.querySelectorAll('#teamManageList .client-row')].find(r => r.textContent.includes('Ana')).querySelector('button').click()); await sleep(300);
  ok(await p.evaluate(() => document.getElementById('staffEditSalaryWrap').style.display === 'none'), 'campo de salario some para quem nao e gerente');
  await p.click('#staffEditAccessGrid input[value=manager]'); ok(await p.evaluate(() => document.getElementById('staffEditSalaryWrap').style.display !== 'none'), 'campo de salario aparece ao escolher Gerente'); await p.close();

  p = await dev(browser); await login(p, E('sonia')); await p.click('.nav-item[data-view=equipe]'); await sleep(500);
  t = await rowText(p, 'Gilda'); ok(/4\.800,00/.test(t), 'socio ve o salario da Gilda na tela'); await p.close();

  console.log('-- gerente com modulo --');
  p = await dev(browser); await login(p, E('gilda'));
  const nav = await items(p); ok(nav.includes('clientes') && nav.includes('gestao') && nav.includes('equipe'), 'gerente com modulo tem Alunos particulares no menu: ' + nav.join(','));
  t = await rowText(p, 'Gilda') || (await p.click('.nav-item[data-view=equipe]'), await sleep(400), await rowText(p, 'Gilda')); ok(/4\.800,00/.test(t), 'gerente ve o proprio salario');
  await p.click('.nav-item[data-view=clientes]'); await sleep(500);
  ok(await p.evaluate(() => { const c = document.getElementById('clientsCard'); return !!c && c.offsetParent !== null; }), 'tela de alunos particulares aparece');
  ok(await p.evaluate(() => [...document.querySelectorAll('#companyDashboard .month-only')].some(e => e.offsetParent !== null)), 'seletor de mes aparece na tela de particulares');
  await p.evaluate(() => document.getElementById('btnAddClient').click()); await sleep(300);
  await p.fill('#clientName', 'Helena Particular'); await p.fill('#clientRate', '180'); await p.check('#clientDaysGrid input >> nth=1'); await p.click('#clientSave'); await sleep(900);
  ok((await p.textContent('#clientsList')).includes('Helena Particular'), 'gerente cadastra aluno particular');
  await sleep(1500);
  const st = await api('/api/state', 'GET', null, g1.token); ok(JSON.stringify(st.b.data).includes('Helena Particular'), 'aluno sincronizou na conta do gerente');
  ov = await api('/api/company/overview', 'GET', null, owner.token); ok(!JSON.stringify(ov.b).includes('Helena'), 'dono continua sem ver o aluno novo');
  await p.click('.nav-item[data-view=exportacao]'); await sleep(400);
  ok(await p.evaluate(() => ['exportCard', 'companyExportCard'].every(id => document.getElementById(id).offsetParent !== null)), 'exportacao mostra equipe e particulares');
  ok(await p.evaluate(() => document.getElementById('exportGradeGroup').offsetParent === null && document.getElementById('exportClientsGroup').offsetParent !== null), 'gerente: sem horas e salario, com exportacao dos particulares');
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), p.click('#btnExportClientsXlsx')]); ok(/\.xlsx$/.test(dl.suggestedFilename()), 'Excel dos particulares baixa sem erro: ' + dl.suggestedFilename());
  await p.screenshot({ path: 'shots/s01-gerente-modulo.png' });
  ok(p.errors.length === 0, 'sem erros de JS ' + p.errors.join('|'));
  // desligar pela conta
  await p.click('#btnAccount'); await sleep(300); ok(await p.evaluate(() => document.getElementById('personalModuleSection').style.display !== 'none' && document.getElementById('personalModuleToggle').checked), 'Minha conta mostra o modulo ligado');
  await p.click('#personalModuleToggle'); await p.waitForLoadState('load'); await sleep(2500);
  await p.waitForFunction(() => document.getElementById('appNav').style.display === 'block', null, { timeout: 10000 }); await sleep(800);
  ok(!(await items(p)).includes('clientes'), 'ao desligar, a tela de particulares sai do menu'); await p.close();

  console.log('-- gerente sem modulo e Minha conta --');
  p = await dev(browser); await login(p, E('teo')); await p.click('#btnAccount'); await sleep(300);
  ok(await p.evaluate(() => document.getElementById('personalModuleSection').style.display === 'none' || document.getElementById('personalModuleSection').offsetParent === null), 'estagiario nao ve a opcao do modulo'); await p.close();
  await browser.close(); console.log(fails ? `\n${fails} FALHA(S)` : '\nTUDO OK'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

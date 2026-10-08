// Teste de ponta a ponta (Playwright). Veja tests/README ou o README do projeto para rodar.
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const API = 'https://ponto-overall-api.onrender.com', LOCAL = process.env.TEST_API_URL || 'http://localhost:3111', APP = process.env.TEST_APP_URL || 'http://localhost:8088/index.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const api = async (path, method = 'GET', body, token) => { if (path === '/api/register' && body && body.acceptTerms === undefined) body = { ...body, acceptTerms: true }; const r = await fetch(LOCAL + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, b: await r.json().catch(() => null) }; };
const U = Date.now().toString(36).slice(-5); const E = n => `${n}${U}@x.com`;
const TOOLS = require('path').resolve(__dirname, '../tools'); const S = process.cwd();
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
const dump = f => execSync(`python3 ${TOOLS}/xlsxdump.py "${f}"`).toString();
(async () => {
  console.log('== API: personal virou modulo do professor ==');
  const owner = (await api('/api/register', 'POST', { accountType: 'empresa', companyName: 'Gym ' + U, name: 'Dona', email: E('dona'), password: '123456' })).b;
  const code = () => api('/api/company/overview', 'GET', null, owner.token).then(r => r.b.company.inviteCode);
  const reg = async (n, role) => api('/api/register', 'POST', { name: n, email: E(n.toLowerCase()), password: '123456', role, inviteCode: await code() });
  let r = await reg('Paulo', 'Personal Trainer'); const paulo = r.b;
  ok(r.s === 200 && paulo.user.role === 'Professor' && paulo.user.personalModule === true, 'cadastro como "Personal Trainer" vira Professor com o modulo ligado');
  r = await reg('Falso', 'Faxineiro'); ok(r.s === 400 && r.b.error === 'invalid_role', 'funcao inexistente e recusada');
  r = await reg('Teo', 'Estagiario'); const teo = r.b; ok(r.s === 200 && teo.user.role === 'Estagiário' && teo.user.personalModule === false, 'funcao sem acento vira "Estagiário"');
  const prof = (await reg('Lia', 'Professor')).b; ok(prof.user.personalModule === false, 'professor comum comeca com o modulo desligado');
  let ov = await api('/api/company/overview', 'GET', null, owner.token);
  ok(ov.b.staff.some(s => s.name === 'Paulo' && s.role === 'Professor'), 'quem veio como personal aparece na equipe como Professor (nao ha mais personal invisivel)');
  await api('/api/state', 'PUT', { settings: {}, months: {}, clients: [{ id: 'z', name: 'Aluno Secreto da Lia', rate: 150 }] }, prof.token);
  ov = await api('/api/company/overview', 'GET', null, owner.token); ok(!JSON.stringify(ov.b).includes('Aluno Secreto'), 'alunos particulares continuam invisiveis para o dono');
  r = await api('/api/company/invite', 'POST', { name: 'Novo', email: E('novo'), role: 'Personal Trainer', accessRole: 'staff' }, owner.token);
  const invs = await api('/api/company/invites', 'GET', null, owner.token); ok(invs.b.invites.find(i => i.name === 'Novo').role === 'Professor', 'convite como personal fica Professor');
  r = await api('/api/company/invite', 'POST', { name: 'X', email: E('x'), role: 'Cozinheiro', accessRole: 'staff' }, owner.token); ok(r.s === 400, 'convite com funcao invalida e recusado');
  r = await api(`/api/company/staff/${prof.user.id}/access`, 'PUT', { role: 'Personal' }, owner.token); ok(r.s === 200, 'editar funcao para "Personal" vira Professor (sem erro)');
  r = await api(`/api/company/staff/${prof.user.id}/access`, 'PUT', { role: 'Zelador' }, owner.token); ok(r.s === 400, 'editar para funcao invalida e recusado');

  console.log('== API: quem pode ligar o modulo ==');
  const coord = (await reg('Cora', 'Professor')).b; await api(`/api/company/staff/${coord.user.id}/access`, 'PUT', { accessRole: 'coordinator' }, owner.token);
  const ger = (await reg('Gil', 'Professor')).b; await api(`/api/company/staff/${ger.user.id}/access`, 'PUT', { accessRole: 'manager' }, owner.token);
  const soc = (await reg('Sol', 'Professor')).b; await api(`/api/company/staff/${soc.user.id}/access`, 'PUT', { accessRole: 'partner' }, owner.token);
  const on = t => api('/api/me/personal-module', 'PUT', { enabled: true }, t).then(x => x.s);
  ok(await on(prof.token) === 200, 'professor liga'); ok(await on(coord.token) === 200, 'coordenador liga'); ok(await on(ger.token) === 200, 'gerente liga');
  ok(await on(teo.token) === 403, 'estagiario NAO liga'); ok(await on(owner.token) === 403, 'dono NAO liga'); ok(await on(soc.token) === 403, 'socio NAO liga');

  console.log('== API: convite e salario ==');
  r = await api('/api/company/invite', 'POST', { name: 'Gerente2', email: E('g2'), accessRole: 'manager' }, ger.token); ok(r.s === 403, 'gerente NAO convida outro gerente');
  r = await api('/api/company/invite', 'POST', { name: 'Socio2', email: E('s2'), accessRole: 'partner' }, ger.token); ok(r.s === 403, 'gerente NAO convida socio');
  r = await api('/api/company/invite', 'POST', { name: 'Coord2', email: E('c2'), role: 'Professor', accessRole: 'coordinator' }, ger.token); ok(r.s === 200, 'gerente convida coordenador');
  r = await api('/api/company/invite', 'POST', { name: 'Gerente3', email: E('g3'), accessRole: 'manager', monthlySalary: 5200 }, owner.token); ok(r.s === 200, 'dono convida gerente com salario');
  const tok = r.b.inviteLink.split('invite=')[1];
  r = await api('/api/company/invite', 'POST', { name: 'Prof3', email: E('p3'), role: 'Professor', accessRole: 'staff', monthlySalary: 999 }, owner.token); const tok2 = r.b.inviteLink.split('invite=')[1];
  r = await api('/api/company/invite', 'POST', { name: 'Gerente4', email: E('g4'), accessRole: 'manager', monthlySalary: -1 }, owner.token); ok(r.s === 400, 'salario invalido no convite e recusado');
  const g3 = (await api('/api/register', 'POST', { name: 'Gerente3', email: E('g3'), password: '123456', inviteToken: tok })).b;
  const p3 = (await api('/api/register', 'POST', { name: 'Prof3', email: E('p3'), password: '123456', role: 'Professor', inviteToken: tok2 })).b;
  ov = await api('/api/company/overview', 'GET', null, owner.token);
  ok(ov.b.staff.find(s => s.id === g3.user.id).monthlySalary === 5200, 'quem entrou pelo convite ja tem o salario combinado (5200)');
  ok(ov.b.staff.find(s => s.id === p3.user.id).monthlySalary === null, 'salario enviado no convite de profissional comum e ignorado');
  ov = await api('/api/company/overview', 'GET', null, ger.token); ok(ov.b.staff.find(s => s.id === g3.user.id).monthlySalary === null, 'um gerente nao ve o salario de outro');

  console.log('== Tela: professor liga o modulo ==');
  const browser = await chromium.launch();
  let p = await dev(browser); await login(p, E('lia'));
  let nav = await items(p); ok(nav.includes('clientes'), 'professora que ligou o modulo (via API) ja ve Alunos particulares no menu: ' + nav.join(','));
  await p.close();
  // Lia ainda nao ligou; Cora/Paulo ja ligaram. Usa uma professora nova para o fluxo completo
  const nova = (await reg('Nina', 'Professor')).b;
  p = await dev(browser); await login(p, E('nina'));
  nav = await items(p); ok(!nav.includes('clientes') && nav.includes('grade') && !nav.includes('vip'), 'professora nova: sem Alunos particulares e sem VIP no menu');
  await p.click('.nav-item[data-view=exportacao]'); await sleep(400);
  ok(await p.evaluate(() => document.getElementById('exportGradeGroup').offsetParent !== null && document.getElementById('exportClientsGroup').offsetParent === null), 'exportacao: so horas e salario (sem particulares)');
  await p.click('#btnAccount'); await sleep(300);
  ok(await p.evaluate(() => document.getElementById('personalModuleSection').offsetParent !== null), 'Minha conta oferece o modulo de alunos particulares');
  await p.click('#personalModuleToggle'); await sleep(2500);
  await p.waitForFunction(() => document.getElementById('appNav').style.display === 'block', null, { timeout: 10000 }); await sleep(900); await p.evaluate(() => closeOverlays());
  nav = await items(p); ok(nav.includes('clientes'), 'ligou o modulo: menu ganhou Alunos particulares');
  await p.click('.nav-item[data-view=clientes]'); await sleep(400);
  ok(await p.evaluate(() => document.getElementById('clientScheduleWrap').offsetParent !== null), 'grade semanal dos particulares aparece');
  for (const [n, rate, d] of [['Helena Souza', '150', 1], ['Rui Gomes', '120', 2]]) {
    await p.evaluate(() => document.getElementById('btnAddClient').click()); await sleep(300);
    await p.fill('#clientName', n); await p.fill('#clientRate', rate); await p.fill('#clientTime', '07:00'); await p.check(`#clientDaysGrid input >> nth=${d}`); await p.click('#clientSave'); await sleep(700);
  }
  await p.click('.nav-item[data-view=exportacao]'); await sleep(400);
  ok(await p.evaluate(() => document.getElementById('exportClientsGroup').offsetParent !== null), 'exportacao agora tem o grupo Alunos particulares');
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), p.click('#btnExportClientsXlsx')]);
  const f = S + '/clientes.xlsx'; await dl.saveAs(f); const txt = dump(f); console.log(txt.split('\n').map(l => '   ' + l).join('\n'));
  ok(/alunos-particulares-\d{4}-\d{2}\.xlsx/.test(dl.suggestedFilename()), 'Excel dos particulares: ' + dl.suggestedFilename());
  ok(txt.includes('Helena Souza') && txt.includes('Rui Gomes') && txt.includes('TOTAL DO MÊS'), 'planilha tem os alunos e o total');
  // PDF: stub do print para inspecionar o que sairia na impressao
  await p.emulateMedia({ media: 'print' });
  await p.evaluate(() => { window.print = () => { window.__p = { sheet: getComputedStyle(document.getElementById('clientsPrintSheet')).display, hidden: ['mainDashboard', 'appNav', 'companyDashboard'].map(id => getComputedStyle(document.getElementById(id)).display), text: document.getElementById('clientsPrintSheet').innerText }; }; });
  await p.evaluate(() => document.getElementById('btnExportClientsPdf').click()); await sleep(500);
  const pr = await p.evaluate(() => window.__p); ok(pr && pr.sheet === 'block' && pr.hidden.every(d => d === 'none'), 'PDF dos particulares: so a folha propria aparece na impressao');
  ok(pr.text.includes('Helena Souza') && pr.text.includes('Total do mês'), 'folha do PDF tem os alunos e o total');
  // gera o PDF de verdade para conferir visualmente
  await p.evaluate(() => document.body.classList.add('print-clients')); await p.pdf({ path: S + '/clientes.pdf', format: 'A4', margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' } });
  try { execSync(`pdftoppm -png -r 60 -f 1 -l 1 ${S}/clientes.pdf ${S}/shots/pdf-clientes`); } catch (e) { console.log('   (pdftoppm indisponivel, pulando a imagem do PDF)'); } console.log('   pdf -> shots/pdf-clientes-1.png');
  ok(!(await p.evaluate(() => document.body.classList.contains('print-team'))), 'classe de impressao nao vaza'); 
  ok(p.errors.length === 0, 'sem erros de JS ' + p.errors.join('|')); await p.close();

  console.log('== Tela: convite com salario / dono exporta equipe ==');
  p = await dev(browser); await login(p, E('dona')); await sleep(600);
  await p.click('.nav-item[data-view=convites]'); await p.evaluate(() => document.getElementById('btnOpenInvite').click()); await sleep(300);
  ok(await p.evaluate(() => document.getElementById('inviteSalaryWrap').style.display === 'none'), 'convite de profissional: sem campo de salario');
  await p.click('input[name=inviteAccessRole][value=manager]'); ok(await p.evaluate(() => document.getElementById('inviteSalaryWrap').style.display !== 'none'), 'convite de gerente: campo de salario aparece (dono)');
  await p.screenshot({ path: 'shots/p01-convite-gerente.png' }); await p.evaluate(() => closeOverlays());
  ok(await p.evaluate(() => [...document.querySelectorAll('#inviteRole option')].map(o => o.value).join('|') === '|Estagiário|Professor'), 'funcoes do convite: so Estagiario e Professor');
  await p.click('.nav-item[data-view=exportacao]'); await sleep(400);
  const [dl2] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), p.click('#btnCompanyExport')]);
  const f2 = S + '/equipe.xlsx'; await dl2.saveAs(f2); const t2 = dump(f2); console.log(t2.split('\n').map(l => '   ' + l).join('\n'));
  ok(/equipe-overall-\d{4}-\d{2}\.xlsx/.test(dl2.suggestedFilename()) && t2.includes('Paulo') && t2.includes('Gerente3') && t2.includes('TOTAL'), 'Excel da equipe tem a equipe e o total');
  ok(/5200/.test(t2), 'Excel da equipe traz o salario do gerente (5200)');
  await p.emulateMedia({ media: 'print' });
  await p.evaluate(() => { window.print = () => { window.__t = { sheet: getComputedStyle(document.getElementById('teamPrintSheet')).display, text: document.getElementById('teamPrintSheet').innerText, others: ['mainDashboard', 'companyDashboard', 'appNav'].map(id => getComputedStyle(document.getElementById(id)).display) }; }; });
  await p.evaluate(() => document.getElementById('btnCompanyExportPdf').click()); await sleep(500);
  const tp = await p.evaluate(() => window.__t); ok(tp && tp.sheet === 'block' && tp.others.every(d => d === 'none') && tp.text.includes('Paulo') && /Total da equipe/.test(tp.text), 'PDF da equipe: so a folha propria, com a equipe e o total');
  await p.evaluate(() => document.body.classList.add('print-team')); await p.pdf({ path: S + '/equipe.pdf', format: 'A4', margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' } });
  try { execSync(`pdftoppm -png -r 60 -f 1 -l 1 ${S}/equipe.pdf ${S}/shots/pdf-equipe`); } catch (e) { console.log('   (pdftoppm indisponivel, pulando a imagem do PDF)'); }
  ok(p.errors.length === 0, 'sem erros de JS ' + p.errors.join('|')); await p.close();
  await browser.close(); console.log(fails ? `\n${fails} FALHA(S)` : '\nTUDO OK'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

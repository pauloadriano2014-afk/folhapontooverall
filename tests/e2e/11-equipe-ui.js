// Teste de ponta a ponta (Playwright). Veja tests/README ou o README do projeto para rodar.
const { chromium } = require('playwright');
const API = 'https://ponto-overall-api.onrender.com', LOCAL = process.env.TEST_API_URL || 'http://localhost:3111', APP = process.env.TEST_APP_URL || 'http://localhost:8088/index.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const api = async (path, method = 'GET', body, token) => { if (path === '/api/register' && body && body.acceptTerms === undefined) body = { ...body, acceptTerms: true }; const r = await fetch(LOCAL + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, b: await r.json().catch(() => null) }; };
const uniq = Date.now().toString(36);
async function dev(browser, opts = {}) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: opts.vp || { width: 1280, height: 800 }, userAgent: opts.ua });
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
  await sleep(900); await page.evaluate(() => closeOverlays()); await sleep(200);
}
const items = p => p.evaluate(() => [...document.querySelectorAll('#appNav .nav-item:not([hidden])')].map(b => b.dataset.view || b.id));
(async () => {
  const browser = await chromium.launch();
  const owner = (await api('/api/register', 'POST', { accountType: 'empresa', companyName: 'Gym ' + uniq, name: 'Dona UI', email: `dona${uniq}@x.com`, password: '123456' })).b;
  const code = (await api('/api/company/overview', 'GET', null, owner.token)).b.company.inviteCode;
  const mk = async (n, role) => { const c = (await api('/api/company/overview', 'GET', null, owner.token)).b.company.inviteCode; return (await api('/api/register', 'POST', { name: n, email: `${n.toLowerCase()}${uniq}@x.com`, password: '123456', role, inviteCode: c })).b; };
  const ana = await mk('Ana', 'Professor'), beto = await mk('Beto', 'Estagiário'); await mk('Paulo', 'Personal Trainer');
  const E = n => `${n.toLowerCase()}${uniq}@x.com`;

  console.log('== dono: menu, tema e gestao ==');
  let p = await dev(browser); await login(p, `dona${uniq}@x.com`);
  ok((await items(p)).includes('gestao'), 'dono tem "Gestão da equipe" no menu');
  ok(await p.evaluate(() => !document.querySelector('header #btnTheme') && !!document.querySelector('#appNav #btnTheme')), 'botao de tema agora esta no menu lateral (nao no topo)');
  const t0 = await p.evaluate(() => document.documentElement.getAttribute('data-theme'));
  await p.click('#btnTheme'); await p.click('#modeSwitch [data-mode=light]'); const t1 = await p.evaluate(() => document.documentElement.getAttribute('data-theme'));
  ok(t0 !== t1, `tema alterna pela janela Tema e cores (${t0} -> ${t1})`);
  await p.click('#modeSwitch [data-mode=dark]'); await p.evaluate(() => closeOverlays());
  await p.click('.nav-item[data-view=gestao]'); await sleep(600);
  const names = await p.evaluate(() => [...document.querySelectorAll('#teamManageList .client-row strong')].map(e => e.textContent));
  ok(names.slice().sort().join() === 'Ana,Beto,Dona UI (você),Paulo', 'lista de gestao (Paulo, que entrou como personal, agora e Professor): ' + names.join(', '));
  ok(await p.evaluate(() => document.querySelectorAll('#teamManageList .client-row button').length) === 3, 'dono nao tem botao Editar nele mesmo');
  await p.screenshot({ path: 'shots/g01-gestao.png' });

  // editar Beto -> coordenador
  await p.evaluate(() => [...document.querySelectorAll('#teamManageList .client-row')].find(r => r.textContent.includes('Beto')).querySelector('button').click()); await sleep(300);
  await p.screenshot({ path: 'shots/g02-editar.png' });
  ok((await p.evaluate(() => [...document.querySelectorAll('#staffEditAccessGrid label')].map(l => l.textContent.trim()))).join() === 'Profissional,Coordenador(a),Gerente,Sócio(a)', 'dono ve os 4 niveis para atribuir');
  await p.click('#staffEditAccessGrid input[value=coordinator]'); await p.selectOption('#staffEditRole', 'Professor'); await p.click('#staffEditSave'); await sleep(900);
  ok((await api('/api/me', 'GET', null, beto.token)).b.user.companyRole === 'coordinator', 'Beto virou coordenador pelo painel');
  ok(await p.evaluate(() => document.getElementById('teamManageList').textContent.includes('Coordenador(a)')), 'lista atualizou sem recarregar');

  // Ana (professora) esta com a sessao aberta enquanto e removida
  const pa = await dev(browser); await login(pa, E('Ana'));
  ok(await pa.evaluate(() => !!currentUser.companyId), 'Ana logada, ligada a academia');
  await p.evaluate(() => [...document.querySelectorAll('#teamManageList .client-row')].find(r => r.textContent.includes('Ana')).querySelector('button').click()); await sleep(300);
  await p.click('#btnStaffRemove'); await sleep(1200);
  ok(!(await p.evaluate(() => document.getElementById('teamManageList').textContent)).includes('Ana'), 'Ana saiu da lista depois de remover');
  await pa.evaluate(() => { lastUserCheck = 0; document.dispatchEvent(new Event('visibilitychange')); });
  await pa.waitForFunction(() => document.getElementById('authScreen').style.display === 'none' && document.getElementById('appNav').style.display === 'block', null, { timeout: 10000 }); await sleep(1500);
  ok(await pa.evaluate(() => currentUser.companyId === null), 'aparelho da Ana percebeu a remocao e recarregou sem academia');
  ok(pa.errors.length === 0, 'sem erros de JS no aparelho da Ana ' + pa.errors.join('|'));

  await p.click('.nav-item[data-view=gestao]'); await sleep(800);
  const hist = await p.evaluate(() => [...document.querySelectorAll('#teamAuditList .client-row strong')].map(e => e.textContent));
  console.log('   historico:', hist.join(' | '));
  ok(hist.some(h => h.includes('removeu Ana')) && hist.some(h => h.includes('alterou Beto')), 'historico mostra as duas acoes');
  await p.screenshot({ path: 'shots/g03-historico.png', fullPage: true });

  // codigo novo
  await p.click('.nav-item[data-view=convites]'); const before = await p.inputValue('#companyInviteCodeDisplay');
  await p.click('#btnRotateInviteCode'); await sleep(900); const after = await p.inputValue('#companyInviteCodeDisplay');
  ok(before !== after && after.length === 6, `codigo mudou na tela (${before} -> ${after})`);
  ok(p.errors.length === 0, 'sem erros de JS no painel ' + p.errors.join('|')); await p.close();

  console.log('== gerente: so alcança coordenador e profissional ==');
  await api(`/api/company/staff/${beto.user.id}/access`, 'PUT', { accessRole: 'manager' }, owner.token);
  const cam = await mk('Caio', 'Professor'); const cc = await api('/api/login', 'POST', { email: E('Caio'), password: '123456' });
  p = await dev(browser); await login(p, E('Beto'));
  ok((await items(p)).includes('gestao'), 'gerente tem "Gestão da equipe"');
  await p.click('.nav-item[data-view=gestao]'); await sleep(800);
  const rows = await p.evaluate(() => [...document.querySelectorAll('#teamManageList .client-row')].map(r => r.querySelector('strong').textContent + ':' + r.querySelectorAll('button').length));
  ok(rows.some(r => r.startsWith('Dona UI') && r.endsWith(':0')) && rows.some(r => r.startsWith('Caio') && r.endsWith(':1')), 'gerente nao tem Editar no dono, tem no Caio: ' + rows.join(', '));
  await p.evaluate(() => [...document.querySelectorAll('#teamManageList .client-row')].find(r => r.textContent.includes('Caio')).querySelector('button').click()); await sleep(300);
  ok((await p.evaluate(() => [...document.querySelectorAll('#staffEditAccessGrid label')].map(l => l.textContent.trim()))).join() === 'Profissional,Coordenador(a)', 'gerente so pode atribuir Profissional/Coordenador(a)'); await p.close();

  console.log('== socio nao ve a gestao ==');
  await api(`/api/company/staff/${cam.user.id}/access`, 'PUT', { accessRole: 'partner' }, owner.token);
  p = await dev(browser); await login(p, E('Caio'));
  ok(!(await items(p)).includes('gestao') && !(await items(p)).includes('convites'), 'socio sem Gestao nem Convites'); await p.close();

  console.log('== aviso de instalar: so no celular ==');
  p = await dev(browser); await login(p, E('Ana'));
  await p.evaluate(() => { const e = new Event('beforeinstallprompt'); e.prompt = () => {}; e.userChoice = Promise.resolve({}); window.dispatchEvent(e); });
  ok(await p.evaluate(() => !document.getElementById('installBanner').classList.contains('show')), 'computador: aviso de instalar NAO aparece'); await p.close();
  p = await dev(browser, { vp: { width: 390, height: 844 }, ua: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36' }); await login(p, E('Ana'));
  await p.evaluate(() => { const e = new Event('beforeinstallprompt'); e.prompt = () => {}; e.userChoice = Promise.resolve({}); window.dispatchEvent(e); });
  ok(await p.evaluate(() => document.getElementById('installBanner').classList.contains('show')), 'celular: aviso de instalar aparece'); await p.close();

  await browser.close(); console.log(fails ? `\n${fails} FALHA(S)` : '\nTUDO OK'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

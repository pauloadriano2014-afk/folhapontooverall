// Teste de ponta a ponta (Playwright). Veja tests/README ou o README do projeto para rodar.
const { chromium } = require('playwright');
const API = 'https://ponto-overall-api.onrender.com', LOCAL = process.env.TEST_API_URL || 'http://localhost:3111', APP = process.env.TEST_APP_URL || 'http://localhost:8088/index.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const api = async (path, method = 'GET', body, token) => { if (path === '/api/register' && body && body.acceptTerms === undefined) body = { ...body, acceptTerms: true }; const r = await fetch(LOCAL + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, b: await r.json().catch(() => null) }; };
const U = Date.now().toString(36).slice(-5); const E = n => `${n}${U}@x.com`;
async function dev(browser, vp = { width: 1280, height: 800 }, init) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: vp, isMobile: vp.width < 600, deviceScaleFactor: 2 });
  if (init) await ctx.addInitScript(init);
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
  await sleep(1300); await page.evaluate(() => closeOverlays()); await sleep(200);
}
const attr = (p, a) => p.evaluate(a => document.documentElement.getAttribute(a), a);
(async () => {
  const owner = (await api('/api/register', 'POST', { accountType: 'empresa', companyName: 'Gym ' + U, name: 'Dona', email: E('dona'), password: '123456' })).b;
  const reg = async (n, role) => api('/api/register', 'POST', { name: n, email: E(n.toLowerCase()), password: '123456', role, inviteCode: (await api('/api/company/overview', 'GET', null, owner.token)).b.company.inviteCode });
  const prof = (await reg('Pri', 'Professor')).b, est = (await reg('Edu', 'Estagiário')).b, adri = (await reg('Adri', 'Estagiária')).b, coord = (await reg('Cora', 'Professor')).b;
  await api(`/api/company/staff/${coord.user.id}/access`, 'PUT', { accessRole: 'coordinator' }, owner.token);
  const browser = await chromium.launch();

  console.log('== celular: chip "Valores rapidos" nao vaza ==');
  let p = await dev(browser, { width: 390, height: 844 }); await login(p, E('pri'));
  const m = await p.evaluate(() => { const b = document.getElementById('btnQuickValuesChip').getBoundingClientRect(); return { right: Math.round(b.right), vw: window.innerWidth, doc: document.documentElement.scrollWidth, lines: Math.round(b.height) }; });
  ok(m.right <= m.vw, `chip termina em ${m.right}px, tela tem ${m.vw}px`); ok(m.doc <= m.vw, `pagina sem rolagem lateral (${m.doc} <= ${m.vw})`);
  await p.screenshot({ path: 'shots/t01-celular-chip.png' }); await p.close();

  console.log('== padrao Overall ==');
  p = await dev(browser); await login(p, E('pri'));
  ok(await attr(p, 'data-color') === 'overall', 'professora nova abre na combinacao Overall'); await p.close();
  p = await dev(browser); await login(p, E('edu')); ok(await attr(p, 'data-color') === 'overall', 'estagiario novo abre na combinacao Overall'); await p.close();

  console.log('== botao Tema abre a janela com modo + cores ==');
  p = await dev(browser); await login(p, E('pri'));
  await p.click('#btnTheme'); await sleep(300);
  ok(await p.evaluate(() => document.getElementById('themeOverlay').classList.contains('open')), 'clicar em Tema abre a janela "Tema e cores"');
  ok(await p.evaluate(() => document.querySelectorAll('#modeSwitch .mode-btn').length === 2 && document.querySelectorAll('#colorSwatches .color-swatch').length === 7), 'tem Escuro/Claro e 7 combinacoes');
  ok(await p.evaluate(() => document.querySelector('#colorSwatches .active').dataset.colorChoice) === 'overall', 'a combinacao Overall aparece marcada');
  await p.screenshot({ path: 'shots/t02-janela-tema.png' });
  await p.click('#modeSwitch [data-mode=light]'); ok(await attr(p, 'data-theme') === 'light', 'botao Claro muda o modo');
  await p.screenshot({ path: 'shots/t03-overall-claro.png' });
  await p.click('#modeSwitch [data-mode=dark]');
  await p.click('#colorSwatches [data-color-choice=roxo]'); await sleep(300);
  ok(await attr(p, 'data-color') === null, 'escolher Roxo troca a combinacao');
  await p.screenshot({ path: 'shots/t04-roxo.png' });
  await sleep(2200);
  const st = await api('/api/state', 'GET', null, prof.token); ok(st.b.data.settings.themeColor === 'roxo', 'a escolha foi salva na conta (sincroniza)');
  await p.close();
  console.log('== a escolha acompanha a conta em outro aparelho ==');
  p = await dev(browser); await login(p, E('pri')); ok(await attr(p, 'data-color') === null, 'outro aparelho (sem nada guardado) abre em Roxo, como escolhido'); await p.close();

  console.log('== quem ja usava roxo continua roxo (Adri) ==');
  p = await dev(browser, { width: 1280, height: 800 }, () => { try { localStorage.setItem('pontoOverallColor_v1', 'roxo'); } catch (e) {} });
  await login(p, E('adri')); ok(await attr(p, 'data-color') === null, 'aparelho com o roxo de antes continua roxo');
  await sleep(2200); const sa = await api('/api/state', 'GET', null, adri.token); ok(sa.b.data.settings.themeColor === 'roxo', 'e a escolha passa a ficar guardada na conta dela'); await p.close();

  console.log('== cargos altos travados na Overall ==');
  p = await dev(browser); await login(p, E('cora'));
  ok(await p.evaluate(() => document.body.classList.contains('brand-view')), 'coordenadora usa o visual Overall (travado)');
  await p.click('#btnTheme'); await sleep(300);
  ok(await p.evaluate(() => document.getElementById('colorSwatches').style.display === 'none' && document.getElementById('brandColorLockedHint').style.display !== 'none'), 'janela dela: so Claro/Escuro, com o aviso das cores da Overall');
  await p.screenshot({ path: 'shots/t05-coord-travada.png' }); await p.close();
  p = await dev(browser); await login(p, E('dona')); await sleep(500);
  ok(await p.evaluate(() => document.body.classList.contains('brand-view')), 'dono usa o visual Overall (travado)');
  await p.click('#btnTheme'); await sleep(300); ok(await p.evaluate(() => document.getElementById('colorSwatches').style.display === 'none'), 'dono nao ve as combinacoes');
  await p.click('#modeSwitch [data-mode=light]'); ok(await attr(p, 'data-theme') === 'light', 'mas troca claro/escuro normalmente');
  ok(p.errors.length === 0, 'sem erros de JS ' + p.errors.join('|')); await p.close();
  await browser.close(); console.log(fails ? `\n${fails} FALHA(S)` : '\nTUDO OK'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

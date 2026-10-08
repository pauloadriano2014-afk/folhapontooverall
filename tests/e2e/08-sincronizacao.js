// Teste de ponta a ponta (Playwright). Veja tests/README ou o README do projeto para rodar.
const { chromium } = require('playwright');
const API = 'https://ponto-overall-api.onrender.com', LOCAL = process.env.TEST_API_URL || 'http://localhost:3111', APP = process.env.TEST_APP_URL || 'http://localhost:8088/index.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const U = Date.now().toString(36); let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const api = async (path, opt = {}, token) => { const r = await fetch(LOCAL + path, { ...opt, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}), ...(opt.headers || {}) } }); return { status: r.status, body: await r.json().catch(() => null) }; };

async function newDevice(browser, name, hooks = {}) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 420, height: 900 } });
  const page = await ctx.newPage(); page.puts = 0; page.name = name;
  await page.route(API + '/**', async route => {
    const req = route.request(); const u = new URL(req.url());
    if (req.method() === 'PUT' && u.pathname === '/api/state') page.puts++;
    if (hooks.failGetState && hooks.failGetState() && u.pathname === '/api/state' && req.method() === 'GET') return route.abort('failed');
    const r = await fetch(LOCAL + u.pathname + u.search, { method: req.method(), headers: req.headers(), body: req.postData() || undefined });
    const h = {}; r.headers.forEach((v, k) => { if (!['content-encoding', 'content-length', 'transfer-encoding'].includes(k)) h[k] = v; });
    route.fulfill({ status: r.status, headers: h, body: Buffer.from(await r.arrayBuffer()) });
  });
  await page.goto(APP);
  await page.fill('#loginEmail', 'bia'+U+'@x.com'); await page.fill('#loginPassword', '123456'); await page.click('#loginSubmit');
  await page.waitForFunction(() => document.getElementById('authScreen').style.display === 'none' && ['Sincronizado','Sem conexão'].includes(document.getElementById('syncLabel').textContent), null, { timeout: 15000 });
  return page;
}

(async () => {
  const reg = await api('/api/register', { method: 'POST', body: JSON.stringify({ acceptTerms: true, name: 'Bia', email: 'bia'+U+'@x.com', password: '123456', role: 'Estagiário' }) });
  const token = reg.body.token || (await api('/api/login', { method: 'POST', body: JSON.stringify({ email: 'bia'+U+'@x.com', password: '123456' }) })).body.token;
  const T0 = '2026-10-01T10:00:00.000Z';
  const seed = { version: 1, updatedAt: T0, settings: { defaultAuxilio: 0, quickValues: [10, 15], reminderEnabled: false, reminderTime: '21:00', weekendShiftEnabled: false, timeSlots: ['17:00–18:00','18:00–19:00','19:00–20:00','20:00–21:00','21:00–22:00','22:00–23:00'] },
    months: { '2026-10': { auxilio: 0, consumo: 0, obs: '', paid: false, days: { '2026-10-05': { note: '', shift: null, slots: [10, null, null, null, null, null] } } } },
    vip: { slots: [], attendance: {} }, clients: [] };
  await api('/api/state', { method: 'PUT', headers: {}, body: JSON.stringify(seed) }, token);
  const browser = await chromium.launch();

  console.log('\n== 1) aparelho novo + servidor fora do ar na abertura: NAO pode apagar dados ==');
  let failing = true;
  const dev2 = await newDevice(browser, 'dev2', { failGetState: () => failing });
  await sleep(1500);
  ok(dev2.puts === 0, 'nenhum PUT enviado enquanto nao conseguiu ler o servidor (puts=' + dev2.puts + ')');
  ok((await dev2.textContent('#syncLabel')) === 'Sem conexão', 'indicador mostra "Sem conexão"');
  let srv = await api('/api/state', {}, token);
  ok(srv.body.data.months['2026-10'].days['2026-10-05'].slots[0] === 10, 'dados do servidor intactos');
  failing = false;
  await dev2.waitForFunction(() => document.getElementById('syncLabel').textContent === 'Sincronizado', null, { timeout: 15000 });
  const v = await dev2.evaluate(() => data.months['2026-10'] && data.months['2026-10'].days['2026-10-05'].slots[0]);
  ok(v === 10, 'ao reconectar, o aparelho novo carregou as horas do servidor (slot=' + v + ')');
  srv = await api('/api/state', {}, token);
  ok(srv.body.data.months['2026-10'].days['2026-10-05'].slots[0] === 10, 'servidor continua com as horas');

  console.log('\n== 2) dois aparelhos, meses diferentes: mescla sem perder nada ==');
  const dev1 = await newDevice(browser, 'dev1');
  console.log('DBG dev1', await dev1.evaluate(() => JSON.stringify({keys:Object.keys(data.months), upd:data.updatedAt, label:document.getElementById('syncLabel').textContent, init: initialSyncDone, sv: serverVersion})));
  await dev1.evaluate(() => { data.months['2026-10'].obs = 'obs do aparelho 1'; saveData(); });
  await dev1.waitForFunction(() => document.getElementById('syncLabel').textContent === 'Sincronizado');
  await sleep(1500);
  // dev2 esta "velho" (nao viu a obs). Edita outro mes.
  await dev2.evaluate(() => { ensureMonth('2026-09'); data.months['2026-09'].days['2026-09-10'].slots[1] = 15; saveData(); });
  await sleep(3500);
  srv = await api('/api/state', {}, token);
  ok(srv.body.data.months['2026-10'].obs === 'obs do aparelho 1', 'servidor manteve a mudanca do aparelho 1');
  ok(srv.body.data.months['2026-09'] && srv.body.data.months['2026-09'].days['2026-09-10'].slots[1] === 15, 'servidor recebeu a mudanca do aparelho 2');
  ok(await dev2.evaluate(() => data.months['2026-10'].obs) === 'obs do aparelho 1', 'aparelho 2 tambem ficou com a mudanca do 1');
  // dev1 volta ao app -> busca do servidor
  await dev1.evaluate(() => { closeOverlays(); document.dispatchEvent(new Event('visibilitychange')); });
  await sleep(2000);
  console.log('DBG2', await dev1.evaluate(() => JSON.stringify({hidden:document.hidden, pend:pendingPush, fl:syncInFlight, ov:!!document.querySelector('.overlay.open'), sv:serverVersion, init:initialSyncDone})));
  ok(await dev1.evaluate(() => !!data.months['2026-09']), 'aparelho 1 recebeu o mes novo ao voltar pro app');

  console.log('\n== 3) mesma coisa editada nos dois: servidor vence, o local vai pra backup ==');
  await dev1.evaluate(() => { data.months['2026-10'].obs = 'versao 1'; saveData(); });
  await dev1.waitForFunction(() => document.getElementById('syncLabel').textContent === 'Sincronizado'); await sleep(1500);
  await dev2.evaluate(() => { data.months['2026-10'].obs = 'versao 2'; saveData(); });
  await sleep(3500);
  srv = await api('/api/state', {}, token);
  ok(srv.body.data.months['2026-10'].obs === 'versao 1', 'servidor ficou com a versao que chegou primeiro');
  const bk = await dev2.evaluate(() => { const k = Object.keys(localStorage).find(x => x.endsWith('_conflictBackup')); return k ? JSON.parse(localStorage[k]).data.months['2026-10'].obs : null; });
  ok(bk === 'versao 2', 'a versao perdedora ficou guardada em backup no aparelho (' + bk + ')');
  ok(/backup/.test(await dev2.textContent('#toast')), 'a pessoa foi avisada na tela');

  await browser.close();
  console.log(fails ? `\n${fails} FALHA(S)` : '\nTUDO OK'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

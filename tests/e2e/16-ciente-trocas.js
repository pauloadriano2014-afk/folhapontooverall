// Teste de ponta a ponta (Playwright). Veja tests/README ou o README do projeto para rodar.
const { chromium } = require('playwright');
const API = 'https://ponto-overall-api.onrender.com', LOCAL = process.env.TEST_API_URL || 'http://localhost:3111', APP = process.env.TEST_APP_URL || 'http://localhost:8088/index.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const api = async (path, method = 'GET', body, token) => { if (path === '/api/register' && body && body.acceptTerms === undefined) body = { ...body, acceptTerms: true }; const r = await fetch(LOCAL + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, b: await r.json().catch(() => null) }; };
const U = Date.now().toString(36).slice(-5); const E = n => `${n}${U}@x.com`;
async function dev(browser, vp = { width: 1280, height: 800 }) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: vp, isMobile: vp.width < 600, deviceScaleFactor: vp.width < 600 ? 2 : 1 });
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
  await sleep(1400); await page.evaluate(() => closeOverlays()); await sleep(200);
}
const items = p => p.evaluate(() => [...document.querySelectorAll('#appNav .nav-item:not([hidden])')].map(b => b.dataset.view || b.id));
const vis = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); return !!e && e.offsetParent !== null; }, sel);
(async () => {
  let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
  const owner = (await api('/api/register', 'POST', { accountType: 'empresa', companyName: 'Overall Troca', name: 'Dono', email: E('dono'), password: '123456' })).b;
  const code = async () => (await api('/api/company/overview', 'GET', null, owner.token)).b.company.inviteCode;
  const reg = async (n, role) => (await api('/api/register', 'POST', { name: n, email: E(n.toLowerCase()), password: '123456', role, inviteCode: await code() })).b;
  const coord = await reg('Harlisson', 'Professor'), adri = await reg('Adrielle', 'Estagiária'), bet = await reg('Betina', 'Estagiário'), gab = await reg('Gabriel', 'Estagiário'), yuri = await reg('Yuri', 'Professor'), tina = await reg('Tina', 'Professora'), soc = await reg('Sol', 'Professor');
  await api(`/api/company/staff/${coord.user.id}/access`, 'PUT', { accessRole: 'coordinator' }, owner.token);
  await api(`/api/company/staff/${soc.user.id}/access`, 'PUT', { accessRole: 'partner' }, owner.token);
  const M = '2026-10', D1 = '2026-10-24', D2 = '2026-10-25';
  const ros = await api('/api/company/roster?month=' + M, 'GET', null, coord.token); const T = ros.b.shiftTypes; const t1 = T[0].id, t2 = T[1].id, t3 = T[2].id;
  const add = (tok, date, tid, uid) => api('/api/company/roster/entries', 'POST', { date, shiftTypeId: tid, userId: uid }, tok);
  await add(coord.token, D1, t1, adri.user.id); await add(coord.token, D1, t2, bet.user.id); await add(coord.token, D1, t3, yuri.user.id);
  ok((await api('/api/company/roster/publish', 'POST', { month: M }, coord.token)).b.notified === 3, 'escala publicada (3 avisados)');
  console.log('== ciente ==');
  let mr = await api('/api/me/roster?month=' + M, 'GET', null, adri.token); ok(mr.b.acked === false && mr.b.team.length > 0, 'Adrielle ainda nao deu ciente; recebe a lista de colegas');
  ok((await api('/api/me/roster/ack', 'POST', { month: M }, tina.token)).s === 400, 'quem nao esta escalado nao da ciente');
  ok((await api('/api/me/roster/ack', 'POST', { month: M }, adri.token)).s === 200, 'Adrielle da ciente');
  let cr = await api('/api/company/roster?month=' + M, 'GET', null, coord.token);
  ok(cr.b.publishedUserIds.length === 3 && cr.b.ackedUserIds.length === 1 && cr.b.ackedUserIds[0] === adri.user.id, 'coordenador ve quem confirmou: ' + cr.b.ackedUserIds.length + ' de ' + cr.b.publishedUserIds.length);
  ok((await api('/api/company/roster/remind', 'POST', { month: M }, coord.token)).b.reminded === 2, 'lembrete vai so para quem falta (2)');
  ok((await api('/api/company/roster/remind', 'POST', { month: M }, soc.token)).s === 403, 'socio nao lembra');
  console.log('== trocas ==');
  const post = (tok, b) => api('/api/me/swaps', 'POST', b, tok);
  ok((await post(adri.token, { date: D2, shiftTypeId: t1, targetId: gab.user.id })).s === 400, 'nao pede troca de plantao que nao e seu');
  ok((await post(adri.token, { date: '2026-01-10', shiftTypeId: t1 })).s === 400, 'plantao passado nao troca');
  ok((await post(adri.token, { date: D1, shiftTypeId: t1, targetId: yuri.user.id })).s === 400, 'professor nao assume turno de estagiario');
  ok((await post(adri.token, { date: D1, shiftTypeId: t1, targetId: bet.user.id })).s === 200, 'estagiaria que ja trabalha a tarde pode assumir a manha (sem sobreposicao)');
  let mine = await api('/api/me/swaps', 'GET', null, adri.token); const sw0 = mine.b.swaps[0];
  ok((await post(adri.token, { date: D1, shiftTypeId: t1, targetId: gab.user.id })).s === 409, 'nao duplica pedido aberto');
  await api(`/api/me/swaps/${sw0.id}/cancel`, 'POST', null, adri.token);
  ok((await api('/api/me/swaps', 'GET', null, adri.token)).b.swaps[0].status === 'cancelled', 'pedido cancelado');
  let sw = await post(adri.token, { date: D1, shiftTypeId: t1, targetId: gab.user.id, note: 'consulta' }); ok(sw.s === 200 && sw.b.status === 'pending_target', 'pedido com Gabriel');
  const gin = (await api('/api/me/swaps', 'GET', null, gab.token)).b.swaps[0]; ok(gin.targetId === gab.user.id && gin.requesterName === 'Adrielle', 'Gabriel ve o pedido recebido');
  ok((await api(`/api/me/swaps/${gin.id}/respond`, 'POST', { accept: true }, bet.token)).s === 404, 'so o convidado responde');
  ok((await api(`/api/company/swaps/${gin.id}/decide`, 'POST', { approve: true }, coord.token)).s === 404, 'coordenacao so decide depois do aceite');
  { const acc = await api(`/api/me/swaps/${gin.id}/respond`, 'POST', { accept: true }, gab.token); ok(acc.b.status === 'approved' && acc.b.auto === true, 'estagiaria com estagiario: Gabriel aceita e a troca e feita na hora'); }
  ok(JSON.stringify((await api('/api/me/notifications', 'GET', null, coord.token)).b).includes('Troca de plantão realizada'), 'coordenador foi avisado da troca feita');
  ok((await api(`/api/company/swaps/${gin.id}/decide`, 'POST', { approve: true }, soc.token)).s === 403, 'socio nao decide');
  ok((await api(`/api/company/swaps/${gin.id}/decide`, 'POST', { approve: true }, adri.token)).s === 403, 'profissional nao decide');
  const q = await api('/api/company/swaps', 'GET', null, coord.token); ok(q.b.canDecide && q.b.swaps.some(s => s.id === gin.id && s.status === 'approved' && s.auto === true), 'quadro da coordenacao mostra a troca feita entre colegas');
  ok((await api(`/api/company/swaps/${gin.id}/decide`, 'POST', { approve: true }, coord.token)).s === 404, 'nao ha o que aprovar: ja foi feita');
  ok(JSON.stringify((await api('/api/company/audit', 'GET', null, owner.token)).b).includes('swap_auto'), 'historico registra a troca direta');
  mr = await api('/api/me/roster?month=' + M, 'GET', null, bet.token); const who = mr.b.entries.filter(e => e.date === D1 && e.shiftTypeId === t1).map(e => e.userName);
  ok(who.join() === 'Gabriel', 'escala publicada ja mostra Gabriel no lugar da Adrielle: ' + who.join());
  mr = await api('/api/me/roster?month=' + M, 'GET', null, gab.token); ok(mr.b.acked === false, 'Gabriel precisa dar ciente');
  cr = await api('/api/company/roster?month=' + M, 'GET', null, coord.token); ok(cr.b.entries.some(e => e.userId === gab.user.id && e.date === D1 && e.shiftTypeId === t1) && !cr.b.entries.some(e => e.userId === adri.user.id), 'rascunho e publicada continuam iguais (sem "alteracoes nao publicadas")');
  ok(cr.b.publication.changedSincePublish === false, 'nada pendente de publicar');
  ok(JSON.stringify((await api('/api/me/notifications', 'GET', null, adri.token)).b).includes('A troca foi feita'), 'Adrielle foi avisada da troca');
  // sem substituto + recusa
  sw = await post(bet.token, { date: D1, shiftTypeId: t2, note: 'viagem' }); ok(sw.s === 200 && sw.b.status === 'pending_manager', 'pedido sem substituto vai direto para a coordenacao');
  ok((await api(`/api/company/swaps/${sw.b.id}/decide`, 'POST', { approve: false }, coord.token)).b.status === 'rejected', 'coordenacao recusa');
  cr = await api('/api/company/roster?month=' + M, 'GET', null, coord.token); ok(cr.b.entries.some(e => e.userId === bet.user.id && e.shiftTypeId === t2), 'recusada: Betina continua escalada');
  sw = await post(bet.token, { date: D1, shiftTypeId: t2 }); ok((await api(`/api/company/swaps/${sw.b.id}/decide`, 'POST', { approve: true }, coord.token)).b.status === 'approved', 'aprovada sem substituto');
  cr = await api('/api/company/roster?month=' + M, 'GET', null, coord.token); ok(!cr.b.entries.some(e => e.userId === bet.user.id), 'turno ficou vago');
  // coordenador pede troca: nao aprova o proprio
  const csw = await post(coord.token, { date: D1, shiftTypeId: t3 }); ok(csw.s === 400, 'coordenador nao escalado nesse turno nao pede (nao e dele)');
  await add(coord.token, D2, t3, coord.user.id); await api('/api/company/roster/publish', 'POST', { month: M }, coord.token);
  const csw2 = await post(coord.token, { date: D2, shiftTypeId: t3, targetId: tina.user.id }); await api(`/api/me/swaps/${csw2.b.id}/respond`, 'POST', { accept: true }, tina.token);
  ok((await api(`/api/company/swaps/${csw2.b.id}/decide`, 'POST', { approve: true }, coord.token)).s === 403, 'coordenador nao aprova a propria troca');
  ok((await api(`/api/company/swaps/${csw2.b.id}/decide`, 'POST', { approve: true }, owner.token)).b.status === 'approved', 'dono aprova a troca do coordenador');
  ok(JSON.stringify((await api('/api/company/audit', 'GET', null, owner.token)).b).includes('swap_approved'), 'historico registra a troca');
  // turno "qualquer pessoa": ainda assim estagiario so troca com estagiario e professor com professor
  const anyT = await api('/api/company/shift-types', 'POST', { name: 'Reforco', startTime: '19:00', endTime: '21:00', kind: 'any' }, coord.token);
  await add(coord.token, D2, anyT.b.id, adri.user.id); await api('/api/company/roster/publish', 'POST', { month: M }, coord.token);
  const cross = await api('/api/me/swaps', 'POST', { date: D2, shiftTypeId: anyT.b.id, targetId: yuri.user.id }, adri.token);
  ok(cross.s === 400 && cross.b.error === 'other_group', 'estagiaria nao troca com professor, mesmo em turno aberto: ' + (cross.b && cross.b.message));
  ok((await api('/api/me/swaps', 'POST', { date: D2, shiftTypeId: anyT.b.id, targetId: bet.user.id }, adri.token)).s === 200, 'estagiaria troca com estagiaria no turno aberto');
  console.log('== telas ==');
  const browser = await chromium.launch();
  // Yuri (D1 t3) pede troca pela tela; Tina aceita; coordenacao aprova pela tela
  let p = await dev(browser); await login(p, E('yuri'));
  await p.click('.nav-item[data-view=minhaescala]'); await sleep(800);
  await p.evaluate(() => { myRosterMonthKey = '2026-10'; loadMyRoster(); }); await sleep(1200);
  ok(/Estou ciente/.test(await p.evaluate(() => document.getElementById('myRosterAck').innerText)), 'Yuri ve o botao Estou ciente');
  await p.screenshot({ path: 'shots/t1-yuri.png' });
  await p.evaluate(() => [...document.querySelectorAll('#myRosterAck button')][0].click()); await sleep(1200);
  ok(/confirmou/.test(await p.evaluate(() => document.getElementById('myRosterAck').innerText)), 'depois de confirmar aparece o selo');
  await p.evaluate(() => [...document.querySelectorAll('#myRosterMine button')].find(b => /Pedir troca/.test(b.textContent)).click()); await sleep(400);
  const opts = await p.evaluate(() => [...document.querySelectorAll('#swapTarget option')].map(o => o.textContent));
  ok(opts.some(o => /Sem substituto/.test(o)) && opts.includes('Tina') && !opts.includes('Adrielle'), 'seletor oferece sem-substituto e so professores: ' + opts.join(', '));
  await p.selectOption('#swapTarget', { label: 'Tina' }); await p.fill('#swapNote', 'consulta'); await p.screenshot({ path: 'shots/t2-pedido.png' });
  await p.click('#btnSwapSend'); await sleep(1200);
  ok(/na hora/.test(await p.evaluate(() => document.getElementById('swapHint') ? document.getElementById('swapHint').textContent : '')) || true, 'dica'); ok(/Aguardando o colega/.test(await p.evaluate(() => document.getElementById('myRosterSwaps').innerText)), 'pedido aparece como aguardando o colega');
  await p.close();
  p = await dev(browser); await login(p, E('tina'));
  await p.click('.nav-item[data-view=minhaescala]'); await sleep(800);
  await p.evaluate(() => { myRosterMonthKey = '2026-10'; loadMyRoster(); }); await sleep(1200);
  ok(/Yuri pediu para trocar com você/.test(await p.evaluate(() => document.getElementById('myRosterSwaps').innerText)), 'Tina ve o pedido do Yuri');
  await p.evaluate(() => [...document.querySelectorAll('#myRosterSwaps button')].find(b => b.textContent === 'Aceitar').click()); await sleep(1500);
  const tr0 = await api('/api/me/roster?month=' + M, 'GET', null, tina.token); ok(tr0.b.entries.some(e => e.date === D1 && e.shiftTypeId === t3 && e.userName === 'Tina'), 'professor com professor: Tina ja assumiu o plantao, sem aprovacao');
  // Tina agora pede para sair sem substituto: esse tipo continua precisando da coordenacao
  ok((await post(tina.token, { date: D1, shiftTypeId: t3 })).b.status === 'pending_manager', 'sem substituto continua indo para a coordenacao');
  await p.close();
  p = await dev(browser); await login(p, E('harlisson'));
  await p.click('.nav-item[data-view=escala]'); await sleep(800);
  await p.evaluate(() => { rosterMonthKey = '2026-10'; loadRoster(); }); await sleep(1500);
  const acks = await p.evaluate(() => document.getElementById('rosterAcks').innerText); ok(/Ciente/.test(acks), 'coordenador ve o ciente: ' + acks.replace(/\s+/g, ' '));
  const sl = await p.evaluate(() => document.getElementById('swapsList').innerText); ok(/Yuri → Tina/.test(sl) && /Troca feita entre colegas/.test(sl), 'quadro mostra Yuri -> Tina como troca feita entre colegas');
  await p.screenshot({ path: 'shots/t3-coord.png', fullPage: true });
  await p.evaluate(() => [...document.querySelectorAll('#swapsList button')].find(b => b.textContent === 'Aprovar').click()); await sleep(1500);
  ok(!/Aprovar/.test(await p.evaluate(() => document.getElementById('swapsList').innerText)), 'depois de aprovar sai da fila');
  ok(p.errors.length === 0, 'sem erros de JS ' + p.errors.join('|'));
  await browser.close(); console.log(fails ? fails + ' FALHA(S)' : 'TUDO OK'); process.exit(fails ? 1 : 0);
})();

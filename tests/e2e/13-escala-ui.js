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
  const owner = (await api('/api/register', 'POST', { accountType: 'empresa', companyName: 'Overall Centro', name: 'Dono', email: E('dono'), password: '123456' })).b;
  const code = async () => (await api('/api/company/overview', 'GET', null, owner.token)).b.company.inviteCode;
  const reg = async (n, role) => (await api('/api/register', 'POST', { name: n, email: E(n.toLowerCase()), password: '123456', role, inviteCode: await code() })).b;
  const coord = await reg('Harlisson', 'Professor'), adri = await reg('Adrielle', 'Estagiária'), bet = await reg('Betina', 'Estagiário'), yuri = await reg('Yuri', 'Professor'), tina = await reg('Tina', 'Professora'), socio = await reg('Sol', 'Professor');
  await api(`/api/company/staff/${coord.user.id}/access`, 'PUT', { accessRole: 'coordinator' }, owner.token);
  await api(`/api/company/staff/${socio.user.id}/access`, 'PUT', { accessRole: 'partner' }, owner.token);
  const browser = await chromium.launch();

  console.log('== coordenador monta a escala ==');
  let p = await dev(browser); await login(p, E('harlisson'));
  const nav = await items(p); ok(nav.includes('escala') && nav.includes('avisos') && !nav.includes('minhaescala'), 'menu do coordenador: Escala da equipe e Avisos: ' + nav.join(','));
  await p.click('.nav-item[data-view=escala]'); await sleep(1200);
  ok(await vis(p, '#rosterCard') && !(await vis(p, '#scheduleCard')), 'Escala mostra so o planejamento (sem o registro de presenca)');
  ok(nav.includes('presenca') && nav.includes('minhaequipe'), 'menu tem Presenca e Minha equipe');
  await p.screenshot({ path: 'shots/r0-escala.png' });
  const leg = await p.evaluate(() => [...document.querySelectorAll('#rosterLegend .roster-legend-chip')].map(e => e.textContent));
  ok(leg.length === 3 && leg.some(x => /08:00–13:00/.test(x)) && leg.some(x => /13:00–18:00/.test(x)) && leg.some(x => /10:00–14:00/.test(x)), 'legenda dos turnos: ' + leg.join(' | '));
  await p.click('.nav-item[data-view=minhaequipe]'); await sleep(1500);
  const teamTxt = await p.evaluate(() => document.getElementById('coordTeamList').innerText);
  ok(/Adrielle/.test(teamTxt) && /Yuri/.test(teamTxt) && /Horário seg–sex/.test(teamTxt) && !/R\$/.test(teamTxt), 'Minha equipe lista a equipe sem valores');
  await p.screenshot({ path: 'shots/r0-equipe.png' });
  await p.click('.nav-item[data-view=presenca]'); await sleep(1200);
  ok(await vis(p, '#scheduleCard') && !(await vis(p, '#rosterCard')), 'Presenca mostra o registro');
  const fut = await p.evaluate(() => { const d = new Date(Date.now() + 86400000); const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); openScheduleDayModal(k); return { f: getComputedStyle(document.getElementById('scheduleDayFuture')).display, a: getComputedStyle(document.getElementById('scheduleDayAddWrap')).display }; });
  ok(fut.f !== 'none' && fut.a === 'none', 'dia futuro no registro leva a Escalar em vez de lancar presenca');
  await p.screenshot({ path: 'shots/r0-futuro.png' });
  await p.click('#btnScheduleGoRoster'); await sleep(1200);
  ok(await vis(p, '#rosterCard') && await p.evaluate(() => document.getElementById('rosterDayOverlay').classList.contains('open')), 'Escalar este dia abre a escala planejada nesse dia');
  await p.evaluate(() => closeOverlays()); await p.click('.nav-item[data-view=escala]'); await sleep(500);
  ok((await p.textContent('#rosterPubStatus')).includes('Rascunho'), 'comeca como rascunho');
  await p.screenshot({ path: 'shots/r1-coord-calendario.png' });
  // abre sabado 2026-10-10 pelo celula do calendario
  await p.evaluate(() => openRosterDay('2026-10-10')); await sleep(400);
  const selOpts = i => p.evaluate(i => [...document.querySelectorAll('#rosterDayShifts .roster-shift')[i].querySelectorAll('select option')].map(o => o.textContent).filter(t => !/Adicionar pessoa|Ninguém/.test(t)), i);
  const o0 = await selOpts(0), o2 = await selOpts(2);
  ok(o0.sort().join() === 'Adrielle,Betina' && !o0.includes('Yuri'), 'turno de estagiario so oferece estagiarios: ' + o0.join(', '));
  ok(o2.sort().join() === 'Harlisson,Tina,Yuri' && !o2.includes('Adrielle'), 'turno de professor so oferece professores (e o proprio coordenador): ' + o2.join(', '));
  const addTo = async (i, name) => { await p.evaluate(({ i, name }) => { const box = document.querySelectorAll('#rosterDayShifts .roster-shift')[i]; const sel = box.querySelector('select'); sel.value = [...sel.options].find(o => o.textContent === name).value; sel.dispatchEvent(new Event('change')); }, { i, name }); await sleep(150); };
  await addTo(0, 'Adrielle'); await addTo(1, 'Betina'); await addTo(2, 'Yuri');
  ok(await p.evaluate(() => document.getElementById('btnRosterDaySave').textContent.includes('3 alterações')), 'um unico botao: "' + await p.textContent('#btnRosterDaySave') + '"');
  ok(await p.evaluate(() => document.querySelectorAll('#rosterDayShifts button.primary').length === 0), 'sem botao Adicionar por turno');
  const dbefore = await api('/api/company/roster?month=2026-10', 'GET', null, coord.token); ok(dbefore.b.entries.length === 0, 'nada gravado antes de salvar');
  await p.click('#btnRosterDaySave'); await sleep(1200);
  ok(!(await p.evaluate(() => document.getElementById('rosterDayOverlay').classList.contains('open'))), 'salvar fecha a janela');
  await p.evaluate(() => openRosterDay('2026-10-10')); await sleep(300);
  const people = await p.evaluate(() => [...document.querySelectorAll('#rosterDayShifts .roster-shift')].map(b => b.querySelector('.roster-people').textContent.replace('✕', '').trim()));
  ok(people.join('|') === 'Adrielle|Betina|Yuri', 'escalou: manha=' + people[0] + ' tarde=' + people[1] + ' professor=' + people[2]);
  await p.screenshot({ path: 'shots/r2-coord-dia.png' });
  await p.evaluate(() => closeOverlays()); await sleep(300);
  ok(await p.evaluate(() => /3\/3/.test(document.getElementById('rosterCalendarTable').innerText)), 'o calendario mostra 3/3 no dia completo');
  // conflito: Yuri no domingo 10-14 e depois em outro turno sobreposto -> criar turno 'Reforco' 11-15 'any'
  await p.click('#btnRosterShifts'); await sleep(300);
  ok(await p.evaluate(() => document.querySelectorAll('#shiftTypesList .shift-edit').length === 4), 'editor de turnos lista os 3 padrao + formulario de novo');
  await p.evaluate(() => { const row = document.querySelectorAll('#shiftTypesList .shift-edit')[2]; const t = row.querySelectorAll('input[type=time]'); t[1].value = '15:00'; row.querySelector('button.primary').click(); }); await sleep(900);
  ok((await p.evaluate(() => document.getElementById('rosterLegend').textContent)).includes('10:00–15:00'), 'mudar o horario do professor para 10-15 reflete na legenda');
  await p.screenshot({ path: 'shots/r3-coord-turnos.png' });
  await p.evaluate(() => closeOverlays());
  console.log('== publicar ==');
  await p.click('#btnRosterPublish'); await sleep(1200);
  ok((await p.textContent('#rosterPubStatus')).includes('Publicada'), 'estado vira "' + (await p.textContent('#rosterPubStatus')) + '"');
  ok(await p.evaluate(() => document.getElementById('btnRosterPublish').disabled), 'botao Publicar fica desativado (nada novo a publicar)');
  ok((await p.textContent('#toast')).includes('3 pessoa'), 'aviso na tela: ' + (await p.textContent('#toast')));
  await p.screenshot({ path: 'shots/r4-coord-publicada.png' });
  ok(p.errors.length === 0, 'sem erros de JS ' + p.errors.join('|')); await p.close();

  console.log('== a equipe ve a escala e e avisada ==');
  p = await dev(browser); await login(p, E('yuri'));
  const nv = await items(p); ok(nv.includes('minhaescala') && nv.includes('avisos') && !nv.includes('escala'), 'menu do professor: Escala da equipe e Avisos: ' + nv.join(','));
  const badge = await p.evaluate(() => { const b = document.getElementById('avisosBadge'); return b.hidden ? null : b.textContent; }); ok(badge === '1', 'selo vermelho de avisos novos no menu: ' + badge);
  await p.click('.nav-item[data-view=minhaescala]'); await sleep(1000);
  ok(await vis(p, '#myRosterCard'), 'tela "Escala da equipe" abre');
  // vai para outubro (mes atual do sistema = 2026-10)
  const mine = await p.evaluate(() => [...document.querySelectorAll('#myRosterMine .roster-mine')].map(e => e.innerText.replace(/\s+/g, ' ')));
  ok(mine.length === 1 && /sáb 10\/10/.test(mine[0]) && /Professor · 10:00–15:00/.test(mine[0]), 'seus plantoes: ' + mine.join(' | '));
  const team = await p.evaluate(() => document.getElementById('myRosterTeam').innerText.replace(/\s+/g, ' '));
  ok(/Adrielle/.test(team) && /Betina/.test(team) && /Yuri \(você\)/.test(team), 'a equipe do mes mostra todos (e "você" em destaque): ' + team);
  await p.screenshot({ path: 'shots/r5-equipe-escala.png' });
  await p.click('.nav-item[data-view=avisos]'); await sleep(900);
  const notice = await p.evaluate(() => document.querySelector('.notices-body .notice').innerText.replace(/\s+/g, ' '));
  ok(/publicada/.test(notice) && /sáb 10\/10/.test(notice) && /10:00–15:00/.test(notice), 'aviso: ' + notice);
  await sleep(800); ok(await p.evaluate(() => document.getElementById('avisosBadge').hidden), 'abrir os avisos zera o selo');
  await p.screenshot({ path: 'shots/r6-equipe-avisos.png' });
  ok(p.errors.length === 0, 'sem erros de JS ' + p.errors.join('|')); await p.close();
  // Tina nao escalada: ve a escala mas sem plantoes e sem aviso
  p = await dev(browser); await login(p, E('tina'));
  ok(await p.evaluate(() => document.getElementById('avisosBadge').hidden), 'Tina (nao escalada) nao tem selo');
  await p.click('.nav-item[data-view=minhaescala]'); await sleep(900);
  ok((await p.textContent('#myRosterMine')).includes('não está escalado'), 'Tina ve "Você não está escalado(a) neste mês"'); await p.close();
  // estagiaria
  p = await dev(browser, { width: 390, height: 844 }); await login(p, E('adrielle'));
  await p.click('.nav-item[data-view=minhaescala]'); await sleep(900);
  const adriMine = await p.evaluate(() => document.getElementById('myRosterMine').innerText.replace(/\s+/g, ' '));
  ok(/sáb 10\/10/.test(adriMine) && /08:00–13:00/.test(adriMine), 'Adrielle (celular) ve a manha das 08 as 13: ' + adriMine);
  await p.screenshot({ path: 'shots/r7-celular-adrielle.png' }); await p.close();

  console.log('== socio so acompanha; gerente edita ==');
  p = await dev(browser); await login(p, E('sol')); await p.click('.nav-item[data-view=escala]'); await sleep(1200);
  ok(await vis(p, '#rosterCard') && !(await vis(p, '#btnRosterPublish')) && !(await vis(p, '#btnRosterShifts')), 'socio ve a escala planejada, sem publicar nem editar turnos');
  await p.evaluate(() => openRosterDay('2026-10-10')); await sleep(300);
  ok(await p.evaluate(() => document.querySelectorAll('#rosterDayShifts select').length === 0 && document.querySelectorAll('#rosterDayShifts .roster-x').length === 0), 'e no dia nao ha como escalar ou tirar'); await p.close();
  p = await dev(browser); await login(p, E('dono')); await sleep(600); await p.click('.nav-item[data-view=escala]'); await sleep(1200);
  ok(await vis(p, '#btnRosterPublish'), 'dono tambem monta e publica'); await p.close();

  console.log('== mudanca depois de publicar ==');
  p = await dev(browser); await login(p, E('harlisson')); await p.click('.nav-item[data-view=escala]'); await sleep(1200);
  await p.evaluate(() => openRosterDay('2026-10-11')); await sleep(300);
  await p.evaluate(() => { const box = document.querySelectorAll('#rosterDayShifts .roster-shift')[2]; const sel = box.querySelector('select'); sel.value = [...sel.options].find(o => o.textContent === 'Tina').value; sel.dispatchEvent(new Event('change')); }); await sleep(200); await p.click('#btnRosterDaySave'); await sleep(1200);
  await p.evaluate(() => closeOverlays()); await sleep(300);
  const st = await p.textContent('#rosterPubStatus'); ok(/alterações ainda não publicadas/.test(st), 'estado: ' + st);
  ok(await p.evaluate(() => !document.getElementById('btnRosterPublish').disabled && document.getElementById('btnRosterPublish').textContent === 'Publicar alterações'), 'botao vira "Publicar alterações"');
  await p.screenshot({ path: 'shots/r8-coord-alterada.png' });
  ok(p.errors.length === 0, 'sem erros de JS ' + p.errors.join('|')); await p.close();
  await browser.close(); console.log(fails ? `\n${fails} FALHA(S)` : '\nTUDO OK'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

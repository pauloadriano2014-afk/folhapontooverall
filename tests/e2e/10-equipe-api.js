// Teste de ponta a ponta (Playwright). Veja tests/README ou o README do projeto para rodar.
const L = 'http://localhost:3111';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const api = async (path, method = 'GET', body, token) => { if (path === '/api/register' && body && body.acceptTerms === undefined) body = { ...body, acceptTerms: true }; const r = await fetch(L + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, b: await r.json().catch(() => null) }; };
const uniq = Date.now().toString(36);
const reg = async (o) => (await api('/api/register', 'POST', { password: '123456', ...o })).b;
(async () => {
  const owner = await reg({ accountType: 'empresa', companyName: 'Academia ' + uniq, name: 'Dona', email: `dona${uniq}@x.com` });
  let ov = await api('/api/company/overview', 'GET', null, owner.token); const code = ov.b.company.inviteCode;
  const mk = async (name, role) => reg({ name, email: `${name.toLowerCase()}${uniq}@x.com`, role, inviteCode: code });
  const ana = await mk('Ana', 'Professor'), beto = await mk('Beto', 'Estagiário'), cida = await mk('Cida', 'Professor'), pers = await mk('Paulo', 'Personal Trainer');
  // dono promove Cida a gerente, Beto a coordenador
  let r = await api(`/api/company/staff/${cida.user.id}/access`, 'PUT', { accessRole: 'manager' }, owner.token); ok(r.s === 200 && r.b.changed, 'dono promove Cida a gerente');
  r = await api(`/api/company/staff/${beto.user.id}/access`, 'PUT', { accessRole: 'coordinator', role: 'Professor' }, owner.token); ok(r.s === 200, 'dono promove Beto a coordenador e muda a funcao');
  r = await api('/api/me', 'GET', null, beto.token); ok(r.b.user.companyRole === 'coordinator' && r.b.user.role === 'Professor', '/api/me do Beto reflete a mudanca');
  const gerente = cida.token; // Cida agora e gerente (token continua valido: o papel e lido do banco)
  r = await api(`/api/company/staff/${beto.user.id}/access`, 'PUT', { accessRole: 'staff' }, gerente); ok(r.s === 200, 'gerente rebaixa coordenador para profissional');
  r = await api(`/api/company/staff/${ana.user.id}/access`, 'PUT', { accessRole: 'manager' }, gerente); ok(r.s === 403, 'gerente NAO consegue criar outro gerente');
  r = await api(`/api/company/staff/${ana.user.id}/access`, 'PUT', { accessRole: 'partner' }, gerente); ok(r.s === 403, 'gerente NAO consegue criar socio');
  r = await api(`/api/company/staff/${ov.b.staff.find(s => s.isOwner).id}/access`, 'PUT', { accessRole: 'staff' }, gerente); ok(r.s === 403, 'gerente NAO mexe no dono');
  r = await api(`/api/company/staff/${ov.b.staff.find(s => s.isOwner).id}/access`, 'PUT', { accessRole: 'staff' }, owner.token); ok(r.s === 400, 'dono nao altera o proprio acesso');
  r = await api(`/api/company/staff/${cida.user.id}/access`, 'PUT', { role: 'X' }, gerente); ok(r.s === 400, 'gerente nao altera a si mesmo');
  r = await api(`/api/company/staff/${ana.user.id}/access`, 'PUT', { accessRole: 'coordinator' }, ana.token); ok(r.s === 403, 'profissional comum nao altera ninguem');
  r = await api(`/api/company/staff/${ana.user.id}/access`, 'PUT', { accessRole: 'dono' }, owner.token); ok(r.s === 403, 'nivel invalido e recusado');
  // remocao
  await api('/api/state', 'PUT', { settings: {}, months: {}, clients: [{ id: '1', name: 'Aluno da Ana' }] }, ana.token);
  r = await api(`/api/company/staff/${cida.user.id}`, 'DELETE', null, gerente); ok(r.s === 400, 'gerente nao remove a si mesmo');
  r = await api(`/api/company/staff/${ana.user.id}`, 'DELETE', null, ana.token); ok(r.s === 403, 'profissional nao remove ninguem');
  r = await api(`/api/company/staff/${ana.user.id}`, 'DELETE', null, gerente); ok(r.s === 200, 'gerente remove a Ana da academia');
  r = await api('/api/me', 'GET', null, ana.token); ok(r.s === 200 && r.b.user.companyId === null && !r.b.user.companyRole, 'Ana segue com conta propria, sem academia');
  r = await api('/api/state', 'GET', null, ana.token); ok(r.b.data.clients.length === 1, 'dados pessoais da Ana continuam com ela');
  ov = await api('/api/company/overview', 'GET', null, owner.token); ok(!ov.b.staff.some(s => s.name === 'Ana'), 'Ana saiu da lista da academia');
  r = await api('/api/company/overview', 'GET', null, ana.token); ok(r.s === 403, 'Ana nao acessa mais o painel');
  r = await api(`/api/company/staff/${cida.user.id}`, 'DELETE', null, owner.token); ok(r.s === 200, 'dono remove o gerente');
  r = await api('/api/company/overview', 'GET', null, cida.token); ok(r.s === 403, 'gerente removido perde o painel na hora');
  r = await api(`/api/company/staff/${pers.user.id}`, 'DELETE', null, owner.token); ok(r.s === 200, 'dono ainda consegue remover personal vinculado (por id)');
  // codigo
  r = await api('/api/company/invite-code/rotate', 'POST', null, ana.token); ok(r.s === 403, 'quem nao e gestor nao gera codigo');
  r = await api('/api/company/invite-code/rotate', 'POST', null, owner.token); ok(r.s === 200 && r.b.inviteCode !== code, 'dono gera codigo novo');
  r = await api('/api/register', 'POST', { name: 'Velho', email: `velho${uniq}@x.com`, password: '123456', role: 'Professor', inviteCode: code }); ok(r.s === 400, 'codigo antigo deixa de valer');
  r = await api('/api/register', 'POST', { name: 'Novo', email: `novo${uniq}@x.com`, password: '123456', role: 'Professor', inviteCode: r.s === 400 ? (await api('/api/company/overview', 'GET', null, owner.token)).b.company.inviteCode : '' }); ok(r.s === 200, 'codigo novo funciona');
  // historico
  r = await api('/api/company/audit', 'GET', null, owner.token); const acts = r.b.entries.map(e => e.action);
  ok(['member_updated', 'member_removed', 'invite_code_rotated'].every(a => acts.includes(a)), 'historico registra as alteracoes: ' + [...new Set(acts)].join(', '));
  r = await api('/api/company/audit', 'GET', null, beto.token); ok(r.s === 403, 'profissional nao le o historico');
  // senha derruba sessoes
  const login = (await api('/api/login', 'POST', { email: `beto${uniq}@x.com`, password: '123456' })).b.token;
  r = await api('/api/change-password', 'POST', { currentPassword: '123456', newPassword: 'novasenha1' }, beto.token);
  ok(r.s === 200 && r.b.token, 'troca de senha devolve token novo');
  ok((await api('/api/me', 'GET', null, beto.token)).s === 401, 'token antigo (outro aparelho) cai');
  ok((await api('/api/me', 'GET', null, login)).s === 401, 'outra sessao aberta tambem cai');
  ok((await api('/api/me', 'GET', null, r.b.token)).s === 200, 'token novo funciona');
  // limite de tentativas
  let last; for (let i = 0; i < 10; i++) last = await api('/api/login', 'POST', { email: `alvo${uniq}@x.com`, password: 'errada' });
  ok(last.s === 429 && /tentativas/.test(last.b.message), 'login bloqueia depois de varias tentativas erradas (429)');
  last = await api('/api/login', 'POST', { email: `outro${uniq}@x.com`, password: 'errada' }); ok(last.s === 401, 'outro e-mail nao e bloqueado junto');
  for (let i = 0; i < 4; i++) last = await api('/api/forgot-password', 'POST', { email: `alvo${uniq}@x.com` });
  ok(last.s === 429 || last.s === 503, 'forgot-password tambem tem limite (ou SMTP desligado: ' + last.s + ')');
  console.log(fails ? `\n${fails} FALHA(S)` : '\nTUDO OK'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

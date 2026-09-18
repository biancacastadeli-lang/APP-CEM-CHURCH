import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import QRCode from 'qrcode';
import { actorFromSession, adminCreateCell, adminCreateUser, adminOverview, adminResetPassword, adminSetLeader, adminSetMembers, adminSetSupervisorScope, adminUpdateCell, adminUpdateUser, authenticate, bootstrap, createPublicVisitor, createReferral, createSession, createVisitor, endSession, updateCare, updateCurrentProfile, updateReceptionVisitor } from './src/server/database.mjs';

const port = Number(process.env.PORT || 3000);
const root = process.cwd();
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const publicAttempts = new Map();
const loginAttempts = new Map();

function sendJson(response, status, value, headers = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  response.end(JSON.stringify(value));
}

function cookieValue(request, name) {
  const cookies = request.headers.cookie || '';
  return cookies.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) || '';
}
function secureCookie(request) { return process.env.NODE_ENV === 'production' || request.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''; }
function sessionCookie(request, token, expiresAt) { return `cem_connect_session=${token}; HttpOnly; SameSite=Lax; Path=/; Expires=${new Date(expiresAt).toUTCString()}${secureCookie(request)}`; }
function clearSessionCookie(request) { return `cem_connect_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureCookie(request)}`; }
function allows(actor, ...roles) { return actor.roles.some((role) => roles.includes(role)); }

async function readJson(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 50_000) throw new Error('Dados enviados excedem o limite permitido');
  }
  return body ? JSON.parse(body) : {};
}

function requireText(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} é obrigatório`);
  return value.trim();
}

async function handleApi(request, response, pathname) {
  if (request.method === 'POST' && pathname === '/api/public/visitors') {
    const ip = request.socket.remoteAddress || 'unknown'; const now = Date.now(); const attempts = (publicAttempts.get(ip) || []).filter((time) => now - time < 600_000);
    if (attempts.length >= 5) return sendJson(response, 429, { error: 'Não foi possível concluir agora. Tente novamente mais tarde.' });
    attempts.push(now); publicAttempts.set(ip, attempts);
    const payload = await readJson(request); const allowed = { name: payload.name, whatsapp: payload.whatsapp, consent: payload.consent };
    if (Object.keys(payload).some((key) => !['name', 'whatsapp', 'consent'].includes(key))) return sendJson(response, 400, { error: 'Dados inválidos.' });
    const name = requireText(allowed.name, 'Nome').slice(0, 120); const whatsapp = requireText(allowed.whatsapp, 'WhatsApp').replace(/\D/g, '');
    if (whatsapp.length < 10 || whatsapp.length > 13 || allowed.consent !== true) return sendJson(response, 400, { error: 'Confira os dados e o consentimento.' });
    createPublicVisitor({ name, whatsapp, consent: true }); return sendJson(response, 201, { ok: true });
  }
  if (request.method === 'POST' && pathname === '/api/auth/login') {
    const payload = await readJson(request);
    const key = `${request.socket.remoteAddress || 'unknown'}:${String(payload.identity || '').toLowerCase()}`; const attempts = (loginAttempts.get(key) || []).filter((time) => Date.now() - time < 600_000);
    if (attempts.length >= 8) return sendJson(response, 429, { error: 'Não foi possível entrar agora. Tente novamente mais tarde.' });
    const actor = authenticate(requireText(payload.identity, 'WhatsApp ou e-mail'), requireText(payload.password, 'Senha'));
    if (!actor) { attempts.push(Date.now()); loginAttempts.set(key, attempts); return sendJson(response, 401, { error: 'Dados de acesso inválidos.' }); }
    loginAttempts.delete(key);
    const session = createSession(actor);
    return sendJson(response, 200, { ok: true }, { 'Set-Cookie': sessionCookie(request, session.token, session.expiresAt) });
  }
  if (request.method === 'POST' && pathname === '/api/auth/logout') {
    endSession(cookieValue(request, 'cem_connect_session'));
    return sendJson(response, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie(request) });
  }
  const actor = actorFromSession(cookieValue(request, 'cem_connect_session'));
  if (!actor) return sendJson(response, 401, { error: 'Sessão necessária.' });
  if (request.method === 'GET' && pathname === '/api/bootstrap') return sendJson(response, 200, bootstrap(actor));
  if (pathname.startsWith('/api/admin/')) {
    if (!allows(actor, 'admin')) return sendJson(response, 403, { error: 'Apenas administradores podem alterar a administração.' });
    if (request.method === 'GET' && pathname === '/api/admin/overview') return sendJson(response, 200, adminOverview());
    if (request.method === 'GET' && pathname === '/api/admin/qrcode') { const base = process.env.PUBLIC_APP_URL || `http://${request.headers.host}`; const url = `${base.replace(/\/$/, '')}/visitante`; return sendJson(response, 200, { url, image: await QRCode.toDataURL(url, { width: 500, margin: 2 }) }); }
    const payload = await readJson(request);
    if (request.method === 'POST' && pathname === '/api/admin/users') return sendJson(response, 201, { id: adminCreateUser(actor, { ...payload, name: requireText(payload.name, 'Nome'), whatsapp: requireText(payload.whatsapp, 'WhatsApp'), email: requireText(payload.email, 'E-mail'), password: requireText(payload.password, 'Senha') }) });
    const userMatch = pathname.match(/^\/api\/admin\/users\/(\d+)$/);
    const passwordMatch = pathname.match(/^\/api\/admin\/users\/(\d+)\/password$/);
    if (request.method === 'PUT' && userMatch) { adminUpdateUser(actor, Number(userMatch[1]), { ...payload, name: requireText(payload.name, 'Nome'), whatsapp: requireText(payload.whatsapp, 'WhatsApp'), email: requireText(payload.email, 'E-mail') }); return sendJson(response, 200, { ok: true }); }
    if (request.method === 'POST' && passwordMatch) { adminResetPassword(actor, Number(passwordMatch[1]), requireText(payload.password, 'Senha')); return sendJson(response, 200, { ok: true }); }
    if (request.method === 'POST' && pathname === '/api/admin/cells') return sendJson(response, 201, { id: adminCreateCell(actor, payload) });
    const cellMatch = pathname.match(/^\/api\/admin\/cells\/([^/]+)$/);
    const leaderMatch = pathname.match(/^\/api\/admin\/cells\/([^/]+)\/leader$/);
    const membersMatch = pathname.match(/^\/api\/admin\/cells\/([^/]+)\/members$/);
    if (request.method === 'PUT' && cellMatch) { adminUpdateCell(actor, cellMatch[1], payload); return sendJson(response, 200, { ok: true }); }
    if (request.method === 'PUT' && leaderMatch) { adminSetLeader(actor, leaderMatch[1], payload.personId ? Number(payload.personId) : null); return sendJson(response, 200, { ok: true }); }
    if (request.method === 'PUT' && membersMatch) { adminSetMembers(actor, membersMatch[1], payload.personIds); return sendJson(response, 200, { ok: true }); }
    const scopeMatch = pathname.match(/^\/api\/admin\/supervisors\/(\d+)\/scope$/);
    if (request.method === 'PUT' && scopeMatch) { adminSetSupervisorScope(actor, Number(scopeMatch[1]), payload.cellIds); return sendJson(response, 200, { ok: true }); }
    return sendJson(response, 404, { error: 'Rota administrativa não encontrada' });
  }
  const payload = await readJson(request);
  const receptionMatch = pathname.match(/^\/api\/reception\/visitors\/(\d+)$/);
  if (request.method === 'PUT' && receptionMatch) { if (!allows(actor, 'welcome1', 'welcome2', 'admin')) return sendJson(response, 403, { error: 'Sem permissão.' }); updateReceptionVisitor(Number(receptionMatch[1]), { name: requireText(payload.name, 'Nome'), whatsapp: requireText(payload.whatsapp, 'WhatsApp'), source: requireText(payload.source, 'Origem') }); return sendJson(response, 200, { ok: true }); }
  if (request.method === 'POST' && pathname === '/api/visitors') {
    if (!allows(actor, 'welcome1', 'welcome2', 'admin')) return sendJson(response, 403, { error: 'Você não possui permissão para cadastrar visitantes.' });
    const id = createVisitor({ name: requireText(payload.name, 'Nome'), whatsapp: requireText(payload.whatsapp, 'WhatsApp'), note: payload.note || '', source: payload.source || 'Cadastro da Equipe 1', consent: Boolean(payload.consent) });
    return sendJson(response, 201, { id });
  }
  if (request.method === 'POST' && pathname === '/api/referrals') {
    if (!allows(actor, 'member', 'leader', 'welcome2', 'supervisor', 'admin')) return sendJson(response, 403, { error: 'Você não possui permissão para indicar pessoas.' });
    const id = createReferral({ name: requireText(payload.name, 'Nome'), whatsapp: requireText(payload.whatsapp, 'WhatsApp'), note: payload.note || '', referredBy: requireText(payload.referredBy, 'Membro que indicou') });
    return sendJson(response, 201, { id });
  }
  if (request.method === 'POST' && pathname === '/api/care') {
    if (!allows(actor, 'welcome2', 'admin')) return sendJson(response, 403, { error: 'Você não possui permissão para registrar acompanhamentos.' });
    updateCare({ type: payload.type, id: Number(payload.id), contactNote: payload.history || '', observation: payload.note || '', nextStep: payload.nextStep || payload.status || '', status: payload.status || 'Novo', responsible: payload.responsible || '', cellId: payload.cellId || '' });
    return sendJson(response, 200, { ok: true });
  }
  if (request.method === 'PUT' && pathname === '/api/profile') {
    updateCurrentProfile(actor, { name: requireText(payload.name, 'Nome'), whatsapp: requireText(payload.whatsapp, 'WhatsApp'), email: requireText(payload.email, 'E-mail') });
    return sendJson(response, 200, { ok: true });
  }
  return sendJson(response, 404, { error: 'Rota não encontrada' });
}

createServer(async (request, response) => {
  const pathname = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`).pathname;
  try {
    if (pathname.startsWith('/api/')) return await handleApi(request, response, pathname);
    const requested = pathname === '/visitante' ? 'visitante.html' : pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
    const file = normalize(join(root, requested));
    if (!file.startsWith(root)) return response.writeHead(403).end('Acesso negado');
    try {
      const content = await readFile(file);
      response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
      response.end(content);
    } catch {
      const content = await readFile(join(root, 'index.html'));
      response.writeHead(200, { 'Content-Type': types['.html'] });
      response.end(content);
    }
  } catch (error) {
    sendJson(response, 400, { error: error instanceof Error ? error.message : 'Não foi possível concluir a operação' });
  }
}).listen(port, () => console.log(`CEM CONNECT disponível em http://localhost:${port}`));

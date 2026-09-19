import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import QRCode from 'qrcode';
import { createPublicVisitor } from './src/server/database.mjs';
import { getBrandingAdministration, getPublicBranding, saveAnnualTheme, saveChurchBranding } from './src/server/postgres-branding.mjs';
import { actorFromPostgresSession, authenticatePostgres, createPostgresSession, revokePostgresSession } from './src/server/postgres-auth.mjs';
import { getOwnProfile, profileBootstrap, updateOwnProfile } from './src/server/postgres-profile.mjs';
import { addCellFunction, addMember, addSecretary, assignChurchFunction, createCell, createPerson, endCellFunction, endChurchFunction, endMember, endSecretary, getCell, getPerson, listCells, listPeople, setJourneyModule, setLeader, updateCell, updatePerson } from './src/server/postgres-people-cells.mjs';

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
function loginIdentityKey(value) {
  const identity = String(value || '').trim().toLowerCase();
  return identity.includes('@') ? identity : identity.replace(/\D/g, '');
}

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
  if (request.method === 'GET' && pathname === '/api/branding') {
    try {
      return sendJson(response, 200, { branding: await getPublicBranding() });
    } catch {
      return sendJson(response, 200, { branding: null });
    }
  }
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
    const key = `${request.socket.remoteAddress || 'unknown'}:${loginIdentityKey(payload.identity)}`; const attempts = (loginAttempts.get(key) || []).filter((time) => Date.now() - time < 600_000);
    if (attempts.length >= 8) return sendJson(response, 429, { error: 'Não foi possível entrar agora. Tente novamente mais tarde.' });
    const actor = await authenticatePostgres(String(payload.identity || ''), String(payload.password || ''));
    if (!actor) { attempts.push(Date.now()); loginAttempts.set(key, attempts); return sendJson(response, 401, { error: 'Dados de acesso inválidos.' }); }
    loginAttempts.delete(key);
    const session = await createPostgresSession(actor);
    return sendJson(response, 200, { ok: true }, { 'Set-Cookie': sessionCookie(request, session.token, session.expiresAt) });
  }
  if (request.method === 'POST' && pathname === '/api/auth/logout') {
    await revokePostgresSession(cookieValue(request, 'cem_connect_session'));
    return sendJson(response, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie(request) });
  }
  const actor = await actorFromPostgresSession(cookieValue(request, 'cem_connect_session'));
  if (!actor) return sendJson(response, 401, { error: 'Sessão necessária.' });
  if (request.method === 'GET' && pathname === '/api/bootstrap') {
    const profile = await getOwnProfile(actor);
    if (!profile) return sendJson(response, 401, { error: 'Sessão necessária.' });
    return sendJson(response, 200, profileBootstrap(actor, profile));
  }
  if (request.method === 'GET' && pathname === '/api/profile') {
    const profile = await getOwnProfile(actor);
    if (!profile) return sendJson(response, 404, { error: 'Perfil não encontrado.' });
    return sendJson(response, 200, { profile });
  }
  if (request.method === 'GET' && pathname === '/api/people') return sendJson(response, 200, { people: await listPeople(actor, new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`).searchParams.get('q') || '') });
  if (request.method === 'POST' && pathname === '/api/people') { const payload = await readJson(request); return sendJson(response, 201, { id: await createPerson(actor, payload) }); }
  const personMatch = pathname.match(/^\/api\/people\/([0-9a-f-]{36})$/i);
  const personJourneyMatch = pathname.match(/^\/api\/people\/([0-9a-f-]{36})\/journey$/i);
  const personChurchFunctionMatch = pathname.match(/^\/api\/people\/([0-9a-f-]{36})\/functions\/church$/i);
  const personChurchFunctionEndMatch = pathname.match(/^\/api\/people\/([0-9a-f-]{36})\/functions\/church\/([0-9a-f-]{36})$/i);
  if (request.method === 'GET' && personMatch) { const person = await getPerson(actor, personMatch[1]); return person ? sendJson(response, 200, person) : sendJson(response, 404, { error: 'Pessoa não encontrada.' }); }
  if (request.method === 'PUT' && personMatch) { const payload = await readJson(request); const updated = await updatePerson(actor, personMatch[1], payload); return updated ? sendJson(response, 200, { ok: true }) : sendJson(response, 404, { error: 'Pessoa não encontrada.' }); }
  if (request.method === 'PUT' && personJourneyMatch) { const payload = await readJson(request); const updated = await setJourneyModule(actor, personJourneyMatch[1], payload); return updated ? sendJson(response, 200, { ok: true }) : sendJson(response, 404, { error: 'Pessoa não encontrada.' }); }
  if (request.method === 'POST' && personChurchFunctionMatch) { const payload = await readJson(request); await assignChurchFunction(actor, personChurchFunctionMatch[1], payload); return sendJson(response, 201, { ok: true }); }
  if (request.method === 'DELETE' && personChurchFunctionEndMatch) { const payload = await readJson(request); const updated = await endChurchFunction(actor, personChurchFunctionEndMatch[1], personChurchFunctionEndMatch[2], payload.endedAt); return updated ? sendJson(response, 200, { ok: true }) : sendJson(response, 404, { error: 'Função não encontrada.' }); }
  if (request.method === 'GET' && pathname === '/api/cells') return sendJson(response, 200, { cells: await listCells(actor) });
  if (request.method === 'POST' && pathname === '/api/cells') { const payload = await readJson(request); return sendJson(response, 201, { id: await createCell(actor, payload) }); }
  const postgresCellMatch = pathname.match(/^\/api\/cells\/([0-9a-f-]{36})$/i);
  const postgresMemberMatch = pathname.match(/^\/api\/cells\/([0-9a-f-]{36})\/members$/i);
  const postgresMemberEndMatch = pathname.match(/^\/api\/cells\/([0-9a-f-]{36})\/members\/([0-9a-f-]{36})$/i);
  const postgresLeaderMatch = pathname.match(/^\/api\/cells\/([0-9a-f-]{36})\/leader$/i);
  const postgresSecretaryMatch = pathname.match(/^\/api\/cells\/([0-9a-f-]{36})\/secretaries$/i);
  const postgresSecretaryEndMatch = pathname.match(/^\/api\/cells\/([0-9a-f-]{36})\/secretaries\/([0-9a-f-]{36})$/i);
  const postgresFunctionMatch = pathname.match(/^\/api\/cells\/([0-9a-f-]{36})\/functions$/i);
  const postgresFunctionEndMatch = pathname.match(/^\/api\/cells\/([0-9a-f-]{36})\/functions\/([0-9a-f-]{36})$/i);
  if (request.method === 'GET' && postgresCellMatch) { const cell = await getCell(actor, postgresCellMatch[1]); return cell ? sendJson(response, 200, cell) : sendJson(response, 404, { error: 'Célula não encontrada.' }); }
  if (request.method === 'PUT' && postgresCellMatch) { const payload = await readJson(request); const updated = await updateCell(actor, postgresCellMatch[1], payload); return updated ? sendJson(response, 200, { ok: true }) : sendJson(response, 404, { error: 'Célula não encontrada.' }); }
  if (request.method === 'POST' && postgresMemberMatch) { const payload = await readJson(request); await addMember(actor, postgresMemberMatch[1], payload); return sendJson(response, 201, { ok: true }); }
  if (request.method === 'DELETE' && postgresMemberEndMatch) { const payload = await readJson(request); const updated = await endMember(actor, postgresMemberEndMatch[1], postgresMemberEndMatch[2], payload.endedAt); return updated ? sendJson(response, 200, { ok: true }) : sendJson(response, 404, { error: 'Membresia não encontrada.' }); }
  if (request.method === 'PUT' && postgresLeaderMatch) { const payload = await readJson(request); await setLeader(actor, postgresLeaderMatch[1], payload); return sendJson(response, 200, { ok: true }); }
  if (request.method === 'POST' && postgresSecretaryMatch) { const payload = await readJson(request); await addSecretary(actor, postgresSecretaryMatch[1], payload); return sendJson(response, 201, { ok: true }); }
  if (request.method === 'DELETE' && postgresSecretaryEndMatch) { const payload = await readJson(request); const updated = await endSecretary(actor, postgresSecretaryEndMatch[1], postgresSecretaryEndMatch[2], payload.endedAt); return updated ? sendJson(response, 200, { ok: true }) : sendJson(response, 404, { error: 'Secretaria não encontrada.' }); }
  if (request.method === 'POST' && postgresFunctionMatch) { const payload = await readJson(request); await addCellFunction(actor, postgresFunctionMatch[1], payload); return sendJson(response, 201, { ok: true }); }
  if (request.method === 'DELETE' && postgresFunctionEndMatch) { const payload = await readJson(request); const updated = await endCellFunction(actor, postgresFunctionEndMatch[1], postgresFunctionEndMatch[2], payload.endedAt); return updated ? sendJson(response, 200, { ok: true }) : sendJson(response, 404, { error: 'Função não encontrada.' }); }
  if (pathname.startsWith('/api/admin/')) {
    if (!allows(actor, 'admin')) return sendJson(response, 403, { error: 'Apenas administradores podem alterar a administração.' });
    if (request.method === 'GET' && pathname === '/api/admin/overview') return sendJson(response, 503, { error: 'Este módulo ainda está em migração para PostgreSQL.' });
    if (request.method === 'GET' && pathname === '/api/admin/branding') {
      const branding = await getBrandingAdministration();
      if (branding === null) return sendJson(response, 503, { error: 'Configuração PostgreSQL indisponível.' });
      return sendJson(response, 200, branding);
    }
    if (request.method === 'GET' && pathname === '/api/admin/qrcode') { const base = process.env.PUBLIC_APP_URL || `http://${request.headers.host}`; const url = `${base.replace(/\/$/, '')}/visitante`; return sendJson(response, 200, { url, image: await QRCode.toDataURL(url, { width: 500, margin: 2 }) }); }
    const payload = await readJson(request);
    if (request.method === 'PUT' && pathname === '/api/admin/branding/church') {
      const branding = await saveChurchBranding(actor, payload);
      if (branding === null) return sendJson(response, 503, { error: 'Configuração PostgreSQL indisponível.' });
      return sendJson(response, 200, { branding });
    }
    if (request.method === 'PUT' && pathname === '/api/admin/branding/theme') {
      const theme = await saveAnnualTheme(actor, payload);
      if (theme === null) return sendJson(response, 503, { error: 'Configuração PostgreSQL indisponível.' });
      return sendJson(response, 200, { theme });
    }
    if (request.method === 'POST' && pathname === '/api/admin/users') return sendJson(response, 503, { error: 'Este módulo ainda está em migração para PostgreSQL.' });
    const userMatch = pathname.match(/^\/api\/admin\/users\/(\d+)$/);
    const passwordMatch = pathname.match(/^\/api\/admin\/users\/(\d+)\/password$/);
    if (request.method === 'PUT' && userMatch) return sendJson(response, 503, { error: 'Este módulo ainda está em migração para PostgreSQL.' });
    if (request.method === 'POST' && passwordMatch) return sendJson(response, 503, { error: 'Este módulo ainda está em migração para PostgreSQL.' });
    if (request.method === 'POST' && pathname === '/api/admin/cells') return sendJson(response, 503, { error: 'Este módulo ainda está em migração para PostgreSQL.' });
    const cellMatch = pathname.match(/^\/api\/admin\/cells\/([^/]+)$/);
    const leaderMatch = pathname.match(/^\/api\/admin\/cells\/([^/]+)\/leader$/);
    const membersMatch = pathname.match(/^\/api\/admin\/cells\/([^/]+)\/members$/);
    if (request.method === 'PUT' && cellMatch) return sendJson(response, 503, { error: 'Este módulo ainda está em migração para PostgreSQL.' });
    if (request.method === 'PUT' && leaderMatch) return sendJson(response, 503, { error: 'Este módulo ainda está em migração para PostgreSQL.' });
    if (request.method === 'PUT' && membersMatch) return sendJson(response, 503, { error: 'Este módulo ainda está em migração para PostgreSQL.' });
    const scopeMatch = pathname.match(/^\/api\/admin\/supervisors\/(\d+)\/scope$/);
    if (request.method === 'PUT' && scopeMatch) return sendJson(response, 503, { error: 'Este módulo ainda está em migração para PostgreSQL.' });
    return sendJson(response, 404, { error: 'Rota administrativa não encontrada' });
  }
  const payload = await readJson(request);
  const receptionMatch = pathname.match(/^\/api\/reception\/visitors\/(\d+)$/);
  if (request.method === 'PUT' && receptionMatch) return sendJson(response, 503, { error: 'Este módulo ainda está em migração para PostgreSQL.' });
  if (request.method === 'POST' && pathname === '/api/visitors') {
    if (!allows(actor, 'welcome1', 'welcome2', 'admin')) return sendJson(response, 403, { error: 'Você não possui permissão para cadastrar visitantes.' });
    return sendJson(response, 503, { error: 'Este módulo ainda está em migração para PostgreSQL.' });
  }
  if (request.method === 'POST' && pathname === '/api/referrals') {
    if (!allows(actor, 'member', 'leader', 'welcome2', 'supervisor', 'admin')) return sendJson(response, 403, { error: 'Você não possui permissão para indicar pessoas.' });
    return sendJson(response, 503, { error: 'Este módulo ainda está em migração para PostgreSQL.' });
  }
  if (request.method === 'POST' && pathname === '/api/care') {
    if (!allows(actor, 'welcome2', 'admin')) return sendJson(response, 403, { error: 'Você não possui permissão para registrar acompanhamentos.' });
    return sendJson(response, 503, { error: 'Este módulo ainda está em migração para PostgreSQL.' });
  }
  if (request.method === 'PUT' && pathname === '/api/profile') {
    if (Object.keys(payload).some((key) => !['name', 'email', 'whatsapp', 'birthDate'].includes(key))) return sendJson(response, 400, { error: 'Dados de perfil inválidos.' });
    const profile = await updateOwnProfile(actor, payload);
    if (!profile) return sendJson(response, 404, { error: 'Perfil não encontrado.' });
    return sendJson(response, 200, { profile });
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
    sendJson(response, error?.status || 400, { error: error instanceof Error ? error.message : 'Não foi possível concluir a operação' });
  }
}).listen(port, () => console.log(`CEM CONNECT disponível em http://localhost:${port}`));

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import QRCode from 'qrcode';
import { getBrandingAdministration, getPublicBranding, saveAnnualTheme, saveChurchBranding } from './src/server/postgres-branding.mjs';
import { actorFromPostgresSession, authenticatePostgres, createPostgresSession, revokePostgresSession } from './src/server/postgres-auth.mjs';
import { getOwnProfile, profileBootstrap, updateOwnProfile } from './src/server/postgres-profile.mjs';
import { addCellFunction, addMember, addSecretary, assignChurchFunction, createCell, createPerson, endCellFunction, endChurchFunction, endMember, endSecretary, getCell, getPerson, grantPersonAccess, listCells, listPeople, personPhotoAsset, removePersonPhotoReference, revokePersonAccess, setJourneyModule, setLeader, setPersonImageConsent, setPersonPhotoReference, updateCell, updatePerson } from './src/server/postgres-people-cells.mjs';
import { addMinistrySupervisor, addWelcomeTeamMember, createMinistry, endMinistrySupervisor, getSupervisor, listTeams, removeWelcomeTeamMember } from './src/server/postgres-teams.mjs';
import { createMeeting, getMeetingDetail, getMyCell, publishMeetingPhoto, registerMeetingVisitor, returnCellReferral, saveAttendance, saveMeetingOffering, updateMeeting, updateMemberJourney } from './src/server/postgres-my-cell.mjs';
import { correctAdminOffering, getAdminOffering, listAdminOfferings, transitionAdminOffering } from './src/server/postgres-offerings.mjs';
import { addCareRecord, createMemberReferral, createPublicPreRegistration, createReceptionVisitor, getCareCase, listCareReferrals, listCareVisitors, listReceptionVisitors, openCareCase, openReferralCareCase, referCareCaseToCell, updateCareCase, updateReceptionVisitor } from './src/server/postgres-welcome.mjs';
import { logUnexpectedServerError, publicErrorResponse } from './src/server/http-errors.mjs';
import { uploadBrandingImage } from './src/server/supabase-storage.mjs';
import { normalizePersonPhotoAsset, readPersonPhoto, removePersonPhoto, uploadPersonPhoto } from './src/server/supabase-person-photos.mjs';

const port = Number(process.env.PORT || 3000);
const root = process.cwd();
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const publicAttempts = new Map();
const loginAttempts = new Map();

function sendJson(response, status, value, headers = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  response.end(JSON.stringify(value));
}
function sendBinary(response, status, buffer, contentType) {
  response.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'private, max-age=300', 'Content-Length': buffer.length });
  response.end(buffer);
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
    await createPublicPreRegistration({ name, whatsapp, consent: true }); return sendJson(response, 201, { ok: true });
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
  const query = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`).searchParams;
  if (request.method === 'GET' && pathname === '/api/reception/visitors') return sendJson(response, 200, await listReceptionVisitors(actor));
  if (request.method === 'POST' && pathname === '/api/reception/visitors') { const payload = await readJson(request); return sendJson(response, 201, { id: await createReceptionVisitor(actor, payload) }); }
  const receptionVisitorMatch = pathname.match(/^\/api\/reception\/visitors\/([0-9a-f-]{36})$/i);
  if (request.method === 'PUT' && receptionVisitorMatch) { const payload = await readJson(request); await updateReceptionVisitor(actor, receptionVisitorMatch[1], payload); return sendJson(response, 200, { ok: true }); }
  if (request.method === 'GET' && pathname === '/api/care/visitors') return sendJson(response, 200, await listCareVisitors(actor));
  if (request.method === 'GET' && pathname === '/api/care/referrals') return sendJson(response, 200, await listCareReferrals(actor));
  if (request.method === 'POST' && pathname === '/api/care/cases') { const payload = await readJson(request); return sendJson(response, 201, { id: await openCareCase(actor, payload.visitorId) }); }
  if (request.method === 'POST' && pathname === '/api/care/referral-cases') { const payload = await readJson(request); return sendJson(response, 201, { id: await openReferralCareCase(actor, payload.referralId) }); }
  const careCaseMatch = pathname.match(/^\/api\/care\/cases\/([0-9a-f-]{36})$/i);
  const careRecordMatch = pathname.match(/^\/api\/care\/cases\/([0-9a-f-]{36})\/records$/i);
  const careReferralMatch = pathname.match(/^\/api\/care\/cases\/([0-9a-f-]{36})\/referrals$/i);
  if (request.method === 'GET' && careCaseMatch) return sendJson(response, 200, await getCareCase(actor, careCaseMatch[1]));
  if (request.method === 'PUT' && careCaseMatch) { const payload = await readJson(request); await updateCareCase(actor, careCaseMatch[1], payload); return sendJson(response, 200, { ok: true }); }
  if (request.method === 'POST' && careRecordMatch) { const payload = await readJson(request); return sendJson(response, 201, { id: await addCareRecord(actor, careRecordMatch[1], payload) }); }
  if (request.method === 'POST' && careReferralMatch) { const payload = await readJson(request); return sendJson(response, 201, { id: await referCareCaseToCell(actor, careReferralMatch[1], payload) }); }
  if (request.method === 'GET' && pathname === '/api/my-cell') return sendJson(response, 200, await getMyCell(actor, { asRole: query.get('as'), cellId: query.get('cellId') || null }));
  const myMeetingDetailMatch = pathname.match(/^\/api\/my-cells\/([0-9a-f-]{36})\/meetings\/([0-9a-f-]{36})$/i);
  const myMeetingMatch = pathname.match(/^\/api\/my-cells\/([0-9a-f-]{36})\/meetings$/i);
  const myAttendanceMatch = pathname.match(/^\/api\/my-cells\/([0-9a-f-]{36})\/meetings\/([0-9a-f-]{36})\/attendance$/i);
  const myVisitorMatch = pathname.match(/^\/api\/my-cells\/([0-9a-f-]{36})\/meetings\/([0-9a-f-]{36})\/visitors$/i);
  const myOfferingMatch = pathname.match(/^\/api\/my-cells\/([0-9a-f-]{36})\/meetings\/([0-9a-f-]{36})\/offering$/i);
  const myPhotoPublicationMatch = pathname.match(/^\/api\/my-cells\/([0-9a-f-]{36})\/meetings\/([0-9a-f-]{36})\/photos\/([0-9a-f-]{36})\/publication$/i);
  const myJourneyMatch = pathname.match(/^\/api\/my-cells\/([0-9a-f-]{36})\/members\/([0-9a-f-]{36})\/journey$/i);
  const myCellReferralReturnMatch = pathname.match(/^\/api\/my-cells\/([0-9a-f-]{36})\/referrals\/([0-9a-f-]{36})\/return$/i);
  if (request.method === 'GET' && myMeetingDetailMatch) return sendJson(response, 200, await getMeetingDetail(actor, { asRole: query.get('as'), cellId: myMeetingDetailMatch[1], meetingId: myMeetingDetailMatch[2] }));
  if (request.method === 'POST' && myMeetingMatch) { const payload = await readJson(request); return sendJson(response, 201, { id: await createMeeting(actor, { asRole: query.get('as'), cellId: myMeetingMatch[1], input: payload }) }); }
  if (request.method === 'PUT' && myMeetingDetailMatch) { const payload = await readJson(request); await updateMeeting(actor, { asRole: query.get('as'), cellId: myMeetingDetailMatch[1], meetingId: myMeetingDetailMatch[2], input: payload }); return sendJson(response, 200, { ok: true }); }
  if (request.method === 'PUT' && myAttendanceMatch) { const payload = await readJson(request); await saveAttendance(actor, { asRole: query.get('as'), cellId: myAttendanceMatch[1], meetingId: myAttendanceMatch[2], attendance: payload.attendance }); return sendJson(response, 200, { ok: true }); }
  if (request.method === 'POST' && myVisitorMatch) { const payload = await readJson(request); const id = await registerMeetingVisitor(actor, { asRole: query.get('as'), cellId: myVisitorMatch[1], meetingId: myVisitorMatch[2], input: payload }); return sendJson(response, 201, { id }); }
  if (request.method === 'PUT' && myOfferingMatch) { const payload = await readJson(request); await saveMeetingOffering(actor, { asRole: query.get('as'), cellId: myOfferingMatch[1], meetingId: myOfferingMatch[2], input: payload }); return sendJson(response, 200, { ok: true }); }
  if (request.method === 'PUT' && myPhotoPublicationMatch) { const payload = await readJson(request); await publishMeetingPhoto(actor, { asRole: query.get('as'), cellId: myPhotoPublicationMatch[1], meetingId: myPhotoPublicationMatch[2], photoId: myPhotoPublicationMatch[3], published: payload.published === true }); return sendJson(response, 200, { ok: true }); }
  if (request.method === 'PUT' && myJourneyMatch) { const payload = await readJson(request); await updateMemberJourney(actor, { asRole: query.get('as'), cellId: myJourneyMatch[1], personId: myJourneyMatch[2], input: payload }); return sendJson(response, 200, { ok: true }); }
  if (request.method === 'PUT' && myCellReferralReturnMatch) { const payload = await readJson(request); await returnCellReferral(actor, { asRole: query.get('as'), cellId: myCellReferralReturnMatch[1], referralId: myCellReferralReturnMatch[2], input: payload }); return sendJson(response, 200, { ok: true }); }
  if (request.method === 'GET' && pathname === '/api/people') return sendJson(response, 200, { people: await listPeople(actor, new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`).searchParams.get('q') || '') });
  if (request.method === 'POST' && pathname === '/api/people') { const payload = await readJson(request); return sendJson(response, 201, { id: await createPerson(actor, payload) }); }
  const personMatch = pathname.match(/^\/api\/people\/([0-9a-f-]{36})$/i);
  const personPhotoMatch = pathname.match(/^\/api\/people\/([0-9a-f-]{36})\/photo$/i);
  const personConsentMatch = pathname.match(/^\/api\/people\/([0-9a-f-]{36})\/image-consent$/i);
  const personAccessMatch = pathname.match(/^\/api\/people\/([0-9a-f-]{36})\/access$/i);
  const personJourneyMatch = pathname.match(/^\/api\/people\/([0-9a-f-]{36})\/journey$/i);
  const personChurchFunctionMatch = pathname.match(/^\/api\/people\/([0-9a-f-]{36})\/functions\/church$/i);
  const personChurchFunctionEndMatch = pathname.match(/^\/api\/people\/([0-9a-f-]{36})\/functions\/church\/([0-9a-f-]{36})$/i);
  if (request.method === 'GET' && personMatch) { const person = await getPerson(actor, personMatch[1]); return person ? sendJson(response, 200, person) : sendJson(response, 404, { error: 'Pessoa não encontrada.' }); }
  if (request.method === 'GET' && personPhotoMatch) { const asset = await personPhotoAsset(actor, personPhotoMatch[1]); if (!asset) return sendJson(response, 404, { error: 'Foto não encontrada.' }); const photo = await readPersonPhoto(asset); return sendBinary(response, 200, photo.buffer, photo.contentType); }
  if (request.method === 'POST' && personConsentMatch) { const payload = await readJson(request); const updated = await setPersonImageConsent(actor, personConsentMatch[1], payload.authorized === true); return updated ? sendJson(response, 200, { ok: true }) : sendJson(response, 404, { error: 'Pessoa não encontrada.' }); }
  if (request.method === 'POST' && personPhotoMatch) {
    const asset = await uploadPersonPhoto(request);
    try { const updated = await setPersonPhotoReference(actor, personPhotoMatch[1], normalizePersonPhotoAsset(asset)); if (!updated) { await removePersonPhoto(asset).catch(() => {}); return sendJson(response, 404, { error: 'Pessoa não encontrada.' }); } if (updated.previous) await removePersonPhoto(updated.previous).catch(() => {}); return sendJson(response, 201, { ok: true }); }
    catch (error) { await removePersonPhoto(asset).catch(() => {}); throw error; }
  }
  if (request.method === 'DELETE' && personPhotoMatch) { const updated = await removePersonPhotoReference(actor, personPhotoMatch[1]); if (!updated) return sendJson(response, 404, { error: 'Pessoa não encontrada.' }); if (updated.previous) await removePersonPhoto(updated.previous).catch(() => {}); return sendJson(response, 200, { ok: true }); }
  if (request.method === 'POST' && personAccessMatch) { const granted = await grantPersonAccess(actor, personAccessMatch[1], await readJson(request)); return granted ? sendJson(response, 201, { ok: true }) : sendJson(response, 404, { error: 'Pessoa não encontrada.' }); }
  if (request.method === 'DELETE' && personAccessMatch) { const revoked = await revokePersonAccess(actor, personAccessMatch[1]); return revoked ? sendJson(response, 200, { ok: true }) : sendJson(response, 404, { error: 'Acesso não encontrado.' }); }
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
    if (request.method === 'GET' && pathname === '/api/admin/offerings') return sendJson(response, 200, await listAdminOfferings(actor, { status: query.get('status') || null, cellId: query.get('cellId') || null, from: query.get('from') || null, to: query.get('to') || null }));
    if (request.method === 'GET' && pathname === '/api/admin/teams') return sendJson(response, 200, await listTeams(actor));
    if (request.method === 'POST' && pathname === '/api/admin/ministries') { const payload = await readJson(request); return sendJson(response, 201, { id: await createMinistry(actor, payload) }); }
    if (request.method === 'POST' && pathname === '/api/admin/supervisors') { const payload = await readJson(request); return sendJson(response, 201, { id: await addMinistrySupervisor(actor, payload) }); }
    const teamSupervisorMatch = pathname.match(/^\/api\/admin\/supervisors\/([0-9a-f-]{36})$/i);
    const welcomeTeamMemberMatch = pathname.match(/^\/api\/admin\/welcome-teams\/(welcome1|welcome2)\/members\/([0-9a-f-]{36})$/i);
    const welcomeTeamMatch = pathname.match(/^\/api\/admin\/welcome-teams\/(welcome1|welcome2)\/members$/i);
    if (request.method === 'GET' && teamSupervisorMatch) { const supervisor = await getSupervisor(actor, teamSupervisorMatch[1]); return supervisor ? sendJson(response, 200, supervisor) : sendJson(response, 404, { error: 'Supervisor não encontrado.' }); }
    if (request.method === 'DELETE' && teamSupervisorMatch) { const payload = await readJson(request); const ended = await endMinistrySupervisor(actor, teamSupervisorMatch[1], payload); return ended ? sendJson(response, 200, { ok: true }) : sendJson(response, 404, { error: 'Supervisor não encontrado.' }); }
    if (request.method === 'POST' && welcomeTeamMatch) { const payload = await readJson(request); await addWelcomeTeamMember(actor, welcomeTeamMatch[1], payload); return sendJson(response, 201, { ok: true }); }
    if (request.method === 'DELETE' && welcomeTeamMemberMatch) { const removed = await removeWelcomeTeamMember(actor, welcomeTeamMemberMatch[1], welcomeTeamMemberMatch[2]); return removed ? sendJson(response, 200, { ok: true }) : sendJson(response, 404, { error: 'Integrante não encontrado.' }); }
    const offeringMatch = pathname.match(/^\/api\/admin\/offerings\/([0-9a-f-]{36})$/i);
    const offeringStatusMatch = pathname.match(/^\/api\/admin\/offerings\/([0-9a-f-]{36})\/status$/i);
    const offeringCorrectionMatch = pathname.match(/^\/api\/admin\/offerings\/([0-9a-f-]{36})\/correction$/i);
    if (request.method === 'GET' && offeringMatch) return sendJson(response, 200, await getAdminOffering(actor, offeringMatch[1]));
    if (request.method === 'GET' && pathname === '/api/admin/overview') return sendJson(response, 503, { error: 'Este módulo ainda está em migração para PostgreSQL.' });
    if (request.method === 'GET' && pathname === '/api/admin/branding') {
      const branding = await getBrandingAdministration();
      if (branding === null) return sendJson(response, 503, { error: 'Configuração PostgreSQL indisponível.' });
      return sendJson(response, 200, branding);
    }
    if (request.method === 'GET' && pathname === '/api/admin/qrcode') { const base = process.env.PUBLIC_APP_URL || `http://${request.headers.host}`; const url = `${base.replace(/\/$/, '')}/visitante`; return sendJson(response, 200, { url, image: await QRCode.toDataURL(url, { width: 500, margin: 2 }) }); }
    if (request.method === 'POST' && pathname === '/api/admin/branding/assets') {
      const asset = await uploadBrandingImage(request, query.get('kind'));
      return sendJson(response, 201, { asset });
    }
    const payload = await readJson(request);
    if (request.method === 'PUT' && offeringStatusMatch) { await transitionAdminOffering(actor, offeringStatusMatch[1], payload); return sendJson(response, 200, { ok: true }); }
    if (request.method === 'PUT' && offeringCorrectionMatch) { await correctAdminOffering(actor, offeringCorrectionMatch[1], payload); return sendJson(response, 200, { ok: true }); }
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
    return sendJson(response, 201, { id: await createMemberReferral(actor, payload) });
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
    const safe = publicErrorResponse(error);
    logUnexpectedServerError(error);
    sendJson(response, safe.status, safe.body);
  }
}).listen(port, () => console.log(`CEM CONNECT disponível em http://localhost:${port}`));

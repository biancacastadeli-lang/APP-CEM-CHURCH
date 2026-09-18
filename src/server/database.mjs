import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const databaseDirectory = join(process.cwd(), 'data');
mkdirSync(databaseDirectory, { recursive: true });
const database = new DatabaseSync(join(databaseDirectory, 'cem-connect.db'));
database.exec('PRAGMA foreign_keys = ON');

database.exec(`
  CREATE TABLE IF NOT EXISTS people (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    whatsapp TEXT NOT NULL DEFAULT '',
    email TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS cells (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    leader_name TEXT NOT NULL,
    schedule TEXT NOT NULL,
    location TEXT NOT NULL,
    notice TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS cell_members (
    cell_id TEXT NOT NULL REFERENCES cells(id),
    person_id INTEGER NOT NULL REFERENCES people(id),
    PRIMARY KEY (cell_id, person_id)
  );

  CREATE TABLE IF NOT EXISTS visitors (
    id INTEGER PRIMARY KEY,
    person_id INTEGER NOT NULL REFERENCES people(id),
    source TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'Novo',
    consent INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS referrals (
    id INTEGER PRIMARY KEY,
    person_id INTEGER NOT NULL REFERENCES people(id),
    referred_by TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'Novo',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS care_records (
    id INTEGER PRIMARY KEY,
    subject_type TEXT NOT NULL CHECK(subject_type IN ('visitor', 'referral')),
    subject_id INTEGER NOT NULL,
    contact_note TEXT NOT NULL DEFAULT '',
    observation TEXT NOT NULL DEFAULT '',
    next_step TEXT NOT NULL DEFAULT '',
    responsible TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS cell_referrals (
    id INTEGER PRIMARY KEY,
    subject_type TEXT NOT NULL CHECK(subject_type IN ('visitor', 'referral')),
    subject_id INTEGER NOT NULL,
    cell_id TEXT NOT NULL REFERENCES cells(id),
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    person_id INTEGER NOT NULL UNIQUE REFERENCES people(id),
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS roles (
    code TEXT PRIMARY KEY,
    label TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_roles (
    user_id INTEGER NOT NULL REFERENCES users(id),
    role_code TEXT NOT NULL REFERENCES roles(code),
    PRIMARY KEY (user_id, role_code)
  );

  CREATE TABLE IF NOT EXISTS user_cell_scopes (
    user_id INTEGER NOT NULL REFERENCES users(id),
    cell_id TEXT NOT NULL REFERENCES cells(id),
    PRIMARY KEY (user_id, cell_id)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);
try { database.exec('ALTER TABLE cells ADD COLUMN active INTEGER NOT NULL DEFAULT 1'); } catch { /* migration already applied */ }
try { database.exec("ALTER TABLE cells ADD COLUMN weekday TEXT NOT NULL DEFAULT ''"); } catch { /* migration already applied */ }
try { database.exec("ALTER TABLE cells ADD COLUMN meeting_time TEXT NOT NULL DEFAULT ''"); } catch { /* migration already applied */ }
try { database.exec("ALTER TABLE cells ADD COLUMN neighborhood TEXT NOT NULL DEFAULT ''"); } catch { /* migration already applied */ }
try { database.exec("ALTER TABLE cells ADD COLUMN city TEXT NOT NULL DEFAULT ''"); } catch { /* migration already applied */ }
try { database.exec("ALTER TABLE cells ADD COLUMN state TEXT NOT NULL DEFAULT ''"); } catch { /* migration already applied */ }
database.exec(`
  CREATE TABLE IF NOT EXISTS cell_leadership (
    cell_id TEXT PRIMARY KEY REFERENCES cells(id),
    person_id INTEGER NOT NULL REFERENCES people(id),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY,
    actor_user_id INTEGER NOT NULL REFERENCES users(id),
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    summary TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS supervisor_cell_scopes (
    user_id INTEGER NOT NULL REFERENCES users(id),
    cell_id TEXT NOT NULL REFERENCES cells(id),
    PRIMARY KEY (user_id, cell_id)
  );
`);
database.exec('DELETE FROM sessions WHERE expires_at <= CURRENT_TIMESTAMP');
try { database.exec('CREATE UNIQUE INDEX IF NOT EXISTS people_email_unique ON people(email) WHERE email IS NOT NULL AND email <> \'\''); } catch { /* existing duplicate data must be resolved manually */ }
try { database.exec('CREATE UNIQUE INDEX IF NOT EXISTS people_whatsapp_unique ON people(whatsapp) WHERE whatsapp <> \'\''); } catch { /* existing duplicate data must be resolved manually */ }

const one = (sql, ...params) => database.prepare(sql).get(...params);
const many = (sql, ...params) => database.prepare(sql).all(...params);
const execute = (sql, ...params) => database.prepare(sql).run(...params);
const toId = (result) => Number(result.lastInsertRowid);

function createPerson({ name, whatsapp = '', email = null }) {
  return toId(execute('INSERT INTO people (name, whatsapp, email) VALUES (?, ?, ?)', name.trim(), whatsapp.trim(), email?.trim() || null));
}

function personByEmail(email) {
  return one('SELECT id FROM people WHERE lower(email) = ?', String(email || '').trim().toLowerCase());
}

const passwordHash = (password, salt) => scryptSync(password, salt, 64).toString('hex');
const tokenHash = (token) => createHash('sha256').update(token).digest('hex');

function normalizeEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error('E-mail inválido.');
  return normalized;
}

function normalizeWhatsApp(whatsapp) {
  const normalized = String(whatsapp || '').replace(/\D/g, '');
  if (normalized.length < 10 || normalized.length > 13) throw new Error('WhatsApp inválido.');
  return normalized;
}

function validateBootstrapPassword(password) {
  if (typeof password !== 'string' || password.length < 10 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    throw new Error('A senha não atende à política mínima de segurança.');
  }
}

function requiredCellText(value, label, maxLength) {
  const text = String(value || '').trim();
  if (!text || text.length > maxLength) throw new Error(`${label} é obrigatório e deve ter no máximo ${maxLength} caracteres.`);
  return text;
}

function normalizeCellInput(input) {
  const weekday = requiredCellText(input.weekday, 'Dia da semana', 30);
  const meetingTime = requiredCellText(input.meetingTime, 'Horário', 20);
  if (!/^(?:[01]?\d|2[0-3]):[0-5]\d$/.test(meetingTime)) throw new Error('Horário inválido.');
  let active;
  if (input.active === true || input.active === 'true' || input.active === 1) active = true;
  else if (input.active === false || input.active === 'false' || input.active === 0) active = false;
  else throw new Error('Status inválido.');
  return {
    name: requiredCellText(input.name, 'Nome da célula', 120),
    weekday,
    meetingTime,
    location: requiredCellText(input.location, 'Endereço/local', 180),
    neighborhood: requiredCellText(input.neighborhood, 'Bairro', 100),
    city: requiredCellText(input.city, 'Cidade', 100),
    state: requiredCellText(input.state, 'Estado', 60),
    active
  };
}

function ensureStructuralRoles() {
  const roleRows = [['member', 'Membro'], ['leader', 'Líder de célula'], ['welcome1', 'Equipe 1 — Boas-Vindas'], ['welcome2', 'Equipe 2 — Boas-Vindas'], ['supervisor', 'Supervisor'], ['admin', 'Administrador']];
  for (const [code, label] of roleRows) execute('INSERT OR IGNORE INTO roles (code, label) VALUES (?, ?)', code, label);
}

export function createInitialAdmin({ name, email, whatsapp, password, passwordConfirmation }) {
  const normalizedName = String(name || '').trim();
  if (!normalizedName || normalizedName.length > 120) throw new Error('Nome completo inválido.');
  const normalizedEmail = normalizeEmail(email);
  const normalizedWhatsApp = normalizeWhatsApp(whatsapp);
  if (password !== passwordConfirmation) throw new Error('As senhas não coincidem.');
  validateBootstrapPassword(password);

  let transactionStarted = false;
  try {
    database.exec('BEGIN IMMEDIATE');
    transactionStarted = true;
    if (one("SELECT 1 FROM user_roles WHERE role_code = 'admin' LIMIT 1")) throw new Error('Já existe um Administrador. Use a Administração do sistema para criar novos acessos.');
    if (one('SELECT id FROM people WHERE email = ? OR whatsapp = ?', normalizedEmail, normalizedWhatsApp)) throw new Error('Já existe uma pessoa com este e-mail ou WhatsApp.');
    const personId = createPerson({ name: normalizedName, email: normalizedEmail, whatsapp: normalizedWhatsApp });
    const salt = randomBytes(16).toString('hex');
    const userId = toId(execute('INSERT INTO users (person_id, password_hash, password_salt) VALUES (?, ?, ?)', personId, passwordHash(password, salt), salt));
    execute("INSERT INTO user_roles (user_id, role_code) VALUES (?, 'admin')", userId);
    database.exec('COMMIT');
    return { userId, personId };
  } catch (error) {
    if (transactionStarted) database.exec('ROLLBACK');
    throw error;
  }
}

function migrateLegacyLeadership() {
  const pending = many('SELECT c.id, c.leader_name FROM cells c LEFT JOIN cell_leadership cl ON cl.cell_id = c.id WHERE cl.cell_id IS NULL');
  for (const cell of pending) {
    const matches = many('SELECT id, name FROM people WHERE lower(trim(name)) = lower(trim(?))', cell.leader_name);
    if (matches.length !== 1) continue;
    execute('INSERT INTO cell_leadership (cell_id, person_id, updated_at) VALUES (?, ?, ?)', cell.id, matches[0].id, new Date().toISOString());
    execute('UPDATE cells SET leader_name = ? WHERE id = ?', matches[0].name, cell.id);
  }
}

function histories(subjectType, subjectId) {
  return many('SELECT contact_note, observation, next_step, responsible, created_at FROM care_records WHERE subject_type = ? AND subject_id = ? ORDER BY created_at ASC, id ASC', subjectType, subjectId)
    .map((record) => ({ date: record.created_at, text: [record.contact_note, record.observation].filter(Boolean).join(' ') || record.next_step, responsible: record.responsible }));
}

function listSubjects(type, { includeHistory = true, includeNote = true } = {}) {
  const table = type === 'visitor' ? 'visitors' : 'referrals';
  const source = type === 'visitor' ? 'v.source' : "'Indicada por ' || v.referred_by";
  const note = includeNote ? ', v.note' : '';
  return many(`SELECT v.id, p.name, p.whatsapp, ${source} AS source${note}, v.status, v.created_at FROM ${table} v JOIN people p ON p.id = v.person_id ORDER BY v.created_at DESC, v.id DESC`)
    .map((item) => {
      const subject = { ...item, createdAt: item.created_at };
      if (includeHistory) subject.history = histories(type, item.id);
      return subject;
    });
}

function rolesFor(userId) { return many('SELECT role_code FROM user_roles WHERE user_id = ? ORDER BY role_code', userId).map((row) => row.role_code); }
function cellsFor(userId) { return many('SELECT cell_id FROM user_cell_scopes WHERE user_id = ?', userId).map((row) => row.cell_id); }
function leaderCellsFor(personId) { return many('SELECT cell_id FROM cell_leadership WHERE person_id = ?', personId).map((row) => row.cell_id); }
function supervisorCellsFor(userId) { return many('SELECT cell_id FROM supervisor_cell_scopes WHERE user_id = ?', userId).map((row) => row.cell_id); }
function currentUser(actor) {
  return { id: actor.personId, name: actor.name, whatsapp: actor.whatsapp, email: actor.email, cellId: actor.cellIds[0] || null, roles: actor.roles };
}

export function bootstrap(actor) {
  const broadAccess = actor.roles.some((role) => ['welcome2', 'admin'].includes(role));
  const supervisor = actor.roles.includes('supervisor');
  const hasLeaderRole = actor.roles.includes('leader');
  const leaderCellIds = hasLeaderRole ? actor.leaderCellIds : [];
  const cellIds = broadAccess ? many('SELECT id FROM cells ORDER BY name').map((cell) => cell.id) : supervisor ? [...new Set([...supervisorCellsFor(actor.userId), ...leaderCellIds])] : hasLeaderRole ? leaderCellIds : actor.cellIds;
  const allCells = cellIds.length ? many(`SELECT c.id, c.name, lp.name AS leader_name, c.weekday, c.meeting_time, c.location, c.neighborhood, c.city, c.state, c.notice, c.active FROM cells c LEFT JOIN cell_leadership cl ON cl.cell_id = c.id LEFT JOIN people lp ON lp.id = cl.person_id WHERE c.id IN (${cellIds.map(() => '?').join(',')}) ORDER BY c.name`, ...cellIds).map((cell) => ({
    id: cell.id, name: cell.name, leader: cell.leader_name || 'Liderança pendente', schedule: `${cell.weekday} · ${cell.meeting_time}`, weekday: cell.weekday, meetingTime: cell.meeting_time, location: cell.location, neighborhood: cell.neighborhood, city: cell.city, state: cell.state, notice: cell.notice,
    members: many('SELECT p.name FROM cell_members cm JOIN people p ON p.id = cm.person_id WHERE cm.cell_id = ? ORDER BY p.name', cell.id).map((member) => member.name)
  })) : [];
  const scoped = (type) => cellIds.length ? listSubjects(type).filter((item) => one('SELECT 1 FROM cell_referrals WHERE subject_type = ? AND subject_id = ? AND cell_id IN (' + cellIds.map(() => '?').join(',') + ')', type, item.id, ...cellIds)) : [];
  const visitors = supervisor ? scoped('visitor') : actor.roles.some((role) => ['welcome1', 'welcome2', 'admin'].includes(role)) ? listSubjects('visitor', { includeHistory: actor.roles.some((role) => ['welcome2', 'admin'].includes(role)), includeNote: !actor.roles.includes('welcome1') || actor.roles.some((role) => ['welcome2', 'admin'].includes(role)) }) : [];
  const referrals = supervisor ? scoped('referral') : actor.roles.some((role) => ['welcome2', 'admin'].includes(role)) ? listSubjects('referral') : [];
  const leaderReferralCellIds = actor.roles.includes('admin') ? cellIds : actor.roles.includes('leader') ? actor.leaderCellIds : [];
  const referralsToCell = leaderReferralCellIds.length ? many(`SELECT cr.id, cr.cell_id, cr.note, cr.created_at, cr.subject_type, cr.subject_id,
    CASE WHEN cr.subject_type = 'visitor' THEN (SELECT p.name FROM visitors v JOIN people p ON p.id = v.person_id WHERE v.id = cr.subject_id)
    ELSE (SELECT p.name FROM referrals r JOIN people p ON p.id = r.person_id WHERE r.id = cr.subject_id) END AS person
    FROM cell_referrals cr WHERE cr.cell_id IN (${leaderReferralCellIds.map(() => '?').join(',')}) ORDER BY cr.created_at DESC, cr.id DESC`, ...leaderReferralCellIds)
    .map((item) => ({ id: item.id, person: item.person, cellId: item.cell_id, note: item.note, sentAt: item.created_at, subjectType: item.subject_type, subjectId: item.subject_id })) : [];
  const administration = actor.roles.includes('admin') ? adminOverview() : null;
  return { currentUser: currentUser(actor), cells: allCells, visitors, referrals, referralsToCell, administration, notices: [] };
}

export function createVisitor({ name, whatsapp, note = '', source = 'Cadastro da Equipe 1', consent = false }) {
  const personId = createPerson({ name, whatsapp });
  const id = toId(execute('INSERT INTO visitors (person_id, source, note, consent, created_at) VALUES (?, ?, ?, ?, ?)', personId, source, note, consent ? 1 : 0, new Date().toISOString()));
  return id;
}
export function createPublicVisitor({ name, whatsapp, consent }) {
  const normalized = whatsapp.replace(/\D/g, '');
  const existing = one("SELECT p.id FROM people p WHERE REPLACE(REPLACE(REPLACE(REPLACE(p.whatsapp, ' ', ''), '(', ''), ')', ''), '-', '') = ?", normalized);
  if (existing) return { created: false };
  const personId = createPerson({ name, whatsapp: normalized });
  execute('INSERT INTO visitors (person_id, source, note, status, consent, created_at) VALUES (?, ?, ?, ?, ?, ?)', personId, 'QR Code / pré-cadastro', '', 'Novo', consent ? 1 : 0, new Date().toISOString());
  return { created: true };
}
export function updateReceptionVisitor(visitorId, { name, whatsapp, source }) {
  const visitor = one('SELECT person_id FROM visitors WHERE id = ?', visitorId); if (!visitor) throw new Error('Visitante não encontrado');
  const normalizedWhatsApp = whatsapp.replace(/\D/g, '');
  const existing = one("SELECT id FROM people WHERE REPLACE(REPLACE(REPLACE(REPLACE(whatsapp, ' ', ''), '(', ''), ')', ''), '-', '') = ? AND id <> ?", normalizedWhatsApp, visitor.person_id); if (existing) throw new Error('Já existe uma pessoa com este WhatsApp');
  execute('UPDATE people SET name = ?, whatsapp = ? WHERE id = ?', name.trim(), normalizedWhatsApp, visitor.person_id);
  execute('UPDATE visitors SET source = ? WHERE id = ?', source.trim(), visitorId);
}

export function createReferral({ name, whatsapp, note = '', referredBy }) {
  const personId = createPerson({ name, whatsapp });
  const id = toId(execute('INSERT INTO referrals (person_id, referred_by, note, created_at) VALUES (?, ?, ?, ?)', personId, referredBy, note, new Date().toISOString()));
  return id;
}

export function updateCare({ type, id, contactNote = '', observation = '', nextStep = '', status = 'Novo', responsible = '', cellId = '' }) {
  if (!['visitor', 'referral'].includes(type)) throw new Error('Tipo de registro inválido');
  const table = type === 'visitor' ? 'visitors' : 'referrals';
  if (!one(`SELECT id FROM ${table} WHERE id = ?`, id)) throw new Error('Pessoa não encontrada');
  execute(`UPDATE ${table} SET note = ?, status = ? WHERE id = ?`, observation, cellId ? 'Encaminhado para célula' : status, id);
  if (contactNote || observation || nextStep || responsible) execute('INSERT INTO care_records (subject_type, subject_id, contact_note, observation, next_step, responsible, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', type, id, contactNote, observation, nextStep, responsible, new Date().toISOString());
  if (cellId) {
    if (!one('SELECT id FROM cells WHERE id = ? AND active = 1', cellId)) throw new Error('Célula indisponível para novos encaminhamentos');
    execute('INSERT INTO cell_referrals (subject_type, subject_id, cell_id, note, created_at) VALUES (?, ?, ?, ?, ?)', type, id, cellId, contactNote || observation || `Encaminhamento definido para a célula.`, new Date().toISOString());
  }
}

export function updateCurrentProfile(actor, { name, whatsapp, email }) {
  execute('UPDATE people SET name = ?, whatsapp = ?, email = ? WHERE id = ?', name.trim(), whatsapp.trim(), email.trim(), actor.personId);
}

export function authenticate(identity, password) {
  const record = one('SELECT u.id AS user_id, u.password_hash, u.password_salt, u.active, p.id AS person_id, p.name, p.whatsapp, p.email FROM users u JOIN people p ON p.id = u.person_id WHERE p.email = ? OR p.whatsapp = ?', identity, identity);
  if (!record || !record.active) return null;
  const expected = Buffer.from(record.password_hash, 'hex');
  const actual = Buffer.from(passwordHash(password, record.password_salt), 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  return { userId: record.user_id, personId: record.person_id, name: record.name, whatsapp: record.whatsapp, email: record.email, roles: rolesFor(record.user_id), cellIds: cellsFor(record.user_id), leaderCellIds: leaderCellsFor(record.person_id) };
}

export function createSession(actor) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
  execute('INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)', actor.userId, tokenHash(token), expiresAt);
  return { token, expiresAt };
}

export function actorFromSession(token) {
  execute('DELETE FROM sessions WHERE expires_at <= ?', new Date().toISOString());
  if (!token) return null;
  const record = one('SELECT u.id AS user_id, p.id AS person_id, p.name, p.whatsapp, p.email FROM sessions s JOIN users u ON u.id = s.user_id JOIN people p ON p.id = u.person_id WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1', tokenHash(token), new Date().toISOString());
  if (!record) return null;
  return { userId: record.user_id, personId: record.person_id, name: record.name, whatsapp: record.whatsapp, email: record.email, roles: rolesFor(record.user_id), cellIds: cellsFor(record.user_id), leaderCellIds: leaderCellsFor(record.person_id) };
}

export function endSession(token) { if (token) execute('DELETE FROM sessions WHERE token_hash = ?', tokenHash(token)); }

function audit(actor, action, entityType, entityId, summary) {
  execute('INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)', actor.userId, action, entityType, String(entityId), summary, new Date().toISOString());
}
function validRoles(input) {
  const selected = Array.isArray(input) ? [...new Set(input)] : [];
  const known = new Set(many('SELECT code FROM roles').map((row) => row.code));
  if (!selected.every((role) => known.has(role))) throw new Error('Função inválida');
  return selected;
}
function userRecord(userId) {
  return one('SELECT u.id, u.person_id, u.active, p.name, p.email, p.whatsapp FROM users u JOIN people p ON p.id = u.person_id WHERE u.id = ?', userId);
}

export function adminOverview() {
  const users = many('SELECT u.id, u.person_id, u.active, p.name, p.email, p.whatsapp FROM users u JOIN people p ON p.id = u.person_id ORDER BY p.name')
    .map((user) => { const userRoles = rolesFor(user.id); return { ...user, roles: userRoles, cellIds: userRoles.includes('supervisor') ? supervisorCellsFor(user.id) : cellsFor(user.id) }; });
  const cells = many('SELECT c.id, c.name, cl.person_id AS leader_person_id, lp.name AS leader_name, c.weekday, c.meeting_time, c.location, c.neighborhood, c.city, c.state, c.active FROM cells c LEFT JOIN cell_leadership cl ON cl.cell_id = c.id LEFT JOIN people lp ON lp.id = cl.person_id ORDER BY c.name')
    .map((cell) => ({ ...cell, members: many('SELECT p.id, p.name FROM cell_members cm JOIN people p ON p.id = cm.person_id WHERE cm.cell_id = ? ORDER BY p.name', cell.id) }));
  const people = many('SELECT id, name, whatsapp, email FROM people ORDER BY name');
  const auditLogs = many('SELECT a.action, a.entity_type, a.entity_id, a.summary, a.created_at, p.name AS actor FROM audit_logs a JOIN users u ON u.id = a.actor_user_id JOIN people p ON p.id = u.person_id ORDER BY a.created_at DESC, a.id DESC LIMIT 25');
  return { users, cells, people, roles: many('SELECT code, label FROM roles ORDER BY label'), auditLogs };
}

export function adminCreateUser(actor, input) {
  if (personByEmail(input.email) || one('SELECT id FROM people WHERE whatsapp = ?', input.whatsapp)) throw new Error('Já existe uma pessoa com este e-mail ou WhatsApp');
  const personId = createPerson(input);
  const salt = randomBytes(16).toString('hex');
  const userId = toId(execute('INSERT INTO users (person_id, password_hash, password_salt) VALUES (?, ?, ?)', personId, passwordHash(input.password, salt), salt));
  for (const role of validRoles(input.roles)) execute('INSERT INTO user_roles (user_id, role_code) VALUES (?, ?)', userId, role);
  audit(actor, 'create', 'user', userId, `Usuário criado: ${input.name}`);
  return userId;
}
export function adminUpdateUser(actor, userId, input) {
  const user = userRecord(userId); if (!user) throw new Error('Usuário não encontrado');
  execute('UPDATE people SET name = ?, whatsapp = ?, email = ? WHERE id = ?', input.name.trim(), input.whatsapp.trim(), input.email.trim(), user.person_id);
  execute('UPDATE users SET active = ? WHERE id = ?', input.active ? 1 : 0, userId);
  execute('DELETE FROM user_roles WHERE user_id = ?', userId);
  for (const role of validRoles(input.roles)) execute('INSERT INTO user_roles (user_id, role_code) VALUES (?, ?)', userId, role);
  audit(actor, 'update', 'user', userId, `Usuário atualizado: ${input.name}`);
}
export function adminResetPassword(actor, userId, password) {
  if (!userRecord(userId)) throw new Error('Usuário não encontrado');
  const salt = randomBytes(16).toString('hex'); execute('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?', passwordHash(password, salt), salt, userId);
  audit(actor, 'reset_password', 'user', userId, 'Senha redefinida');
}
export function adminCreateCell(actor, input) {
  const cell = normalizeCellInput(input);
  const id = input.id || cell.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  if (one('SELECT id FROM cells WHERE id = ?', id)) throw new Error('Já existe uma célula com esse nome');
  execute('INSERT INTO cells (id, name, leader_name, schedule, location, notice, active, weekday, meeting_time, neighborhood, city, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', id, cell.name, '', `${cell.weekday} · ${cell.meetingTime}`, cell.location, '', cell.active ? 1 : 0, cell.weekday, cell.meetingTime, cell.neighborhood, cell.city, cell.state);
  audit(actor, 'create', 'cell', id, `Célula criada: ${cell.name}`); return id;
}
export function adminUpdateCell(actor, cellId, input) {
  if (!one('SELECT id FROM cells WHERE id = ?', cellId)) throw new Error('Célula não encontrada');
  const cell = normalizeCellInput(input);
  execute('UPDATE cells SET name = ?, schedule = ?, location = ?, active = ?, weekday = ?, meeting_time = ?, neighborhood = ?, city = ?, state = ? WHERE id = ?', cell.name, `${cell.weekday} · ${cell.meetingTime}`, cell.location, cell.active ? 1 : 0, cell.weekday, cell.meetingTime, cell.neighborhood, cell.city, cell.state, cellId);
  audit(actor, 'update', 'cell', cellId, `Célula atualizada: ${cell.name}`);
}
export function adminSetLeader(actor, cellId, personId) {
  if (!one('SELECT id FROM cells WHERE id = ?', cellId)) throw new Error('Célula não encontrada');
  if (!personId) {
    execute('DELETE FROM cell_leadership WHERE cell_id = ?', cellId);
    execute("UPDATE cells SET leader_name = '' WHERE id = ?", cellId);
    audit(actor, 'clear_leader', 'cell', cellId, 'Liderança removida');
    return;
  }
  const person = one('SELECT name FROM people WHERE id = ?', personId); if (!person) throw new Error('Pessoa não encontrada');
  execute('INSERT INTO cell_leadership (cell_id, person_id, updated_at) VALUES (?, ?, ?) ON CONFLICT(cell_id) DO UPDATE SET person_id = excluded.person_id, updated_at = excluded.updated_at', cellId, personId, new Date().toISOString());
  execute('UPDATE cells SET leader_name = ? WHERE id = ?', person.name, cellId); audit(actor, 'set_leader', 'cell', cellId, `Líder definido: ${person.name}`);
  const user = one('SELECT id FROM users WHERE person_id = ?', personId); if (user) execute('INSERT OR IGNORE INTO user_roles (user_id, role_code) VALUES (?, ?)', user.id, 'leader');
}
export function adminSetMembers(actor, cellId, personIds) {
  if (!one('SELECT id FROM cells WHERE id = ?', cellId)) throw new Error('Célula não encontrada');
  const unique = [...new Set((personIds || []).map(Number))];
  database.exec('BEGIN'); try { execute('DELETE FROM cell_members WHERE cell_id = ?', cellId); for (const personId of unique) { if (!one('SELECT id FROM people WHERE id = ?', personId)) throw new Error('Pessoa não encontrada'); execute('DELETE FROM cell_members WHERE person_id = ?', personId); execute('INSERT INTO cell_members (cell_id, person_id) VALUES (?, ?)', cellId, personId); } database.exec('COMMIT'); } catch (error) { database.exec('ROLLBACK'); throw error; }
  audit(actor, 'set_members', 'cell', cellId, 'Membros da célula atualizados');
}
export function adminSetSupervisorScope(actor, userId, cellIds) {
  if (!rolesFor(userId).includes('supervisor')) throw new Error('O usuário selecionado não é Supervisor');
  const unique = [...new Set((cellIds || []).map(String))]; for (const id of unique) if (!one('SELECT id FROM cells WHERE id = ?', id)) throw new Error('Célula não encontrada');
  execute('DELETE FROM supervisor_cell_scopes WHERE user_id = ?', userId); for (const id of unique) execute('INSERT INTO supervisor_cell_scopes (user_id, cell_id) VALUES (?, ?)', userId, id);
  audit(actor, 'set_scope', 'user', userId, 'Escopo de Supervisor atualizado');
}

ensureStructuralRoles();
migrateLegacyLeadership();

import { getPostgresPool } from './postgres.mjs';

function normalizeName(value) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > 120) throw new Error('Nome inválido.');
  return normalized;
}

function normalizeEmail(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error('E-mail inválido.');
  return normalized;
}

function normalizeWhatsApp(value) {
  const normalized = String(value || '').replace(/\D/g, '');
  if (normalized.length < 10 || normalized.length > 13) throw new Error('WhatsApp inválido.');
  return normalized;
}

export function normalizeBirthDate(value) {
  if (value == null || value === '') return null;
  const normalized = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw new Error('Data de nascimento inválida.');
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized || normalized > new Date().toISOString().slice(0, 10)) {
    throw new Error('Data de nascimento inválida.');
  }
  return normalized;
}

function mapCell(row) {
  if (!row?.id) return null;
  return {
    id: row.id,
    name: row.name,
    weekday: row.weekday,
    meetingTime: row.meeting_time,
    location: [row.address_line, row.neighborhood, row.city, row.state].filter(Boolean).join(' · '),
    active: row.is_active
  };
}

function requirePostgresActor(actor) {
  if (!actor?.userId || actor.source !== 'postgres') throw new Error('Sessão PostgreSQL inválida.');
}

export async function getOwnProfile(actor) {
  requirePostgresActor(actor);
  const pool = getPostgresPool();
  const identity = await pool.query(
    `select people.full_name as name, people.email, people.whatsapp, people.birth_date,
            users.id as user_id, people.id as person_id
       from public.app_users users
       join public.people people on people.id = users.person_id
      where users.id = $1 and users.is_active = true`,
    [actor.userId]
  );
  if (!identity.rowCount) return null;
  const person = identity.rows[0];
  const [roles, membership, leaderships, secretaries, supervisedCells] = await Promise.all([
    pool.query('select role_code from public.user_roles where user_id = $1 order by role_code', [actor.userId]),
    pool.query(
      `select cells.id, cells.name, cells.weekday, cells.meeting_time, cells.address_line, cells.neighborhood, cells.city, cells.state, cells.is_active
         from public.cell_memberships memberships
         join public.cells cells on cells.id = memberships.cell_id
        where memberships.person_id = $1 and memberships.ended_at is null
        limit 1`,
      [person.person_id]
    ),
    pool.query(
      `select cells.id, cells.name, cells.weekday, cells.meeting_time, cells.address_line, cells.neighborhood, cells.city, cells.state, cells.is_active
         from public.cell_leaderships leaderships
         join public.cells cells on cells.id = leaderships.cell_id
        where leaderships.person_id = $1 and leaderships.ended_at is null
        order by cells.name`,
      [person.person_id]
    ),
    pool.query(
      `select cells.id, cells.name, cells.weekday, cells.meeting_time, cells.address_line, cells.neighborhood, cells.city, cells.state, cells.is_active
         from public.cell_secretaries secretaries
         join public.cells cells on cells.id = secretaries.cell_id
        where secretaries.person_id = $1 and secretaries.ended_at is null
        order by cells.name`,
      [person.person_id]
    ),
    pool.query(
      `select cells.id, cells.name, cells.weekday, cells.meeting_time, cells.address_line, cells.neighborhood, cells.city, cells.state, cells.is_active
         from public.supervisor_cell_scopes scopes
         join public.cells cells on cells.id = scopes.cell_id
        where scopes.user_id = $1
        order by cells.name`,
      [actor.userId]
    )
  ]);
  return {
    name: person.name,
    email: person.email,
    whatsapp: person.whatsapp,
    birthDate: person.birth_date ?? null,
    roles: roles.rows.map((row) => row.role_code),
    membership: mapCell(membership.rows[0]),
    leaderships: leaderships.rows.map(mapCell),
    secretariats: secretaries.rows.map(mapCell),
    supervisedCells: supervisedCells.rows.map(mapCell),
    settings: { profileEditing: true }
  };
}

export function profileBootstrap(actor, profile) {
  const membership = profile.membership;
  return {
    currentUser: { id: actor.personId, name: profile.name, whatsapp: profile.whatsapp, email: profile.email, cellId: membership?.id ?? null, roles: profile.roles },
    profile,
    cells: membership ? [membership] : [],
    visitors: [],
    referrals: [],
    referralsToCell: [],
    notices: [],
    administration: null
  };
}

export async function updateOwnProfile(actor, input) {
  requirePostgresActor(actor);
  const name = normalizeName(input.name);
  const email = normalizeEmail(input.email);
  const whatsapp = normalizeWhatsApp(input.whatsapp);
  const birthDate = normalizeBirthDate(input.birthDate);
  try {
    const result = await getPostgresPool().query(
      `update public.people people
          set full_name = $1, email = $2, whatsapp = $3, birth_date = $4
         from public.app_users users
        where people.id = users.person_id
          and users.id = $5
          and users.is_active = true
      returning people.id`,
      [name, email, whatsapp, birthDate, actor.userId]
    );
    if (!result.rowCount) return null;
  } catch (error) {
    if (error?.code === '23505') throw new Error('E-mail ou WhatsApp já está em uso.');
    throw error;
  }
  return getOwnProfile(actor);
}

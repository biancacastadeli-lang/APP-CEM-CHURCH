import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { getPostgresPool, isPostgresConfigured } from './postgres.mjs';

const sessionDurationMs = 1000 * 60 * 60 * 24 * 7;

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeWhatsApp(value) {
  return String(value || '').replace(/\D/g, '');
}

export function passwordHash(password, salt) {
  return scryptSync(password, salt, 64).toString('hex');
}

export function verifyPassword(password, storedHash, salt) {
  if (typeof password !== 'string' || typeof storedHash !== 'string' || typeof salt !== 'string') return false;
  const expected = Buffer.from(storedHash, 'hex');
  const derived = Buffer.from(passwordHash(password, salt), 'hex');
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

function actorFromRow(row) {
  return {
    userId: row.user_id,
    personId: row.person_id,
    name: row.name,
    whatsapp: row.whatsapp,
    email: row.email,
    roles: row.roles || [],
    source: 'postgres'
  };
}

async function findUserByIdentity(client, identity) {
  const email = normalizeEmail(identity);
  const whatsapp = normalizeWhatsApp(identity);
  if (!email && !whatsapp) return null;
  const result = await client.query(
    `select users.id as user_id, people.id as person_id, people.full_name as name, people.whatsapp, people.email,
            users.password_hash, users.password_salt, users.is_active,
            coalesce(array_agg(user_roles.role_code order by user_roles.role_code)
              filter (where user_roles.role_code is not null), '{}'::text[]) as roles
       from public.app_users users
       join public.people people on people.id = users.person_id
       left join public.user_roles user_roles on user_roles.user_id = users.id
      where lower(btrim(coalesce(people.email, ''))) = $1
         or regexp_replace(people.whatsapp, '\\D', '', 'g') = $2
      group by users.id, people.id
      limit 1`,
    [email, whatsapp]
  );
  return result.rows[0] || null;
}

export async function authenticatePostgres(identity, password) {
  if (!isPostgresConfigured()) return null;
  const client = await getPostgresPool().connect();
  try {
    const user = await findUserByIdentity(client, identity);
    if (!user || !user.is_active || !verifyPassword(password, user.password_hash, user.password_salt)) return null;
    return actorFromRow(user);
  } finally {
    client.release();
  }
}

export async function createPostgresSession(actor) {
  if (!actor?.userId || actor.source !== 'postgres') throw new Error('Usuário PostgreSQL inválido para sessão.');
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + sessionDurationMs).toISOString();
  await getPostgresPool().query(
    `insert into public.app_sessions (user_id, token_hash, expires_at)
     values ($1, $2, $3)`,
    [actor.userId, tokenHash(token), expiresAt]
  );
  return { token, expiresAt };
}

export async function actorFromPostgresSession(token) {
  if (!isPostgresConfigured() || !token) return null;
  const result = await getPostgresPool().query(
    `select users.id as user_id, people.id as person_id, people.full_name as name, people.whatsapp, people.email,
            coalesce(array_agg(user_roles.role_code order by user_roles.role_code)
              filter (where user_roles.role_code is not null), '{}'::text[]) as roles
       from public.app_sessions sessions
       join public.app_users users on users.id = sessions.user_id
       join public.people people on people.id = users.person_id
       left join public.user_roles user_roles on user_roles.user_id = users.id
      where sessions.token_hash = $1
        and sessions.expires_at > now()
        and sessions.revoked_at is null
        and users.is_active = true
      group by users.id, people.id
      limit 1`,
    [tokenHash(token)]
  );
  return result.rowCount ? actorFromRow(result.rows[0]) : null;
}

export async function revokePostgresSession(token) {
  if (!isPostgresConfigured() || !token) return;
  await getPostgresPool().query(
    `update public.app_sessions
        set revoked_at = now()
      where token_hash = $1
        and revoked_at is null`,
    [tokenHash(token)]
  );
}

export function postgresBootstrap(actor) {
  return {
    currentUser: { id: actor.personId, name: actor.name, whatsapp: actor.whatsapp, email: actor.email, cellId: null, roles: actor.roles },
    cells: [],
    visitors: [],
    referrals: [],
    referralsToCell: [],
    notices: [],
    administration: null
  };
}

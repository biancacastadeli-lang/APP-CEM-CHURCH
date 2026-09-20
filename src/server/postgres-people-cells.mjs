import { getPostgresPool } from './postgres.mjs';
import { randomBytes } from 'node:crypto';
import { passwordHash } from './postgres-auth.mjs';

const personStatuses = new Set(['member', 'visitor', 'integrating', 'inactive', 'transferred']);
const cellFunctionCodes = new Set(['host', 'social_assistant']);

function text(value, label, maxLength, { optional = true } = {}) {
  if (value == null || value === '') {
    if (optional) return null;
    throw new Error(`${label} é obrigatório.`);
  }
  if (typeof value !== 'string') throw new Error(`${label} é inválido.`);
  const normalized = value.trim();
  if (!normalized && optional) return null;
  if (!normalized || normalized.length > maxLength) throw new Error(`${label} é inválido.`);
  return normalized;
}

function whatsapp(value) {
  const normalized = String(value || '').replace(/\D/g, '');
  if (normalized.length < 10 || normalized.length > 13) throw new Error('WhatsApp inválido.');
  return normalized;
}

function email(value) {
  const normalized = text(value, 'E-mail', 254);
  if (normalized && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error('E-mail inválido.');
  return normalized?.toLowerCase() ?? null;
}

function date(value, label, { optional = true } = {}) {
  if (value == null || value === '') {
    if (optional) return null;
    return new Date().toISOString().slice(0, 10);
  }
  const normalized = String(value).trim();
  const parsed = new Date(`${normalized}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) throw new Error(`${label} inválida.`);
  return normalized;
}

function uuid(value, label) {
  const normalized = String(value || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) throw new Error(`${label} inválido.`);
  return normalized;
}

function personIds(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(',');
  const unique = [...new Set(values.filter(Boolean).map((item) => uuid(item, 'Liderança')))];
  if (unique.length > 8) throw new Error('Uma célula pode possuir no máximo oito lideranças ativas.');
  return unique;
}

function personInput(input) {
  const status = input.personStatus == null || input.personStatus === '' ? null : String(input.personStatus).trim().toLowerCase();
  if (status && !personStatuses.has(status)) throw new Error('Situação da pessoa inválida.');
  const sex = input.sex == null || input.sex === '' ? null : String(input.sex).trim().toLowerCase();
  if (sex && !['female', 'male'].includes(sex)) throw new Error('Sexo inválido.');
  const state = text(input.state, 'Estado', 2)?.toUpperCase() ?? null;
  if (state && !/^[A-Z]{2}$/.test(state)) throw new Error('Estado inválido.');
  const postalCode = text(input.postalCode, 'CEP', 20)?.replace(/\D/g, '') ?? null;
  if (postalCode && postalCode.length !== 8) throw new Error('CEP inválido.');
  return {
    fullName: text(input.fullName ?? input.name, 'Nome completo', 120, { optional: false }),
    whatsapp: whatsapp(input.whatsapp), email: email(input.email), birthDate: date(input.birthDate, 'Data de nascimento'), sex,
    postalCode, addressLine: text(input.addressLine, 'Logradouro', 180), addressNumber: text(input.addressNumber, 'Número', 20),
    addressComplement: text(input.addressComplement, 'Complemento', 120), neighborhood: text(input.neighborhood, 'Bairro', 100), city: text(input.city, 'Cidade', 100), state,
    personStatus: status, baptized: input.baptized === true, baptizedOn: date(input.baptizedOn, 'Data de batismo')
  };
}

function cellInput(input) {
  const weekday = Number(input.weekday);
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new Error('Dia da semana inválido.');
  const meetingTime = String(input.meetingTime || '').trim();
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(meetingTime)) throw new Error('Horário inválido.');
  const state = text(input.state, 'Estado', 2, { optional: false })?.toUpperCase();
  if (!/^[A-Z]{2}$/.test(state)) throw new Error('Estado inválido.');
  return {
    name: text(input.name, 'Nome da célula', 120, { optional: false }), weekday, meetingTime,
    addressLine: text(input.addressLine, 'Local/endereço', 180, { optional: false }), neighborhood: text(input.neighborhood, 'Bairro', 100, { optional: false }),
    city: text(input.city, 'Cidade', 100, { optional: false }), state, isActive: input.isActive !== false,
    ministryId: uuid(input.ministryId, 'Ministério'), supervisorPersonId: input.supervisorPersonId ? uuid(input.supervisorPersonId, 'Supervisor') : null,
    leaderIds: personIds(input.leaderIds)
  };
}

function mapCell(row) {
  return { id: row.id, name: row.name, weekday: row.weekday, meetingTime: row.meeting_time, addressLine: row.address_line, neighborhood: row.neighborhood, city: row.city, state: row.state, isActive: row.is_active, ministry: row.ministry_id ? { id: row.ministry_id, name: row.ministry_name } : null, supervisor: row.supervisor_person_id ? { id: row.supervisor_person_id, fullName: row.supervisor_name } : null };
}

function mapPerson(row) {
  return { id: row.id, fullName: row.full_name, whatsapp: row.whatsapp, email: row.email, birthDate: row.birth_date ?? null, sex: row.sex ?? null, postalCode: row.postal_code ?? null, addressLine: row.address_line ?? null, addressNumber: row.address_number ?? null, addressComplement: row.address_complement ?? null, neighborhood: row.neighborhood ?? null, city: row.city ?? null, state: row.state ?? null, personStatus: row.person_status ?? null, baptized: row.baptized, baptizedOn: row.baptized_on ?? null, imageConsent: row.image_consent === true, hasPhoto: Boolean(row.photo_storage_bucket && row.photo_storage_path) };
}

function isAdmin(actor) { return actor.roles.includes('admin'); }
function isPastor(actor) { return actor.roles.includes('pastor'); }
function isSupervisor(actor) { return actor.roles.includes('supervisor'); }
function requireAdmin(actor) { if (!isAdmin(actor)) { const error = new Error('Sem permissão administrativa.'); error.status = 403; throw error; } }
function requireReadAccess(actor) { if (!isAdmin(actor) && !isPastor(actor) && !isSupervisor(actor)) { const error = new Error('Sem permissão para consultar Pessoas e Células.'); error.status = 403; throw error; } }

async function audit(client, actor, action, entityType, entityId, summary, metadata = {}) {
  await client.query(`insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, summary, metadata) values ($1,$2,$3,$4,$5,$6::jsonb)`, [actor.userId, action, entityType, String(entityId), summary, JSON.stringify(metadata)]);
}

async function scopesFor(client, actor) {
  if (!isSupervisor(actor) || isAdmin(actor) || isPastor(actor)) return null;
  const result = await client.query(
    `select cell_id from public.supervisor_cell_scopes where user_id = $1
      union
     select assignments.cell_id
       from public.cell_supervisor_assignments assignments
       join public.app_users users on users.person_id=assignments.person_id
      where users.id=$1 and assignments.ended_at is null`, [actor.userId]
  );
  return result.rows.map((row) => row.cell_id);
}

async function withTransaction(work) {
  const client = await getPostgresPool().connect();
  try { await client.query('begin'); const result = await work(client); await client.query('commit'); return result; }
  catch (error) { await client.query('rollback').catch(() => {}); throw error; }
  finally { client.release(); }
}

function password(value) {
  const normalized = String(value || '');
  if (normalized.length < 10 || !/[A-Z]/.test(normalized) || !/[a-z]/.test(normalized) || !/\d/.test(normalized) || !/[^A-Za-z0-9]/.test(normalized)) {
    throw new Error('A senha deve ter ao menos 10 caracteres, maiúscula, minúscula, número e caractere especial.');
  }
  return normalized;
}

function accessRoles(value) {
  const available = new Set(['member', 'leader', 'welcome1', 'welcome2', 'supervisor', 'pastor', 'secretary', 'admin']);
  const selected = [...new Set((Array.isArray(value) ? value : []).map((item) => String(item || '').trim()).filter(Boolean))];
  if (!selected.length || selected.some((role) => !available.has(role))) throw new Error('Selecione ao menos um papel de acesso válido.');
  return selected;
}

async function updateStatusAuthor(client, personId, actor) {
  await client.query(
    `update public.person_status_history set changed_by_user_id = $2
      where id = (select id from public.person_status_history where person_id = $1 and source_type = 'person' and changed_by_user_id is null order by created_at desc, id desc limit 1)`,
    [personId, actor.userId]
  );
}

export async function listPeople(actor, search = '') {
  requireReadAccess(actor);
  const client = await getPostgresPool().connect();
  try {
    const scopes = await scopesFor(client, actor); const term = String(search || '').trim();
    const result = await client.query(
      `select people.id, people.full_name, people.whatsapp, people.person_status, people.photo_storage_bucket, people.photo_storage_path, cells.id as cell_id, cells.name as cell_name
         from public.people people
         left join public.cell_memberships memberships on memberships.person_id = people.id and memberships.ended_at is null
         left join public.cells cells on cells.id = memberships.cell_id
        where ($1::text = '' or people.full_name ilike '%' || $1 || '%' or people.whatsapp like '%' || regexp_replace($1, '\\D','','g') || '%')
          and ($2::uuid[] is null or memberships.cell_id = any($2::uuid[]))
        order by people.full_name
        limit 200`,
      [term, scopes]
    );
    return result.rows.map((row) => ({ id: row.id, fullName: row.full_name, whatsapp: row.whatsapp, personStatus: row.person_status ?? null, hasPhoto: Boolean(row.photo_storage_bucket && row.photo_storage_path), photoUrl: isAdmin(actor) && row.photo_storage_bucket ? `/api/people/${row.id}/photo` : null, cell: row.cell_id ? { id: row.cell_id, name: row.cell_name } : null }));
  } finally { client.release(); }
}

export async function getPerson(actor, personId) {
  requireReadAccess(actor);
  const client = await getPostgresPool().connect();
  try {
    const scopes = await scopesFor(client, actor);
    const person = await client.query(
      `select people.* from public.people people
       where people.id = $1 and ($2::uuid[] is null or exists (select 1 from public.cell_memberships memberships where memberships.person_id=people.id and memberships.ended_at is null and memberships.cell_id=any($2::uuid[])))`,
      [personId, scopes]
    );
    if (!person.rowCount) return null;
    const [membership, leaderships, secretariats, appRoles, access, assignments, modules, history] = await Promise.all([
      client.query(`select cells.* from public.cell_memberships memberships join public.cells cells on cells.id=memberships.cell_id where memberships.person_id=$1 and memberships.ended_at is null limit 1`, [personId]),
      client.query(`select cells.* from public.cell_leaderships links join public.cells cells on cells.id=links.cell_id where links.person_id=$1 and links.ended_at is null order by cells.name`, [personId]),
      client.query(`select cells.* from public.cell_secretaries links join public.cells cells on cells.id=links.cell_id where links.person_id=$1 and links.ended_at is null order by cells.name`, [personId]),
      client.query(`select distinct roles.code from public.app_users users join public.user_roles links on links.user_id=users.id join public.roles roles on roles.code=links.role_code where users.person_id=$1 order by roles.code`, [personId]),
      client.query(`select id,is_active from public.app_users where person_id=$1 limit 1`, [personId]),
      client.query(`select assignments.id, assignments.started_at, assignments.ended_at, functions.code, functions.name, functions.scope_type, cells.id as cell_id, cells.name as cell_name from public.person_ministry_assignments assignments join public.ministry_functions functions on functions.code=assignments.ministry_function_code left join public.cells cells on cells.id=assignments.cell_id where assignments.person_id=$1 and assignments.ended_at is null order by functions.name`, [personId]),
      client.query(`select modules.code, modules.name, completions.completed_on from public.formation_modules modules left join public.person_formation_completions completions on completions.module_code=modules.code and completions.person_id=$1 where modules.is_active order by modules.display_order`, [personId]),
      (isAdmin(actor) || isPastor(actor)) ? client.query(`select source_type, previous_status, current_status, created_at from public.person_status_history where person_id=$1 order by created_at desc`, [personId]) : Promise.resolve({ rows: [] })
    ]);
    const mappedPerson = mapPerson(person.rows[0]);
    if (isAdmin(actor) && mappedPerson.hasPhoto) mappedPerson.photoUrl = `/api/people/${personId}/photo`;
    return { person: mappedPerson, membership: mapCell(membership.rows[0]), leaderships: leaderships.rows.map(mapCell), secretariats: secretariats.rows.map(mapCell), appRoles: appRoles.rows.map((row) => row.code), access: { hasAccess: Boolean(access.rowCount), isActive: access.rows[0]?.is_active === true, roles: appRoles.rows.map((row) => row.code) }, functions: assignments.rows.map((row) => ({ id: row.id, code: row.code, name: row.name, scopeType: row.scope_type, cell: row.cell_id ? { id: row.cell_id, name: row.cell_name } : null, startedAt: row.started_at, endedAt: row.ended_at })), journey: { modules: modules.rows.map((row) => ({ code: row.code, name: row.name, completedOn: row.completed_on ?? null })), baptized: person.rows[0].baptized, baptizedOn: person.rows[0].baptized_on ?? null }, history: history.rows.map((row) => ({ sourceType: row.source_type, previousStatus: row.previous_status, currentStatus: row.current_status, createdAt: row.created_at })) };
  } finally { client.release(); }
}

export async function createPerson(actor, input) {
  requireAdmin(actor); const values = personInput(input);
  return withTransaction(async (client) => {
    const result = await client.query(
      `insert into public.people (full_name, whatsapp, email, birth_date, sex, postal_code, address_line, address_number, address_complement, neighborhood, city, state, person_status, baptized, baptized_on)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning id`,
      [values.fullName, values.whatsapp, values.email, values.birthDate, values.sex, values.postalCode, values.addressLine, values.addressNumber, values.addressComplement, values.neighborhood, values.city, values.state, values.personStatus, values.baptized, values.baptized ? values.baptizedOn : null]
    );
    const personId = result.rows[0].id; if (values.personStatus) await updateStatusAuthor(client, personId, actor);
    await audit(client, actor, 'create_person', 'person', personId, 'Pessoa cadastrada.', { fields: ['full_name', 'whatsapp', 'person_status'] });
    return personId;
  }).catch((error) => { if (error?.code === '23505') throw new Error('Já existe uma pessoa com este WhatsApp ou e-mail.'); throw error; });
}

export async function updatePerson(actor, personId, input) {
  requireAdmin(actor); const values = personInput(input);
  return withTransaction(async (client) => {
    const before = await client.query('select person_status from public.people where id=$1 for update', [personId]);
    if (!before.rowCount) return false;
    const result = await client.query(
      `update public.people set full_name=$1, whatsapp=$2, email=$3, birth_date=$4, sex=$5, postal_code=$6, address_line=$7, address_number=$8, address_complement=$9, neighborhood=$10, city=$11, state=$12, person_status=$13, baptized=$14, baptized_on=$15
        where id=$16 returning id, person_status`,
      [values.fullName, values.whatsapp, values.email, values.birthDate, values.sex, values.postalCode, values.addressLine, values.addressNumber, values.addressComplement, values.neighborhood, values.city, values.state, values.personStatus, values.baptized, values.baptized ? values.baptizedOn : null, personId]
    );
    if (!result.rowCount) return false; if (before.rows[0].person_status !== values.personStatus && values.personStatus) await updateStatusAuthor(client, personId, actor);
    await audit(client, actor, 'update_person', 'person', personId, 'Dados da pessoa atualizados.', { fields: ['personal_data', 'contact', 'address', 'person_status', 'baptism'] });
    return true;
  }).catch((error) => { if (error?.code === '23505') throw new Error('Já existe uma pessoa com este WhatsApp ou e-mail.'); throw error; });
}

export async function grantPersonAccess(actor, personId, input) {
  requireAdmin(actor); const selectedRoles = accessRoles(input.roles); const initialPassword = password(input.password);
  return withTransaction(async (client) => {
    const person = await client.query('select id from public.people where id=$1 for update', [personId]);
    if (!person.rowCount) return false;
    const existing = await client.query('select id,is_active from public.app_users where person_id=$1 for update', [personId]);
    const salt = randomBytes(16).toString('hex'); const hash = passwordHash(initialPassword, salt);
    let userId;
    if (existing.rowCount) {
      if (existing.rows[0].is_active) { const error = new Error('Esta pessoa já possui acesso ativo ao aplicativo.'); error.status = 409; throw error; }
      userId = existing.rows[0].id;
      await client.query('update public.app_users set is_active=true,password_hash=$1,password_salt=$2,updated_at=now() where id=$3', [hash, salt, userId]);
      await client.query('update public.app_sessions set revoked_at=coalesce(revoked_at,now()) where user_id=$1 and revoked_at is null', [userId]);
    } else {
      const user = await client.query('insert into public.app_users (person_id,password_hash,password_salt,is_active) values ($1,$2,$3,true) returning id', [personId, hash, salt]);
      userId = user.rows[0].id;
    }
    // A concessão adiciona os papéis selecionados sem remover papéis que possam
    // estar sustentando vínculos organizacionais já existentes.
    for (const role of selectedRoles) await client.query('insert into public.user_roles (user_id,role_code) values ($1,$2) on conflict do nothing', [userId, role]);
    await audit(client, actor, 'grant_app_access', 'person', personId, 'Acesso ao aplicativo concedido.', { roles: selectedRoles });
    return true;
  });
}

export async function revokePersonAccess(actor, personId) {
  requireAdmin(actor);
  return withTransaction(async (client) => {
    const user = await client.query('select id,is_active from public.app_users where person_id=$1 for update', [personId]);
    if (!user.rowCount) return false;
    if (user.rows[0].is_active) await client.query('update public.app_users set is_active=false,updated_at=now() where id=$1', [user.rows[0].id]);
    await client.query('update public.app_sessions set revoked_at=coalesce(revoked_at,now()) where user_id=$1 and revoked_at is null', [user.rows[0].id]);
    await audit(client, actor, 'revoke_app_access', 'person', personId, 'Acesso ao aplicativo revogado.', {});
    return true;
  });
}

export async function setPersonImageConsent(actor, personId, consent) {
  requireAdmin(actor);
  if (consent !== true) throw new Error('O registro de autorização de imagem é necessário para enviar uma foto.');
  return withTransaction(async (client) => {
    const person = await client.query('select id,image_consent from public.people where id=$1 for update', [personId]);
    if (!person.rowCount) return false;
    if (!person.rows[0].image_consent) {
      await client.query('insert into public.person_image_consent_records (person_id,authorized,recorded_by_user_id) values ($1,true,$2)', [personId, actor.userId]);
      await audit(client, actor, 'record_image_consent', 'person', personId, 'Autorização de uso de imagem registrada.', {});
    }
    return true;
  });
}

export async function setPersonPhotoReference(actor, personId, asset) {
  requireAdmin(actor);
  return withTransaction(async (client) => {
    const person = await client.query('select image_consent,photo_storage_bucket,photo_storage_path from public.people where id=$1 for update', [personId]);
    if (!person.rowCount) return null;
    if (!person.rows[0].image_consent) { const error = new Error('Registre a autorização de uso de imagem antes de enviar a foto.'); error.status = 409; throw error; }
    await client.query('update public.people set photo_storage_bucket=$1,photo_storage_path=$2,updated_at=now() where id=$3', [asset.bucket, asset.path, personId]);
    await audit(client, actor, 'update_person_photo', 'person', personId, 'Foto de perfil atualizada.', {});
    return { previous: person.rows[0].photo_storage_bucket ? { bucket: person.rows[0].photo_storage_bucket, path: person.rows[0].photo_storage_path } : null };
  });
}

export async function removePersonPhotoReference(actor, personId) {
  requireAdmin(actor);
  return withTransaction(async (client) => {
    const person = await client.query('select photo_storage_bucket,photo_storage_path from public.people where id=$1 for update', [personId]);
    if (!person.rowCount) return null;
    const previous = person.rows[0].photo_storage_bucket ? { bucket: person.rows[0].photo_storage_bucket, path: person.rows[0].photo_storage_path } : null;
    await client.query('update public.people set photo_storage_bucket=null,photo_storage_path=null,updated_at=now() where id=$1', [personId]);
    await audit(client, actor, 'remove_person_photo', 'person', personId, 'Foto de perfil removida.', {});
    return { previous };
  });
}

export async function personPhotoAsset(actor, personId) {
  const client = await getPostgresPool().connect();
  try {
    if (!isAdmin(actor) && actor.personId !== personId) { const error = new Error('Sem permissão para consultar esta foto.'); error.status = 403; throw error; }
    const result = await client.query('select photo_storage_bucket,photo_storage_path from public.people where id=$1', [personId]);
    if (!result.rowCount) return null;
    return result.rows[0].photo_storage_bucket ? { bucket: result.rows[0].photo_storage_bucket, path: result.rows[0].photo_storage_path } : null;
  } finally { client.release(); }
}

export async function setJourneyModule(actor, personId, input) {
  requireAdmin(actor); const moduleCode = String(input.moduleCode || ''); const completedOn = date(input.completedOn, 'Data de conclusão');
  if (!moduleCode) throw new Error('Módulo inválido.');
  return withTransaction(async (client) => {
    const result = await client.query(`insert into public.person_formation_completions (person_id,module_code,completed_on,recorded_by_user_id) values ($1,$2,$3,$4) on conflict (person_id,module_code) do update set completed_on=excluded.completed_on,recorded_by_user_id=excluded.recorded_by_user_id,recorded_at=now() returning person_id`, [personId, moduleCode, completedOn, actor.userId]);
    if (!result.rowCount) return false; await audit(client, actor, 'update_person_journey', 'person', personId, 'Jornada atualizada.', { moduleCode }); return true;
  });
}

export async function listCells(actor) {
  requireReadAccess(actor); const client = await getPostgresPool().connect();
  try {
    const scopes = await scopesFor(client, actor);
    const result = await client.query(
      `select cells.*,ministries.name as ministry_name,
        supervisor.person_id as supervisor_person_id,supervisor_people.full_name as supervisor_name,
        coalesce(leaders.items,'[]'::jsonb) as leaders
       from public.cells cells
       left join public.ministries ministries on ministries.id=cells.ministry_id
       left join lateral (
         select assignments.person_id from public.cell_supervisor_assignments assignments
         where assignments.cell_id=cells.id and assignments.ended_at is null limit 1
       ) supervisor on true
       left join public.people supervisor_people on supervisor_people.id=supervisor.person_id
       left join lateral (
         select jsonb_agg(jsonb_build_object('id',people.id,'fullName',people.full_name) order by people.full_name) as items
           from public.cell_leaderships links join public.people people on people.id=links.person_id
          where links.cell_id=cells.id and links.ended_at is null
       ) leaders on true
       where $1::uuid[] is null or cells.id=any($1::uuid[])
       order by cells.name`, [scopes]);
    return result.rows.map((row) => ({ ...mapCell(row), leaders: row.leaders || [], leaderName: row.leaders?.map((leader) => leader.fullName).join(' · ') || null }));
  } finally { client.release(); }
}

export async function getCell(actor, cellId) {
  requireReadAccess(actor); const client = await getPostgresPool().connect();
  try {
    const scopes = await scopesFor(client, actor);
    const cell = await client.query(
      `select cells.*,ministries.name as ministry_name,supervisors.person_id as supervisor_person_id,people.full_name as supervisor_name
         from public.cells cells
         left join public.ministries ministries on ministries.id=cells.ministry_id
         left join lateral (select person_id from public.cell_supervisor_assignments where cell_id=cells.id and ended_at is null limit 1) supervisors on true
         left join public.people people on people.id=supervisors.person_id
        where cells.id=$1 and ($2::uuid[] is null or cells.id=any($2::uuid[]))`, [cellId, scopes]);
    if (!cell.rowCount) return null;
    const [leaders, secretaries, members, functions, membershipHistory] = await Promise.all([
      client.query(`select people.id,people.full_name,users.id as user_id,exists(select 1 from public.user_roles roles where roles.user_id=users.id and roles.role_code='leader') as has_panel_access from public.cell_leaderships links join public.people people on people.id=links.person_id left join public.app_users users on users.person_id=people.id and users.is_active where links.cell_id=$1 and links.ended_at is null order by people.full_name`, [cellId]),
      client.query(`select people.id,people.full_name from public.cell_secretaries links join public.people people on people.id=links.person_id where links.cell_id=$1 and links.ended_at is null order by people.full_name`, [cellId]),
      client.query(`select people.id,people.full_name,people.person_status from public.cell_memberships links join public.people people on people.id=links.person_id where links.cell_id=$1 and links.ended_at is null order by people.full_name`, [cellId]),
      client.query(`select assignments.id,functions.code,functions.name,people.id as person_id,people.full_name from public.person_ministry_assignments assignments join public.ministry_functions functions on functions.code=assignments.ministry_function_code join public.people people on people.id=assignments.person_id where assignments.cell_id=$1 and assignments.ended_at is null order by functions.name,people.full_name`, [cellId]),
      isAdmin(actor) || isPastor(actor) ? client.query(`select people.full_name,links.started_at,links.ended_at from public.cell_memberships links join public.people people on people.id=links.person_id where links.cell_id=$1 order by links.created_at desc`, [cellId]) : Promise.resolve({ rows: [] })
    ]);
    const mappedLeaders = leaders.rows.map((row) => ({ id: row.id, fullName: row.full_name, hasPanelAccess: Boolean(row.has_panel_access) }));
    return { cell: mapCell(cell.rows[0]), leaders: mappedLeaders, leader: mappedLeaders[0] || null, secretaries: secretaries.rows.map((row) => ({ id: row.id, fullName: row.full_name })), members: members.rows.map((row) => ({ id: row.id, fullName: row.full_name, personStatus: row.person_status })), functions: functions.rows.map((row) => ({ id: row.id, code: row.code, name: row.name, person: { id: row.person_id, fullName: row.full_name } })), membershipHistory: membershipHistory.rows.map((row) => ({ fullName: row.full_name, startedAt: row.started_at, endedAt: row.ended_at })) };
  } finally { client.release(); }
}

async function syncLeaders(client, cellId, leaderIds, startedAt) {
  const current = await client.query('select id,person_id from public.cell_leaderships where cell_id=$1 and ended_at is null for update', [cellId]);
  const currentIds = new Set(current.rows.map((row) => row.person_id));
  for (const row of current.rows) if (!leaderIds.includes(row.person_id)) await client.query('update public.cell_leaderships set ended_at=$1 where id=$2', [startedAt, row.id]);
  for (const personId of leaderIds) if (!currentIds.has(personId)) await client.query('insert into public.cell_leaderships (cell_id,person_id,started_at) values ($1,$2,$3)', [cellId, personId, startedAt]);
}

async function syncCellSupervisor(client, cellId, supervisorPersonId, startedAt) {
  const current = await client.query('select id,person_id from public.cell_supervisor_assignments where cell_id=$1 and ended_at is null for update', [cellId]);
  if (current.rows[0]?.person_id === supervisorPersonId) return;
  for (const row of current.rows) await client.query('update public.cell_supervisor_assignments set ended_at=$1 where id=$2', [startedAt, row.id]);
  if (supervisorPersonId) await client.query('insert into public.cell_supervisor_assignments (cell_id,person_id,started_at) values ($1,$2,$3)', [cellId, supervisorPersonId, startedAt]);
}

export async function createCell(actor, input) {
  requireAdmin(actor); const values = cellInput(input); const startedAt = date(input.startedAt, 'Data de início', { optional: false });
  return withTransaction(async (client) => {
    const ministry = await client.query('select id from public.ministries where id=$1 and is_active', [values.ministryId]);
    if (!ministry.rowCount) throw new Error('Ministério não encontrado ou inativo.');
    const result = await client.query(`insert into public.cells (name,weekday,meeting_time,address_line,neighborhood,city,state,is_active,ministry_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`, [values.name, values.weekday, values.meetingTime, values.addressLine, values.neighborhood, values.city, values.state, values.isActive, values.ministryId]);
    await syncLeaders(client, result.rows[0].id, values.leaderIds, startedAt);
    await syncCellSupervisor(client, result.rows[0].id, values.supervisorPersonId, startedAt);
    await audit(client, actor, 'create_cell', 'cell', result.rows[0].id, 'Célula cadastrada.', { fields: ['name', 'ministry', 'schedule', 'address', 'is_active'], ministryId: values.ministryId });
    return result.rows[0].id;
  }).catch((error) => { if (error?.code === '23505') throw new Error('Já existe uma célula com este nome ou vínculo ativo.'); throw error; });
}

export async function updateCell(actor, cellId, input) {
  requireAdmin(actor); const values = cellInput(input); const startedAt = date(input.startedAt, 'Data de início', { optional: false });
  return withTransaction(async (client) => {
    const ministry = await client.query('select id from public.ministries where id=$1 and is_active', [values.ministryId]);
    if (!ministry.rowCount) throw new Error('Ministério não encontrado ou inativo.');
    const result = await client.query(`update public.cells set name=$1,weekday=$2,meeting_time=$3,address_line=$4,neighborhood=$5,city=$6,state=$7,is_active=$8,ministry_id=$9 where id=$10 returning id`, [values.name, values.weekday, values.meetingTime, values.addressLine, values.neighborhood, values.city, values.state, values.isActive, values.ministryId, cellId]);
    if (!result.rowCount) return false;
    await syncLeaders(client, cellId, values.leaderIds, startedAt);
    await syncCellSupervisor(client, cellId, values.supervisorPersonId, startedAt);
    await audit(client, actor, 'update_cell', 'cell', cellId, 'Dados organizacionais da célula atualizados.', { fields: ['name', 'ministry', 'schedule', 'address', 'is_active'], ministryId: values.ministryId });
    return true;
  }).catch((error) => { if (error?.code === '23505') throw new Error('Já existe uma célula com este nome ou vínculo ativo.'); throw error; });
}

export async function addMember(actor, cellId, input) { requireAdmin(actor); const personId=String(input.personId||''); const startedAt=date(input.startedAt,'Data de início',{optional:false}); if(!personId)throw new Error('Pessoa inválida.'); return withTransaction(async(client)=>{const target=await client.query('select id from public.cells where id=$1',[cellId]);if(!target.rowCount)throw new Error('Célula não encontrada.');const active=await client.query(`select links.id,links.cell_id,cells.name from public.cell_memberships links join public.cells cells on cells.id=links.cell_id where links.person_id=$1 and links.ended_at is null for update`,[personId]);if(active.rowCount){if(active.rows[0].cell_id===cellId)throw new Error('A pessoa já participa desta célula.');if(input.transfer!==true){const error=new Error(`A pessoa já pertence à célula ${active.rows[0].name}. Confirme a transferência para continuar.`);error.status=409;throw error;}await client.query('update public.cell_memberships set ended_at=$1 where id=$2',[startedAt,active.rows[0].id]);}await client.query('insert into public.cell_memberships (cell_id,person_id,started_at) values ($1,$2,$3)',[cellId,personId,startedAt]);await audit(client,actor,active.rowCount?'transfer_membership':'add_membership','cell',cellId,active.rowCount?'Membresia transferida.':'Participante incluído.',{personId});return true;}); }
export async function endMember(actor, cellId, personId, endedAt) { requireAdmin(actor); const endDate=date(endedAt,'Data de encerramento',{optional:false}); return withTransaction(async(client)=>{const result=await client.query(`update public.cell_memberships set ended_at=$1 where cell_id=$2 and person_id=$3 and ended_at is null returning id`,[endDate,cellId,personId]);if(!result.rowCount)return false;await audit(client,actor,'end_membership','cell',cellId,'Membresia encerrada.',{personId});return true;}); }

export async function setLeader(actor, cellId, input) { requireAdmin(actor); const leaderIds = input.personId ? [uuid(input.personId, 'Liderança')] : []; const startedAt = date(input.startedAt, 'Data de início', { optional: false }); return withTransaction(async (client) => { await syncLeaders(client, cellId, leaderIds, startedAt); await audit(client, actor, 'set_cell_leader', 'cell', cellId, 'Liderança da célula atualizada.', { leaderIds }); return true; }); }
export async function setLeaders(actor, cellId, input) { requireAdmin(actor); const leaderIds = personIds(input.leaderIds); const startedAt = date(input.startedAt, 'Data de início', { optional: false }); return withTransaction(async (client) => { await syncLeaders(client, cellId, leaderIds, startedAt); await audit(client, actor, 'set_cell_leaders', 'cell', cellId, 'Lideranças da célula atualizadas.', { leaderCount: leaderIds.length }); return true; }); }
export async function addSecretary(actor, cellId, input) { requireAdmin(actor);const personId=String(input.personId||'');const startedAt=date(input.startedAt,'Data de início',{optional:false});if(!personId)throw new Error('Pessoa inválida.');return withTransaction(async(client)=>{await client.query('insert into public.cell_secretaries (cell_id,person_id,started_at) values ($1,$2,$3)',[cellId,personId,startedAt]);await audit(client,actor,'add_cell_secretary','cell',cellId,'Secretaria vinculada à célula.',{personId});return true;});}
export async function addCellFunction(actor, cellId, input) { requireAdmin(actor);const personId=String(input.personId||''),code=String(input.functionCode||''),startedAt=date(input.startedAt,'Data de início',{optional:false});if(!personId||!cellFunctionCodes.has(code))throw new Error('Função de célula inválida.');return withTransaction(async(client)=>{await client.query('insert into public.person_ministry_assignments (person_id,ministry_function_code,cell_id,started_at) values ($1,$2,$3,$4)',[personId,code,cellId,startedAt]);await audit(client,actor,'assign_cell_function','cell',cellId,'Função ministerial atribuída.',{personId,functionCode:code});return true;});}
export async function endSecretary(actor, cellId, personId, endedAt) { requireAdmin(actor);const endDate=date(endedAt,'Data de encerramento',{optional:false});return withTransaction(async(client)=>{const result=await client.query(`update public.cell_secretaries set ended_at=$1 where cell_id=$2 and person_id=$3 and ended_at is null returning id`,[endDate,cellId,personId]);if(!result.rowCount)return false;await audit(client,actor,'end_cell_secretary','cell',cellId,'Secretaria encerrada.',{personId});return true;});}
export async function endCellFunction(actor, cellId, assignmentId, endedAt) { requireAdmin(actor);const endDate=date(endedAt,'Data de encerramento',{optional:false});return withTransaction(async(client)=>{const result=await client.query(`update public.person_ministry_assignments set ended_at=$1 where id=$2 and cell_id=$3 and ended_at is null returning person_id,ministry_function_code`,[endDate,assignmentId,cellId]);if(!result.rowCount)return false;await audit(client,actor,'end_cell_function','cell',cellId,'Função ministerial encerrada.',{personId:result.rows[0].person_id,functionCode:result.rows[0].ministry_function_code});return true;});}
export async function assignChurchFunction(actor, personId, input) { requireAdmin(actor);const code=String(input.functionCode||''),startedAt=date(input.startedAt,'Data de início',{optional:false});if(code!=='treasurer')throw new Error('Função de igreja inválida.');return withTransaction(async(client)=>{await client.query('insert into public.person_ministry_assignments (person_id,ministry_function_code,started_at) values ($1,$2,$3)',[personId,code,startedAt]);await audit(client,actor,'assign_church_function','person',personId,'Função ministerial de igreja atribuída.',{functionCode:code});return true;});}
export async function endChurchFunction(actor, personId, assignmentId, endedAt) { requireAdmin(actor);const endDate=date(endedAt,'Data de encerramento',{optional:false});return withTransaction(async(client)=>{const result=await client.query(`update public.person_ministry_assignments set ended_at=$1 where id=$2 and person_id=$3 and cell_id is null and ended_at is null returning ministry_function_code`,[endDate,assignmentId,personId]);if(!result.rowCount)return false;await audit(client,actor,'end_church_function','person',personId,'Função ministerial de igreja encerrada.',{functionCode:result.rows[0].ministry_function_code});return true;});}

import { getPostgresPool } from './postgres.mjs';

const welcomeRoles = new Set(['welcome1', 'welcome2']);

function fail(message, status = 400) { const error = new Error(message); error.status = status; return error; }
function requireAdmin(actor) { if (!actor?.roles?.includes('admin')) throw fail('Sem permissão administrativa.', 403); }
function uuid(value, label) { const normalized = String(value || '').trim(); if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) throw fail(`${label} inválido.`); return normalized; }
function text(value, label, maxLength, optional = false) { const normalized = String(value || '').trim(); if (!normalized && optional) return null; if (!normalized || normalized.length > maxLength) throw fail(`${label} inválido.`); return normalized; }
function date(value) { if (!value) return new Date().toISOString().slice(0, 10); const normalized = String(value).trim(); if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw fail('Data inválida.'); return normalized; }

async function transaction(work) {
  const client = await getPostgresPool().connect();
  try { await client.query('begin'); const result = await work(client); await client.query('commit'); return result; }
  catch (error) { await client.query('rollback').catch(() => {}); throw error; }
  finally { client.release(); }
}

async function audit(client, actor, action, entityType, entityId, summary, metadata = {}) {
  await client.query(
    `insert into public.audit_logs (actor_user_id,action,entity_type,entity_id,summary,metadata)
     values ($1,$2,$3,$4,$5,$6::jsonb)`,
    [actor.userId, action, entityType, String(entityId), summary, JSON.stringify(metadata)]
  );
}

export async function listTeams(actor) {
  requireAdmin(actor);
  const client = await getPostgresPool().connect();
  try {
    const [ministries, supervisors, welcome] = await Promise.all([
      client.query(
        `select ministries.id,ministries.name,ministries.is_active,
          (select count(*)::int from public.cells where cells.ministry_id=ministries.id) as cell_count,
          (select count(*)::int from public.ministry_supervisor_assignments links where links.ministry_id=ministries.id and links.ended_at is null) as supervisor_count,
          (select count(*)::int from public.cell_leaderships links join public.cells on cells.id=links.cell_id where cells.ministry_id=ministries.id and links.ended_at is null) as leader_count
         from public.ministries ministries order by ministries.name`
      ),
      client.query(
        `select assignments.id,people.id as person_id,people.full_name,ministries.id as ministry_id,ministries.name as ministry_name,
          (select count(*)::int from public.cell_supervisor_assignments cells where cells.person_id=people.id and cells.ended_at is null) as cell_count,
          exists(select 1 from public.app_users users where users.person_id=people.id and users.is_active) as has_login
         from public.ministry_supervisor_assignments assignments
         join public.people people on people.id=assignments.person_id
         join public.ministries ministries on ministries.id=assignments.ministry_id
         where assignments.ended_at is null
         order by ministries.name,people.full_name`
      ),
      client.query(
        `select roles.code,people.id as person_id,people.full_name
           from public.user_roles links
           join public.roles roles on roles.code=links.role_code
           join public.app_users users on users.id=links.user_id and users.is_active
           join public.people people on people.id=users.person_id
          where roles.code in ('welcome1','welcome2')
          order by roles.code,people.full_name`
      )
    ]);
    return {
      ministries: ministries.rows.map((row) => ({ id: row.id, name: row.name, isActive: row.is_active, cellCount: row.cell_count, supervisorCount: row.supervisor_count, leaderCount: row.leader_count })),
      supervisors: supervisors.rows.map((row) => ({ id: row.id, personId: row.person_id, fullName: row.full_name, ministry: { id: row.ministry_id, name: row.ministry_name }, cellCount: row.cell_count, hasLogin: row.has_login })),
      welcomeTeams: {
        welcome1: welcome.rows.filter((row) => row.code === 'welcome1').map((row) => ({ personId: row.person_id, fullName: row.full_name })),
        welcome2: welcome.rows.filter((row) => row.code === 'welcome2').map((row) => ({ personId: row.person_id, fullName: row.full_name }))
      }
    };
  } finally { client.release(); }
}

export async function getSupervisor(actor, assignmentId) {
  requireAdmin(actor); assignmentId = uuid(assignmentId, 'Supervisor');
  const client = await getPostgresPool().connect();
  try {
    const supervisor = await client.query(
      `select assignments.id,people.id as person_id,people.full_name,ministries.id as ministry_id,ministries.name as ministry_name
         from public.ministry_supervisor_assignments assignments
         join public.people people on people.id=assignments.person_id
         join public.ministries ministries on ministries.id=assignments.ministry_id
        where assignments.id=$1 and assignments.ended_at is null`, [assignmentId]
    );
    if (!supervisor.rowCount) return null;
    const cells = await client.query(
      `select cells.id,cells.name,cells.weekday,cells.meeting_time,cells.neighborhood,
              coalesce(array_agg(leaders.full_name order by leaders.full_name) filter (where leaders.id is not null),'{}') as leader_names
         from public.cell_supervisor_assignments assignments
         join public.cells cells on cells.id=assignments.cell_id
         left join public.cell_leaderships links on links.cell_id=cells.id and links.ended_at is null
         left join public.people leaders on leaders.id=links.person_id
        where assignments.person_id=$1 and assignments.ended_at is null
        group by cells.id,cells.name,cells.weekday,cells.meeting_time,cells.neighborhood
        order by cells.name`, [supervisor.rows[0].person_id]
    );
    const row = supervisor.rows[0];
    return { id: row.id, personId: row.person_id, fullName: row.full_name, ministry: { id: row.ministry_id, name: row.ministry_name }, cells: cells.rows.map((cell) => ({ id: cell.id, name: cell.name, weekday: cell.weekday, meetingTime: cell.meeting_time, neighborhood: cell.neighborhood, leaderNames: cell.leader_names || [] })) };
  } finally { client.release(); }
}

export async function createMinistry(actor, input) {
  requireAdmin(actor); const name = text(input.name, 'Nome do ministério', 100);
  return transaction(async (client) => {
    const result = await client.query('insert into public.ministries (name) values ($1) returning id', [name]);
    await audit(client, actor, 'create_ministry', 'ministry', result.rows[0].id, 'Ministério cadastrado.', { name });
    return result.rows[0].id;
  }).catch((error) => { if (error?.code === '23505') throw fail('Já existe um ministério com este nome.', 409); throw error; });
}

export async function addMinistrySupervisor(actor, input) {
  requireAdmin(actor); const ministryId = uuid(input.ministryId, 'Ministério'); const personId = uuid(input.personId, 'Pessoa'); const startedAt = date(input.startedAt);
  return transaction(async (client) => {
    const person = await client.query('select id from public.people where id=$1', [personId]); if (!person.rowCount) throw fail('Pessoa não encontrada.', 404);
    const ministry = await client.query('select id from public.ministries where id=$1 and is_active', [ministryId]); if (!ministry.rowCount) throw fail('Ministério não encontrado ou inativo.', 404);
    const result = await client.query('insert into public.ministry_supervisor_assignments (ministry_id,person_id,started_at) values ($1,$2,$3) returning id', [ministryId, personId, startedAt]);
    await audit(client, actor, 'assign_ministry_supervisor', 'ministry_supervisor', result.rows[0].id, 'Supervisor vinculado ao ministério.', { ministryId, personId });
    return result.rows[0].id;
  }).catch((error) => { if (error?.code === '23505') throw fail('Esta pessoa já é Supervisora desse ministério.', 409); throw error; });
}

export async function endMinistrySupervisor(actor, assignmentId, input = {}) {
  requireAdmin(actor); assignmentId = uuid(assignmentId, 'Supervisor'); const endedAt = date(input.endedAt);
  return transaction(async (client) => {
    const activeCells = await client.query('select id from public.cell_supervisor_assignments where person_id=(select person_id from public.ministry_supervisor_assignments where id=$1) and ended_at is null', [assignmentId]);
    if (activeCells.rowCount) throw fail('Transfira ou encerre as células deste Supervisor antes de encerrar seu vínculo.', 409);
    const result = await client.query('update public.ministry_supervisor_assignments set ended_at=$1 where id=$2 and ended_at is null returning ministry_id,person_id', [endedAt, assignmentId]);
    if (!result.rowCount) return false;
    await audit(client, actor, 'end_ministry_supervisor', 'ministry_supervisor', assignmentId, 'Vínculo de Supervisor encerrado.', { ministryId: result.rows[0].ministry_id, personId: result.rows[0].person_id });
    return true;
  });
}

export async function addWelcomeTeamMember(actor, teamCode, input) {
  requireAdmin(actor); if (!welcomeRoles.has(teamCode)) throw fail('Equipe de Boas-Vindas inválida.'); const personId = uuid(input.personId, 'Pessoa');
  return transaction(async (client) => {
    const user = await client.query('select id from public.app_users where person_id=$1 and is_active', [personId]);
    if (!user.rowCount) throw fail('A pessoa precisa ter acesso individual ativo ao aplicativo para integrar esta equipe.', 409);
    await client.query('insert into public.user_roles (user_id,role_code) values ($1,$2) on conflict do nothing', [user.rows[0].id, teamCode]);
    await audit(client, actor, 'assign_welcome_team_member', 'app_user', user.rows[0].id, 'Pessoa vinculada à equipe de Boas-Vindas.', { teamCode, personId });
    return true;
  });
}

export async function removeWelcomeTeamMember(actor, teamCode, personId) {
  requireAdmin(actor); if (!welcomeRoles.has(teamCode)) throw fail('Equipe de Boas-Vindas inválida.'); personId = uuid(personId, 'Pessoa');
  return transaction(async (client) => {
    const result = await client.query(`delete from public.user_roles roles using public.app_users users where roles.user_id=users.id and users.person_id=$1 and roles.role_code=$2 returning users.id`, [personId, teamCode]);
    if (!result.rowCount) return false;
    await audit(client, actor, 'remove_welcome_team_member', 'app_user', result.rows[0].id, 'Pessoa removida da equipe de Boas-Vindas.', { teamCode, personId });
    return true;
  });
}

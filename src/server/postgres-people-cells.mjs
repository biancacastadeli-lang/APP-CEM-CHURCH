import { getPostgresPool } from './postgres.mjs';

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
    city: text(input.city, 'Cidade', 100, { optional: false }), state, isActive: input.isActive !== false
  };
}

function mapCell(row) {
  return { id: row.id, name: row.name, weekday: row.weekday, meetingTime: row.meeting_time, addressLine: row.address_line, neighborhood: row.neighborhood, city: row.city, state: row.state, isActive: row.is_active };
}

function mapPerson(row) {
  return { id: row.id, fullName: row.full_name, whatsapp: row.whatsapp, email: row.email, birthDate: row.birth_date ?? null, sex: row.sex ?? null, postalCode: row.postal_code ?? null, addressLine: row.address_line ?? null, addressNumber: row.address_number ?? null, addressComplement: row.address_complement ?? null, neighborhood: row.neighborhood ?? null, city: row.city ?? null, state: row.state ?? null, personStatus: row.person_status ?? null, baptized: row.baptized, baptizedOn: row.baptized_on ?? null };
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
  const result = await client.query('select cell_id from public.supervisor_cell_scopes where user_id = $1', [actor.userId]);
  return result.rows.map((row) => row.cell_id);
}

async function withTransaction(work) {
  const client = await getPostgresPool().connect();
  try { await client.query('begin'); const result = await work(client); await client.query('commit'); return result; }
  catch (error) { await client.query('rollback').catch(() => {}); throw error; }
  finally { client.release(); }
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
      `select people.id, people.full_name, people.whatsapp, people.person_status, cells.id as cell_id, cells.name as cell_name
         from public.people people
         left join public.cell_memberships memberships on memberships.person_id = people.id and memberships.ended_at is null
         left join public.cells cells on cells.id = memberships.cell_id
        where ($1::text = '' or people.full_name ilike '%' || $1 || '%' or people.whatsapp like '%' || regexp_replace($1, '\\D','','g') || '%')
          and ($2::uuid[] is null or memberships.cell_id = any($2::uuid[]))
        order by people.full_name
        limit 200`,
      [term, scopes]
    );
    return result.rows.map((row) => ({ id: row.id, fullName: row.full_name, whatsapp: row.whatsapp, personStatus: row.person_status ?? null, cell: row.cell_id ? { id: row.cell_id, name: row.cell_name } : null }));
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
    const [membership, leaderships, secretariats, appRoles, assignments, modules, history] = await Promise.all([
      client.query(`select cells.* from public.cell_memberships memberships join public.cells cells on cells.id=memberships.cell_id where memberships.person_id=$1 and memberships.ended_at is null limit 1`, [personId]),
      client.query(`select cells.* from public.cell_leaderships links join public.cells cells on cells.id=links.cell_id where links.person_id=$1 and links.ended_at is null order by cells.name`, [personId]),
      client.query(`select cells.* from public.cell_secretaries links join public.cells cells on cells.id=links.cell_id where links.person_id=$1 and links.ended_at is null order by cells.name`, [personId]),
      client.query(`select distinct roles.code from public.app_users users join public.user_roles links on links.user_id=users.id join public.roles roles on roles.code=links.role_code where users.person_id=$1 and users.is_active order by roles.code`, [personId]),
      client.query(`select assignments.id, assignments.started_at, assignments.ended_at, functions.code, functions.name, functions.scope_type, cells.id as cell_id, cells.name as cell_name from public.person_ministry_assignments assignments join public.ministry_functions functions on functions.code=assignments.ministry_function_code left join public.cells cells on cells.id=assignments.cell_id where assignments.person_id=$1 and assignments.ended_at is null order by functions.name`, [personId]),
      client.query(`select modules.code, modules.name, completions.completed_on from public.formation_modules modules left join public.person_formation_completions completions on completions.module_code=modules.code and completions.person_id=$1 where modules.is_active order by modules.display_order`, [personId]),
      (isAdmin(actor) || isPastor(actor)) ? client.query(`select source_type, previous_status, current_status, created_at from public.person_status_history where person_id=$1 order by created_at desc`, [personId]) : Promise.resolve({ rows: [] })
    ]);
    return { person: mapPerson(person.rows[0]), membership: mapCell(membership.rows[0]), leaderships: leaderships.rows.map(mapCell), secretariats: secretariats.rows.map(mapCell), appRoles: appRoles.rows.map((row) => row.code), functions: assignments.rows.map((row) => ({ id: row.id, code: row.code, name: row.name, scopeType: row.scope_type, cell: row.cell_id ? { id: row.cell_id, name: row.cell_name } : null, startedAt: row.started_at, endedAt: row.ended_at })), journey: { modules: modules.rows.map((row) => ({ code: row.code, name: row.name, completedOn: row.completed_on ?? null })), baptized: person.rows[0].baptized, baptizedOn: person.rows[0].baptized_on ?? null }, history: history.rows.map((row) => ({ sourceType: row.source_type, previousStatus: row.previous_status, currentStatus: row.current_status, createdAt: row.created_at })) };
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
      `select cells.*, leader.full_name as leader_name from public.cells cells
       left join public.cell_leaderships links on links.cell_id=cells.id and links.ended_at is null
       left join public.people leader on leader.id=links.person_id
       where $1::uuid[] is null or cells.id=any($1::uuid[])
       order by cells.name`, [scopes]);
    return result.rows.map((row) => ({ ...mapCell(row), leaderName: row.leader_name ?? null }));
  } finally { client.release(); }
}

export async function getCell(actor, cellId) {
  requireReadAccess(actor); const client = await getPostgresPool().connect();
  try {
    const scopes = await scopesFor(client, actor);
    const cell = await client.query(`select * from public.cells where id=$1 and ($2::uuid[] is null or id=any($2::uuid[]))`, [cellId, scopes]);
    if (!cell.rowCount) return null;
    const [leader, secretaries, members, functions, membershipHistory] = await Promise.all([
      client.query(`select people.id,people.full_name from public.cell_leaderships links join public.people people on people.id=links.person_id where links.cell_id=$1 and links.ended_at is null limit 1`, [cellId]),
      client.query(`select people.id,people.full_name from public.cell_secretaries links join public.people people on people.id=links.person_id where links.cell_id=$1 and links.ended_at is null order by people.full_name`, [cellId]),
      client.query(`select people.id,people.full_name,people.person_status from public.cell_memberships links join public.people people on people.id=links.person_id where links.cell_id=$1 and links.ended_at is null order by people.full_name`, [cellId]),
      client.query(`select assignments.id,functions.code,functions.name,people.id as person_id,people.full_name from public.person_ministry_assignments assignments join public.ministry_functions functions on functions.code=assignments.ministry_function_code join public.people people on people.id=assignments.person_id where assignments.cell_id=$1 and assignments.ended_at is null order by functions.name,people.full_name`, [cellId]),
      isAdmin(actor) || isPastor(actor) ? client.query(`select people.full_name,links.started_at,links.ended_at from public.cell_memberships links join public.people people on people.id=links.person_id where links.cell_id=$1 order by links.created_at desc`, [cellId]) : Promise.resolve({ rows: [] })
    ]);
    return { cell: mapCell(cell.rows[0]), leader: leader.rows[0] ? { id: leader.rows[0].id, fullName: leader.rows[0].full_name } : null, secretaries: secretaries.rows.map((row) => ({ id: row.id, fullName: row.full_name })), members: members.rows.map((row) => ({ id: row.id, fullName: row.full_name, personStatus: row.person_status })), functions: functions.rows.map((row) => ({ id: row.id, code: row.code, name: row.name, person: { id: row.person_id, fullName: row.full_name } })), membershipHistory: membershipHistory.rows.map((row) => ({ fullName: row.full_name, startedAt: row.started_at, endedAt: row.ended_at })) };
  } finally { client.release(); }
}

export async function createCell(actor, input) { requireAdmin(actor); const values = cellInput(input); return withTransaction(async (client) => { const result = await client.query(`insert into public.cells (name,weekday,meeting_time,address_line,neighborhood,city,state,is_active) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`, [values.name,values.weekday,values.meetingTime,values.addressLine,values.neighborhood,values.city,values.state,values.isActive]); await audit(client,actor,'create_cell','cell',result.rows[0].id,'Célula cadastrada.',{fields:['name','schedule','address','is_active']}); return result.rows[0].id; }).catch((error)=>{if(error?.code==='23505')throw new Error('Já existe uma célula com este nome.');throw error;}); }
export async function updateCell(actor, cellId, input) { requireAdmin(actor); const values=cellInput(input); return withTransaction(async(client)=>{const result=await client.query(`update public.cells set name=$1,weekday=$2,meeting_time=$3,address_line=$4,neighborhood=$5,city=$6,state=$7,is_active=$8 where id=$9 returning id`,[values.name,values.weekday,values.meetingTime,values.addressLine,values.neighborhood,values.city,values.state,values.isActive,cellId]);if(!result.rowCount)return false;await audit(client,actor,'update_cell','cell',cellId,'Dados da célula atualizados.',{fields:['name','schedule','address','is_active']});return true;}).catch((error)=>{if(error?.code==='23505')throw new Error('Já existe uma célula com este nome.');throw error;}); }

export async function addMember(actor, cellId, input) { requireAdmin(actor); const personId=String(input.personId||''); const startedAt=date(input.startedAt,'Data de início',{optional:false}); if(!personId)throw new Error('Pessoa inválida.'); return withTransaction(async(client)=>{const target=await client.query('select id from public.cells where id=$1',[cellId]);if(!target.rowCount)throw new Error('Célula não encontrada.');const active=await client.query(`select links.id,links.cell_id,cells.name from public.cell_memberships links join public.cells cells on cells.id=links.cell_id where links.person_id=$1 and links.ended_at is null for update`,[personId]);if(active.rowCount){if(active.rows[0].cell_id===cellId)throw new Error('A pessoa já participa desta célula.');if(input.transfer!==true){const error=new Error(`A pessoa já pertence à célula ${active.rows[0].name}. Confirme a transferência para continuar.`);error.status=409;throw error;}await client.query('update public.cell_memberships set ended_at=$1 where id=$2',[startedAt,active.rows[0].id]);}await client.query('insert into public.cell_memberships (cell_id,person_id,started_at) values ($1,$2,$3)',[cellId,personId,startedAt]);await audit(client,actor,active.rowCount?'transfer_membership':'add_membership','cell',cellId,active.rowCount?'Membresia transferida.':'Participante incluído.',{personId});return true;}); }
export async function endMember(actor, cellId, personId, endedAt) { requireAdmin(actor); const endDate=date(endedAt,'Data de encerramento',{optional:false}); return withTransaction(async(client)=>{const result=await client.query(`update public.cell_memberships set ended_at=$1 where cell_id=$2 and person_id=$3 and ended_at is null returning id`,[endDate,cellId,personId]);if(!result.rowCount)return false;await audit(client,actor,'end_membership','cell',cellId,'Membresia encerrada.',{personId});return true;}); }

export async function setLeader(actor, cellId, input) { requireAdmin(actor); const personId=input.personId?String(input.personId):null;const startedAt=date(input.startedAt,'Data de início',{optional:false});return withTransaction(async(client)=>{const current=await client.query('select id from public.cell_leaderships where cell_id=$1 and ended_at is null for update',[cellId]);if(current.rowCount)await client.query('update public.cell_leaderships set ended_at=$1 where id=$2',[startedAt,current.rows[0].id]);if(personId)await client.query('insert into public.cell_leaderships (cell_id,person_id,started_at) values ($1,$2,$3)',[cellId,personId,startedAt]);await audit(client,actor,'set_cell_leader','cell',cellId,'Liderança da célula atualizada.',{personId});return true;}); }
export async function addSecretary(actor, cellId, input) { requireAdmin(actor);const personId=String(input.personId||'');const startedAt=date(input.startedAt,'Data de início',{optional:false});if(!personId)throw new Error('Pessoa inválida.');return withTransaction(async(client)=>{await client.query('insert into public.cell_secretaries (cell_id,person_id,started_at) values ($1,$2,$3)',[cellId,personId,startedAt]);await audit(client,actor,'add_cell_secretary','cell',cellId,'Secretaria vinculada à célula.',{personId});return true;});}
export async function addCellFunction(actor, cellId, input) { requireAdmin(actor);const personId=String(input.personId||''),code=String(input.functionCode||''),startedAt=date(input.startedAt,'Data de início',{optional:false});if(!personId||!cellFunctionCodes.has(code))throw new Error('Função de célula inválida.');return withTransaction(async(client)=>{await client.query('insert into public.person_ministry_assignments (person_id,ministry_function_code,cell_id,started_at) values ($1,$2,$3,$4)',[personId,code,cellId,startedAt]);await audit(client,actor,'assign_cell_function','cell',cellId,'Função ministerial atribuída.',{personId,functionCode:code});return true;});}
export async function endSecretary(actor, cellId, personId, endedAt) { requireAdmin(actor);const endDate=date(endedAt,'Data de encerramento',{optional:false});return withTransaction(async(client)=>{const result=await client.query(`update public.cell_secretaries set ended_at=$1 where cell_id=$2 and person_id=$3 and ended_at is null returning id`,[endDate,cellId,personId]);if(!result.rowCount)return false;await audit(client,actor,'end_cell_secretary','cell',cellId,'Secretaria encerrada.',{personId});return true;});}
export async function endCellFunction(actor, cellId, assignmentId, endedAt) { requireAdmin(actor);const endDate=date(endedAt,'Data de encerramento',{optional:false});return withTransaction(async(client)=>{const result=await client.query(`update public.person_ministry_assignments set ended_at=$1 where id=$2 and cell_id=$3 and ended_at is null returning person_id,ministry_function_code`,[endDate,assignmentId,cellId]);if(!result.rowCount)return false;await audit(client,actor,'end_cell_function','cell',cellId,'Função ministerial encerrada.',{personId:result.rows[0].person_id,functionCode:result.rows[0].ministry_function_code});return true;});}
export async function assignChurchFunction(actor, personId, input) { requireAdmin(actor);const code=String(input.functionCode||''),startedAt=date(input.startedAt,'Data de início',{optional:false});if(code!=='treasurer')throw new Error('Função de igreja inválida.');return withTransaction(async(client)=>{await client.query('insert into public.person_ministry_assignments (person_id,ministry_function_code,started_at) values ($1,$2,$3)',[personId,code,startedAt]);await audit(client,actor,'assign_church_function','person',personId,'Função ministerial de igreja atribuída.',{functionCode:code});return true;});}
export async function endChurchFunction(actor, personId, assignmentId, endedAt) { requireAdmin(actor);const endDate=date(endedAt,'Data de encerramento',{optional:false});return withTransaction(async(client)=>{const result=await client.query(`update public.person_ministry_assignments set ended_at=$1 where id=$2 and person_id=$3 and cell_id is null and ended_at is null returning ministry_function_code`,[endDate,assignmentId,personId]);if(!result.rowCount)return false;await audit(client,actor,'end_church_function','person',personId,'Função ministerial de igreja encerrada.',{functionCode:result.rows[0].ministry_function_code});return true;});}

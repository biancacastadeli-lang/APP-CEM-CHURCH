import { getPostgresPool } from './postgres.mjs';

const receptionStatuses = new Set(['new', 'confirmed', 'sent_to_care', 'closed']);
const careStatuses = new Set(['open', 'waiting', 'referred_to_cell', 'closed']);
const contactTypes = new Set(['attempt', 'contact', 'visit', 'other']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(message, status = 400) { const error = new Error(message); error.status = status; return error; }
function text(value, label, max, optional = false) {
  if (value == null || value === '') { if (optional) return ''; throw fail(`${label} é obrigatório.`); }
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw fail(`${label} é inválido.`);
  return value.trim();
}
function whatsapp(value) { const normalized = String(value || '').replace(/\D/g, ''); if (normalized.length < 10 || normalized.length > 13) throw fail('WhatsApp inválido.'); return normalized; }
function id(value, label = 'Identificador') { if (!uuid.test(String(value || ''))) throw fail(`${label} inválido.`); return String(value); }
function requireActor(actor) { if (!actor?.userId || actor.source !== 'postgres') throw fail('Sessão PostgreSQL inválida.', 401); }
function requireReception(actor) { requireActor(actor); if (!actor.roles?.some((role) => ['welcome1', 'admin'].includes(role))) throw fail('Sem permissão para recepção.', 403); }
function requireCare(actor) { requireActor(actor); if (!actor.roles?.some((role) => ['welcome2', 'admin'].includes(role))) throw fail('Sem permissão para acompanhamento.', 403); }

async function transaction(work) {
  const client = await getPostgresPool().connect();
  try { await client.query('begin'); const result = await work(client); await client.query('commit'); return result; }
  catch (cause) { await client.query('rollback').catch(() => {}); throw cause; }
  finally { client.release(); }
}
async function audit(client, actor, action, entityType, entityId, summary, metadata = {}) {
  await client.query(`insert into public.audit_logs (actor_user_id,action,entity_type,entity_id,summary,metadata) values ($1,$2,$3,$4,$5,$6::jsonb)`, [actor?.userId || null, action, entityType, String(entityId), summary, JSON.stringify(metadata)]);
}

async function duplicatePerson(client, number, excludedPersonId = null) {
  const result = await client.query(`select id from public.people where whatsapp=$1 and ($2::uuid is null or id <> $2) limit 1 for update`, [number, excludedPersonId]);
  return result.rows[0]?.id || null;
}

export async function createPublicPreRegistration(input) {
  const fullName = text(input.name, 'Nome', 120); const number = whatsapp(input.whatsapp);
  if (input.consent !== true) throw fail('Confirme a autorização de contato.');
  return transaction(async (client) => {
    const existing = await duplicatePerson(client, number);
    if (existing) return { accepted: true, created: false };
    const person = await client.query(`insert into public.people (full_name,whatsapp,person_status) values ($1,$2,'visitor') returning id`, [fullName, number]);
    const visitor = await client.query(`insert into public.visitors (person_id,source,reception_status,consent_contact,consented_at) values ($1,'QR / pré-cadastro','new',true,now()) returning id`, [person.rows[0].id]);
    await audit(client, null, 'create_public_preregistration', 'visitor', visitor.rows[0].id, 'Pré-cadastro público recebido.');
    return { accepted: true, created: true };
  });
}

export async function listReceptionVisitors(actor) {
  requireReception(actor); const client = await getPostgresPool().connect();
  try {
    const result = await client.query(`select visitors.id,people.full_name,people.whatsapp,visitors.source,visitors.reception_status,visitors.created_at
      from public.visitors join public.people on people.id=visitors.person_id
      order by visitors.created_at desc limit 250`);
    return { visitors: result.rows.map((row) => ({ id: row.id, fullName: row.full_name, whatsapp: row.whatsapp, source: row.source, receptionStatus: row.reception_status, createdAt: row.created_at })) };
  } finally { client.release(); }
}

export async function createReceptionVisitor(actor, input) {
  requireReception(actor); const fullName = text(input.fullName ?? input.name, 'Nome', 120); const number = whatsapp(input.whatsapp); const source = text(input.source, 'Origem', 100);
  return transaction(async (client) => {
    if (await duplicatePerson(client, number)) throw fail('Já existe um cadastro com este WhatsApp.', 409);
    const person = await client.query(`insert into public.people (full_name,whatsapp,person_status) values ($1,$2,'visitor') returning id`, [fullName, number]);
    const visitor = await client.query(`insert into public.visitors (person_id,source,reception_status,consent_contact) values ($1,$2,'new',false) returning id`, [person.rows[0].id, source]);
    await audit(client, actor, 'create_reception_visitor', 'visitor', visitor.rows[0].id, 'Visitante cadastrado pela recepção.');
    return visitor.rows[0].id;
  });
}

export async function updateReceptionVisitor(actor, visitorId, input) {
  requireReception(actor); visitorId = id(visitorId, 'Visitante'); const fullName = text(input.fullName ?? input.name, 'Nome', 120); const number = whatsapp(input.whatsapp); const source = text(input.source, 'Origem', 100);
  return transaction(async (client) => {
    const visitor = await client.query(`select person_id from public.visitors where id=$1 for update`, [visitorId]);
    if (!visitor.rowCount) throw fail('Visitante não encontrado.', 404);
    if (await duplicatePerson(client, number, visitor.rows[0].person_id)) throw fail('Já existe um cadastro com este WhatsApp.', 409);
    await client.query(`update public.people set full_name=$1,whatsapp=$2 where id=$3`, [fullName, number, visitor.rows[0].person_id]);
    await client.query(`update public.visitors set source=$1,reception_status='confirmed' where id=$2`, [source, visitorId]);
    await audit(client, actor, 'confirm_reception_visitor', 'visitor', visitorId, 'Cadastro de visitante confirmado pela recepção.');
    return true;
  });
}

export async function listCareVisitors(actor) {
  requireCare(actor); const client = await getPostgresPool().connect();
  try {
    const result = await client.query(`select visitors.id as visitor_id,people.full_name,people.whatsapp,visitors.source,visitors.reception_status,visitors.created_at,
      care.id as care_case_id,care.status as care_status,care.next_step,responsible_people.full_name as responsible_name
      from public.visitors join public.people on people.id=visitors.person_id
      left join public.care_cases care on care.visitor_id=visitors.id
      left join public.app_users responsible_users on responsible_users.id=care.responsible_user_id
      left join public.people responsible_people on responsible_people.id=responsible_users.person_id
      where visitors.reception_status <> 'closed'
      order by coalesce(care.updated_at,visitors.updated_at) desc,visitors.created_at desc limit 250`);
    return { visitors: result.rows.map((row) => ({ visitorId: row.visitor_id, fullName: row.full_name, whatsapp: row.whatsapp, source: row.source, receptionStatus: row.reception_status, createdAt: row.created_at, careCaseId: row.care_case_id, careStatus: row.care_status, nextStep: row.next_step || '', responsibleName: row.responsible_name || null })) };
  } finally { client.release(); }
}

export async function createMemberReferral(actor, input) {
  requireActor(actor); if (!actor.roles?.includes('member')) throw fail('Sem permissão para indicar pessoas.', 403);
  const fullName = text(input.fullName ?? input.name, 'Nome', 120); const number = whatsapp(input.whatsapp); const referrerNote = text(input.note, 'Observação', 1000, true);
  return transaction(async (client) => {
    let personId = await duplicatePerson(client, number);
    if (!personId) {
      const person = await client.query(`insert into public.people (full_name,whatsapp,person_status) values ($1,$2,'visitor') returning id`, [fullName, number]);
      personId = person.rows[0].id;
    }
    const referral = await client.query(`insert into public.referrals (person_id,referred_by_person_id,referrer_note,status) values ($1,$2,$3,'new') returning id`, [personId, actor.personId, referrerNote]);
    await audit(client, actor, 'create_member_referral', 'referral', referral.rows[0].id, 'Indicação recebida para análise da Equipe 2.');
    return referral.rows[0].id;
  });
}

export async function listCareReferrals(actor) {
  requireCare(actor); const client = await getPostgresPool().connect();
  try {
    const result = await client.query(`select referrals.id as referral_id,people.full_name,people.whatsapp,referrers.full_name as referrer_name,referrals.referrer_note,referrals.status,referrals.created_at,
      care.id as care_case_id,care.status as care_status,care.next_step,responsible_people.full_name as responsible_name
      from public.referrals join public.people on people.id=referrals.person_id join public.people referrers on referrers.id=referrals.referred_by_person_id
      left join public.care_cases care on care.referral_id=referrals.id
      left join public.app_users responsible_users on responsible_users.id=care.responsible_user_id
      left join public.people responsible_people on responsible_people.id=responsible_users.person_id
      where referrals.status <> 'closed'
      order by coalesce(care.updated_at,referrals.updated_at) desc,referrals.created_at desc limit 250`);
    return { referrals: result.rows.map((row) => ({ referralId: row.referral_id, fullName: row.full_name, whatsapp: row.whatsapp, referrerName: row.referrer_name, referrerNote: row.referrer_note || '', status: row.status, createdAt: row.created_at, careCaseId: row.care_case_id, careStatus: row.care_status, nextStep: row.next_step || '', responsibleName: row.responsible_name || null })) };
  } finally { client.release(); }
}

export async function getCareCase(actor, caseId) {
  requireCare(actor); caseId = id(caseId, 'Acompanhamento'); const client = await getPostgresPool().connect();
  try {
    const header = await client.query(`select care.id,care.status,care.next_step,visitors.id as visitor_id,referrals.id as referral_id,
      coalesce(visitor_people.full_name,referral_people.full_name) as full_name,coalesce(visitor_people.whatsapp,referral_people.whatsapp) as whatsapp,
      visitors.source,visitors.reception_status,referrals.referrer_note,referrers.full_name as referrer_name,
      responsible_people.full_name as responsible_name
      from public.care_cases care left join public.visitors on visitors.id=care.visitor_id left join public.people visitor_people on visitor_people.id=visitors.person_id
      left join public.referrals on referrals.id=care.referral_id left join public.people referral_people on referral_people.id=referrals.person_id left join public.people referrers on referrers.id=referrals.referred_by_person_id
      left join public.app_users responsible_users on responsible_users.id=care.responsible_user_id
      left join public.people responsible_people on responsible_people.id=responsible_users.person_id where care.id=$1`, [caseId]);
    if (!header.rowCount) throw fail('Acompanhamento não encontrado.', 404);
    const [records, referrals, cells] = await Promise.all([
      client.query(`select records.id,records.contact_type,records.private_note,records.next_step,records.created_at,people.full_name as responsible_name from public.care_records records left join public.app_users users on users.id=records.responsible_user_id left join public.people on people.id=users.person_id where records.care_case_id=$1 order by records.created_at desc`, [caseId]),
      client.query(`select referrals.id,referrals.delivery_status,referrals.note_for_cell,referrals.return_note,referrals.created_at,cells.name as cell_name from public.cell_referrals referrals join public.cells on cells.id=referrals.cell_id where referrals.care_case_id=$1 order by referrals.created_at desc`, [caseId]),
      client.query(`select cells.id,cells.name,cells.weekday,cells.meeting_time,cells.address_line,cells.neighborhood,leader_people.full_name as leader_name from public.cells cells left join public.cell_leaderships leaders on leaders.cell_id=cells.id and leaders.ended_at is null left join public.people leader_people on leader_people.id=leaders.person_id where cells.is_active order by cells.name`)
    ]);
    const row = header.rows[0];
    return { careCase: { id: row.id, status: row.status, nextStep: row.next_step || '', responsibleName: row.responsible_name || null, subject: { type: row.visitor_id ? 'visitor' : 'referral', id: row.visitor_id || row.referral_id, fullName: row.full_name, whatsapp: row.whatsapp, source: row.source || 'Indicação de membro', receptionStatus: row.reception_status || null, referrerName: row.referrer_name || null, referrerNote: row.referrer_note || '' } }, records: records.rows.map((record) => ({ id: record.id, contactType: record.contact_type, privateNote: record.private_note, nextStep: record.next_step, createdAt: record.created_at, responsibleName: record.responsible_name || null })), referrals: referrals.rows.map((referral) => ({ id: referral.id, status: referral.delivery_status, noteForCell: referral.note_for_cell, returnNote: referral.return_note, createdAt: referral.created_at, cellName: referral.cell_name })), cells: cells.rows.map((cell) => ({ id: cell.id, name: cell.name, weekday: cell.weekday, meetingTime: cell.meeting_time, addressLine: cell.address_line, neighborhood: cell.neighborhood, leaderName: cell.leader_name || 'Liderança pendente' })) };
  } finally { client.release(); }
}

export async function openCareCase(actor, visitorId) {
  requireCare(actor); visitorId = id(visitorId, 'Visitante');
  return transaction(async (client) => {
    const existing = await client.query(`select id from public.care_cases where visitor_id=$1`, [visitorId]);
    if (existing.rowCount) return existing.rows[0].id;
    const visitor = await client.query(`select id from public.visitors where id=$1 for update`, [visitorId]); if (!visitor.rowCount) throw fail('Visitante não encontrado.', 404);
    const created = await client.query(`insert into public.care_cases (visitor_id,status,responsible_user_id) values ($1,'open',$2) returning id`, [visitorId, actor.userId]);
    await client.query(`update public.visitors set reception_status='sent_to_care' where id=$1`, [visitorId]);
    await audit(client, actor, 'open_visitor_care_case', 'care_case', created.rows[0].id, 'Acompanhamento de visitante iniciado.');
    return created.rows[0].id;
  });
}

export async function openReferralCareCase(actor, referralId) {
  requireCare(actor); referralId = id(referralId, 'Indicação');
  return transaction(async (client) => {
    const existing = await client.query(`select id from public.care_cases where referral_id=$1`, [referralId]); if (existing.rowCount) return existing.rows[0].id;
    const referral = await client.query(`select id from public.referrals where id=$1 for update`, [referralId]); if (!referral.rowCount) throw fail('Indicação não encontrada.', 404);
    const created = await client.query(`insert into public.care_cases (referral_id,status,responsible_user_id) values ($1,'open',$2) returning id`, [referralId, actor.userId]);
    await client.query(`update public.referrals set status='in_care' where id=$1`, [referralId]);
    await audit(client, actor, 'open_referral_care_case', 'care_case', created.rows[0].id, 'Acompanhamento iniciado a partir de indicação.'); return created.rows[0].id;
  });
}

export async function updateCareCase(actor, caseId, input) {
  requireCare(actor); caseId = id(caseId, 'Acompanhamento'); const status = String(input.status || '').trim(); const nextStep = text(input.nextStep, 'Próximo passo', 1000, true);
  if (!careStatuses.has(status)) throw fail('Situação do acompanhamento inválida.');
  return transaction(async (client) => {
    const result = await client.query(`update public.care_cases set status=$1,next_step=$2,responsible_user_id=$3 where id=$4 returning id`, [status, nextStep, actor.userId, caseId]); if (!result.rowCount) throw fail('Acompanhamento não encontrado.', 404);
    await audit(client, actor, 'update_care_case', 'care_case', caseId, 'Situação do acompanhamento atualizada.', { status }); return true;
  });
}

export async function addCareRecord(actor, caseId, input) {
  requireCare(actor); caseId = id(caseId, 'Acompanhamento'); const contactType = String(input.contactType || 'attempt'); const privateNote = text(input.privateNote, 'Observação', 5000, true); const nextStep = text(input.nextStep, 'Próximo passo', 1000, true);
  if (!contactTypes.has(contactType)) throw fail('Tipo de contato inválido.');
  return transaction(async (client) => {
    const found = await client.query(`select id from public.care_cases where id=$1`, [caseId]); if (!found.rowCount) throw fail('Acompanhamento não encontrado.', 404);
    const record = await client.query(`insert into public.care_records (care_case_id,contact_type,private_note,next_step,responsible_user_id,created_by_user_id) values ($1,$2,$3,$4,$5,$5) returning id`, [caseId, contactType, privateNote, nextStep, actor.userId]);
    if (nextStep) await client.query(`update public.care_cases set next_step=$1,responsible_user_id=$2 where id=$3`, [nextStep, actor.userId, caseId]);
    await audit(client, actor, 'add_private_care_record', 'care_record', record.rows[0].id, 'Registro privado de acompanhamento adicionado.'); return record.rows[0].id;
  });
}

export async function referCareCaseToCell(actor, caseId, input) {
  requireCare(actor); caseId = id(caseId, 'Acompanhamento'); const cellId = id(input.cellId, 'Célula'); const noteForCell = text(input.noteForCell, 'Observação para a célula', 1000, true);
  return transaction(async (client) => {
    const activeCell = await client.query(`select id from public.cells where id=$1 and is_active`, [cellId]); if (!activeCell.rowCount) throw fail('Célula indisponível para encaminhamento.', 409);
    const found = await client.query(`select id from public.care_cases where id=$1`, [caseId]); if (!found.rowCount) throw fail('Acompanhamento não encontrado.', 404);
    const referral = await client.query(`insert into public.cell_referrals (care_case_id,cell_id,note_for_cell,referred_by_user_id) values ($1,$2,$3,$4) returning id`, [caseId, cellId, noteForCell, actor.userId]);
    await client.query(`update public.care_cases set status='referred_to_cell',responsible_user_id=$1 where id=$2`, [actor.userId, caseId]);
    await audit(client, actor, 'refer_care_case_to_cell', 'cell_referral', referral.rows[0].id, 'Acompanhamento encaminhado manualmente para uma célula.', { cellId }); return referral.rows[0].id;
  });
}

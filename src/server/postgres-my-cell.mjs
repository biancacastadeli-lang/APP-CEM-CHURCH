import { getPostgresPool } from './postgres.mjs';

const operationalRoles = new Set(['member', 'leader', 'secretary']);
const meetingStatuses = new Set(['scheduled', 'held', 'not_held']);

function error(message, status = 400) { const value = new Error(message); value.status = status; return value; }
function requireActor(actor) { if (!actor?.userId || !actor?.personId || actor.source !== 'postgres') throw error('Sessão PostgreSQL inválida.', 401); }
function date(value, label = 'Data') { const normalized = String(value || '').trim(); const parsed = new Date(`${normalized}T00:00:00Z`); if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) throw error(`${label} inválida.`); return normalized; }
function time(value) { const normalized = String(value || '').trim(); if (!/^\d{2}:\d{2}(:\d{2})?$/.test(normalized)) throw error('Horário inválido.'); return normalized; }
function text(value, label, length, optional = true) { if (value == null || value === '') return optional ? '' : (() => { throw error(`${label} é obrigatório.`); })(); const normalized = String(value).trim(); if ((!normalized && !optional) || normalized.length > length) throw error(`${label} inválido.`); return normalized; }
function whatsapp(value) { const normalized = String(value || '').replace(/\D/g, ''); if (normalized.length < 10 || normalized.length > 13) throw error('WhatsApp inválido.'); return normalized; }
function amount(value) { const normalized = String(value ?? '').trim().replace(',', '.'); if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(normalized)) throw error('Valor da oferta inválido.'); return normalized; }
function amountCents(value) { const [whole, decimal = ''] = String(value).split('.'); return BigInt(whole) * 100n + BigInt(`${decimal}00`.slice(0, 2)); }
function mapCell(row) { return { id: row.id, name: row.name, weekday: row.weekday, meetingTime: row.meeting_time, addressLine: row.address_line, neighborhood: row.neighborhood, city: row.city, state: row.state, isActive: row.is_active }; }
function mapMeeting(row) { return { id: row.id, date: row.meeting_date, time: row.meeting_time, status: row.meeting_status, notes: row.notes || '', notHeldNote: row.not_held_note || '', offering: row.amount == null ? null : { amount: row.amount, status: row.treasury_status } }; }
function hasRole(actor, role) { return actor.roles?.includes(role); }

async function transaction(work) {
  const client = await getPostgresPool().connect();
  try { await client.query('begin'); const result = await work(client); await client.query('commit'); return result; }
  catch (cause) { await client.query('rollback').catch(() => {}); throw cause; }
  finally { client.release(); }
}

async function audit(client, actor, action, entityType, entityId, summary, metadata = {}) {
  await client.query(`insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, summary, metadata) values ($1,$2,$3,$4,$5,$6::jsonb)`, [actor.userId, action, entityType, String(entityId), summary, JSON.stringify(metadata)]);
}

async function linkedCells(client, actor, asRole) {
  requireActor(actor);
  if (!operationalRoles.has(asRole) || !hasRole(actor, asRole)) throw error('Sem permissão para acessar esta visão da célula.', 403);
  const sources = {
    member: `select cells.* from public.cell_memberships links join public.cells cells on cells.id=links.cell_id where links.person_id=$1 and links.ended_at is null`,
    leader: `select cells.* from public.cell_leaderships links join public.cells cells on cells.id=links.cell_id where links.person_id=$1 and links.ended_at is null`,
    secretary: `select cells.* from public.cell_secretaries links join public.cells cells on cells.id=links.cell_id where links.person_id=$1 and links.ended_at is null`
  };
  const result = await client.query(`${sources[asRole]} order by cells.name`, [actor.personId]);
  return result.rows;
}

async function requireCell(client, actor, asRole, cellId, { manage = false, leaderOnly = false } = {}) {
  const cells = await linkedCells(client, actor, asRole);
  const cell = cells.find((item) => item.id === cellId);
  if (!cell) throw error('Você não possui acesso a esta célula.', 403);
  if (manage && !['leader', 'secretary'].includes(asRole)) throw error('Sem permissão para registrar reuniões.', 403);
  if (leaderOnly && asRole !== 'leader') throw error('Somente a liderança ativa pode concluir esta ação.', 403);
  return cell;
}

async function meetingForCell(client, cellId, meetingId) {
  const result = await client.query('select * from public.cell_meetings where id=$1 and cell_id=$2', [meetingId, cellId]);
  if (!result.rowCount) throw error('Reunião não encontrada.', 404);
  return result.rows[0];
}

async function birthdays(client, cellId) {
  const result = await client.query(
    `select people.full_name, extract(day from people.birth_date)::int as day
       from public.cell_memberships memberships join public.people people on people.id=memberships.person_id
      where memberships.cell_id=$1 and memberships.ended_at is null and people.birth_date is not null
        and extract(month from people.birth_date)=extract(month from current_date)
      order by extract(day from people.birth_date), people.full_name`, [cellId]);
  return result.rows.map((row) => ({ fullName: row.full_name, day: row.day }));
}

export async function getMyCell(actor, { asRole, cellId = null } = {}) {
  const client = await getPostgresPool().connect();
  try {
    const availableRows = await linkedCells(client, actor, asRole);
    if (!availableRows.length) return { asRole, cells: [], cell: null };
    const selected = cellId ? availableRows.find((row) => row.id === cellId) : availableRows[0];
    if (!selected) throw error('Você não possui acesso a esta célula.', 403);
    const memberView = asRole === 'member';
    const [next, meetings, birthdayRows, photos, members, formationModules, cellReferrals] = await Promise.all([
      client.query(`select * from public.cell_meetings where cell_id=$1 and meeting_date >= current_date order by meeting_date, meeting_time nulls last limit 1`, [selected.id]),
      client.query(`select meetings.*, offerings.amount, offerings.treasury_status from public.cell_meetings meetings left join public.meeting_offerings offerings on offerings.meeting_id=meetings.id where meetings.cell_id=$1 order by meetings.meeting_date desc, meetings.meeting_time desc nulls last limit 24`, [selected.id]),
      birthdays(client, selected.id),
      client.query(`select photos.id,photos.caption,photos.created_at,photos.publication_status from public.meeting_photos photos join public.cell_meetings meetings on meetings.id=photos.meeting_id where meetings.cell_id=$1 and ($2::boolean or photos.publication_status='published') order by photos.created_at desc limit 24`, [selected.id, !memberView]),
      memberView ? Promise.resolve({ rows: [] }) : client.query(`select people.id,people.full_name,people.whatsapp,people.birth_date,people.baptized,people.baptized_on from public.cell_memberships memberships join public.people people on people.id=memberships.person_id where memberships.cell_id=$1 and memberships.ended_at is null order by people.full_name`, [selected.id]),
      asRole === 'leader' ? client.query(`select code,name from public.formation_modules where is_active order by display_order`) : Promise.resolve({ rows: [] }),
      asRole === 'leader' ? client.query(`select referrals.id,referrals.note_for_cell,referrals.created_at,referrals.delivery_status,people.full_name,people.whatsapp from public.cell_referrals referrals join public.care_cases care on care.id=referrals.care_case_id left join public.visitors visitors on visitors.id=care.visitor_id left join public.people visitor_people on visitor_people.id=visitors.person_id left join public.referrals member_referrals on member_referrals.id=care.referral_id left join public.people referral_people on referral_people.id=member_referrals.person_id join lateral (select coalesce(visitor_people.id,referral_people.id) as id,coalesce(visitor_people.full_name,referral_people.full_name) as full_name,coalesce(visitor_people.whatsapp,referral_people.whatsapp) as whatsapp) people on true where referrals.cell_id=$1 and referrals.delivery_status='sent' order by referrals.created_at desc`, [selected.id]) : Promise.resolve({ rows: [] })
    ]);
    let memberData = members.rows.map((row) => ({ id: row.id, fullName: row.full_name, whatsapp: asRole === 'leader' ? row.whatsapp : null, birthdayDay: row.birth_date ? new Date(`${row.birth_date}T00:00:00Z`).getUTCDate() : null, baptized: row.baptized, baptizedOn: row.baptized_on ?? null }));
    if (asRole === 'leader' && memberData.length) {
      const formations = await client.query(`select completions.person_id,modules.code,modules.name,completions.completed_on from public.person_formation_completions completions join public.formation_modules modules on modules.code=completions.module_code where completions.person_id=any($1::uuid[]) order by modules.display_order`, [memberData.map((item) => item.id)]);
      const byPerson = new Map(memberData.map((item) => [item.id, []]));
      formations.rows.forEach((row) => byPerson.get(row.person_id)?.push({ code: row.code, name: row.name, completedOn: row.completed_on }));
      memberData = memberData.map((item) => ({ ...item, journey: byPerson.get(item.id) || [] }));
    }
    const safeMeeting = (row) => {
      const mapped = mapMeeting(row);
      return memberView ? { id: mapped.id, date: mapped.date, time: mapped.time, status: mapped.status } : mapped;
    };
    return { asRole, cells: availableRows.map(mapCell), cell: mapCell(selected), nextMeeting: next.rows[0] ? safeMeeting(next.rows[0]) : null, meetings: meetings.rows.map(safeMeeting), birthdays: birthdayRows, photos: photos.rows.map((row) => ({ id: row.id, caption: row.caption, createdAt: row.created_at, status: row.publication_status })), members: memberData, formationModules: formationModules.rows.map((row) => ({ code: row.code, name: row.name })), referrals: cellReferrals.rows.map((row) => ({ id: row.id, fullName: row.full_name, whatsapp: row.whatsapp, noteForCell: row.note_for_cell, createdAt: row.created_at, status: row.delivery_status })) };
  } finally { client.release(); }
}

export async function returnCellReferral(actor, { asRole, cellId, referralId, input }) {
  const returnNote = text(input.returnNote, 'Observação', 1000);
  return transaction(async (client) => {
    await requireCell(client, actor, asRole, cellId, { manage: true, leaderOnly: true });
    const result = await client.query(`update public.cell_referrals set delivery_status='returned',returned_at=now(),returned_by_user_id=$1,return_note=$2 where id=$3 and cell_id=$4 and delivery_status='sent' returning id`, [actor.userId, returnNote, referralId, cellId]);
    if (!result.rowCount) throw error('Encaminhamento não encontrado ou já devolvido.', 404);
    await audit(client, actor, 'return_cell_referral_to_care', 'cell_referral', referralId, 'Encaminhamento devolvido à Equipe 2.', { cellId }); return true;
  });
}

export async function getMeetingDetail(actor, { asRole, cellId, meetingId }) {
  const client = await getPostgresPool().connect();
  try {
    await requireCell(client, actor, asRole, cellId, { manage: true }); const meeting = await meetingForCell(client, cellId, meetingId);
    const [members, attendance, visitors, photos, offering] = await Promise.all([
      client.query(`select people.id,people.full_name,people.whatsapp from public.cell_memberships memberships join public.people people on people.id=memberships.person_id where memberships.cell_id=$1 and memberships.ended_at is null order by people.full_name`, [cellId]),
      client.query(`select person_id,attendance_status from public.meeting_attendance where meeting_id=$1 and person_id is not null`, [meetingId]),
      client.query(`select attendance.id,people.full_name,people.whatsapp from public.meeting_attendance attendance join public.visitors visitors on visitors.id=attendance.visitor_id join public.people people on people.id=visitors.person_id where attendance.meeting_id=$1 and attendance.visitor_id is not null order by people.full_name`, [meetingId]),
      client.query(`select id,caption,created_at,publication_status from public.meeting_photos where meeting_id=$1 order by created_at desc`, [meetingId]),
      client.query(`select amount,treasury_status from public.meeting_offerings where meeting_id=$1`, [meetingId])
    ]);
    const attendanceByPerson = new Map(attendance.rows.map((row) => [row.person_id, row.attendance_status]));
    return { meeting: { ...mapMeeting(meeting), offering: offering.rows[0] ? { amount: offering.rows[0].amount, status: offering.rows[0].treasury_status } : null }, members: members.rows.map((row) => ({ id: row.id, fullName: row.full_name, whatsapp: asRole === 'leader' ? row.whatsapp : null, attendanceStatus: attendanceByPerson.get(row.id) || 'absent' })), visitors: visitors.rows.map((row) => ({ id: row.id, fullName: row.full_name, whatsapp: asRole === 'leader' ? row.whatsapp : null })), photos: photos.rows.map((row) => ({ id: row.id, caption: row.caption, createdAt: row.created_at, status: row.publication_status })) };
  } finally { client.release(); }
}

export async function createMeeting(actor, { asRole, cellId, input }) {
  const meetingDate = date(input.meetingDate, 'Data da reunião'); const meetingTime = time(input.meetingTime); const status = String(input.status || 'scheduled');
  if (!meetingStatuses.has(status)) throw error('Situação da reunião inválida.');
  const notes = text(input.notes, 'Nota geral', 2000); const notHeldNote = text(input.notHeldNote, 'Observação', 2000);
  return transaction(async (client) => { const cell = await requireCell(client, actor, asRole, cellId, { manage: true }); if (!cell.is_active) throw error('Não é possível criar reunião para uma célula inativa.', 409); const result = await client.query(`insert into public.cell_meetings (cell_id,meeting_date,meeting_time,meeting_status,notes,not_held_note,created_by_user_id) values ($1,$2,$3,$4,$5,$6,$7) returning id`, [cellId, meetingDate, meetingTime, status, notes, status === 'not_held' ? notHeldNote : '', actor.userId]); await audit(client, actor, 'create_cell_meeting', 'cell_meeting', result.rows[0].id, 'Reunião registrada.', { cellId, status }); return result.rows[0].id; });
}

export async function updateMeeting(actor, { asRole, cellId, meetingId, input }) {
  const meetingDate = date(input.meetingDate, 'Data da reunião'); const meetingTime = time(input.meetingTime); const status = String(input.status || 'scheduled'); if (!meetingStatuses.has(status)) throw error('Situação da reunião inválida.'); const notes = text(input.notes, 'Nota geral', 2000); const notHeldNote = text(input.notHeldNote, 'Observação', 2000);
  return transaction(async (client) => { await requireCell(client, actor, asRole, cellId, { manage: true }); await meetingForCell(client, cellId, meetingId); await client.query(`update public.cell_meetings set meeting_date=$1,meeting_time=$2,meeting_status=$3,notes=$4,not_held_note=$5 where id=$6`, [meetingDate, meetingTime, status, notes, status === 'not_held' ? notHeldNote : '', meetingId]); await audit(client, actor, 'update_cell_meeting', 'cell_meeting', meetingId, 'Reunião atualizada.', { cellId, status }); return true; });
}

export async function saveAttendance(actor, { asRole, cellId, meetingId, attendance }) {
  if (!Array.isArray(attendance) || attendance.length > 500) throw error('Presenças inválidas.');
  return transaction(async (client) => { await requireCell(client, actor, asRole, cellId, { manage: true }); await meetingForCell(client, cellId, meetingId); const active = await client.query(`select person_id from public.cell_memberships where cell_id=$1 and ended_at is null`, [cellId]); const ids = new Set(active.rows.map((row) => row.person_id)); for (const entry of attendance) { if (!ids.has(entry.personId) || !['present', 'absent'].includes(entry.status)) throw error('A presença deve pertencer a um integrante ativo da célula.'); await client.query(`insert into public.meeting_attendance (meeting_id,person_id,attendance_status) values ($1,$2,$3) on conflict (meeting_id,person_id) where person_id is not null do update set attendance_status=excluded.attendance_status,recorded_at=now()`, [meetingId, entry.personId, entry.status]); } await audit(client, actor, 'record_meeting_attendance', 'cell_meeting', meetingId, 'Presenças registradas.', { cellId, count: attendance.length }); return true; });
}

export async function registerMeetingVisitor(actor, { asRole, cellId, meetingId, input }) {
  const fullName = text(input.fullName, 'Nome', 120, false); const number = whatsapp(input.whatsapp);
  return transaction(async (client) => { await requireCell(client, actor, asRole, cellId, { manage: true }); await meetingForCell(client, cellId, meetingId); let person = await client.query(`select id from public.people where whatsapp=$1 limit 1 for update`, [number]); let personId = person.rows[0]?.id; if (!personId) { const inserted = await client.query(`insert into public.people (full_name,whatsapp,person_status) values ($1,$2,'visitor') returning id`, [fullName, number]); personId = inserted.rows[0].id; } let visitor = await client.query(`select id from public.visitors where person_id=$1 order by created_at desc limit 1`, [personId]); if (!visitor.rowCount) visitor = await client.query(`insert into public.visitors (person_id,source,consent_contact) values ($1,'cell_meeting',false) returning id`, [personId]); const visitorId = visitor.rows[0].id; await client.query(`insert into public.meeting_attendance (meeting_id,visitor_id,attendance_status) values ($1,$2,'present') on conflict (meeting_id,visitor_id) where visitor_id is not null do update set attendance_status='present',recorded_at=now()`, [meetingId, visitorId]); await audit(client, actor, 'register_meeting_visitor', 'cell_meeting', meetingId, 'Visitante registrado na reunião.', { cellId }); return visitorId; });
}

export async function saveMeetingOffering(actor, { asRole, cellId, meetingId, input }) {
  const value = amount(input.amount);
  return transaction(async (client) => { await requireCell(client, actor, asRole, cellId, { manage: true }); await meetingForCell(client, cellId, meetingId); const current = await client.query(`select amount,treasury_status from public.meeting_offerings where meeting_id=$1 for update`, [meetingId]); if (current.rowCount && current.rows[0].treasury_status !== 'pending') throw error('A oferta já foi enviada à Tesouraria e não pode ser alterada nesta etapa.', 409); if (current.rowCount) { await client.query(`update public.meeting_offerings set amount=$1,recorded_by_user_id=$2 where meeting_id=$3`, [value, actor.userId, meetingId]); if (amountCents(current.rows[0].amount) !== amountCents(value)) await client.query(`insert into public.meeting_offering_adjustments (meeting_id,previous_amount,corrected_amount,changed_by_user_id) values ($1,$2,$3,$4)`, [meetingId, current.rows[0].amount, value, actor.userId]); } else await client.query(`insert into public.meeting_offerings (meeting_id,amount,recorded_by_user_id) values ($1,$2,$3)`, [meetingId, value, actor.userId]); await audit(client, actor, current.rowCount ? 'update_meeting_offering' : 'record_meeting_offering', 'cell_meeting', meetingId, 'Oferta da reunião registrada.', { cellId }); return true; });
}

export async function publishMeetingPhoto(actor, { asRole, cellId, meetingId, photoId, published }) {
  return transaction(async (client) => { await requireCell(client, actor, asRole, cellId, { manage: true, leaderOnly: true }); await meetingForCell(client, cellId, meetingId); const result = await client.query(`update public.meeting_photos set publication_status=$1,published_at=$2,published_by_user_id=$3 where id=$4 and meeting_id=$5 returning id`, [published ? 'published' : 'uploaded', published ? new Date().toISOString() : null, published ? actor.userId : null, photoId, meetingId]); if (!result.rowCount) throw error('Foto não encontrada.', 404); await audit(client, actor, published ? 'publish_meeting_photo' : 'unpublish_meeting_photo', 'meeting_photo', photoId, published ? 'Foto publicada para membros.' : 'Publicação da foto removida.', { cellId, meetingId }); return true; });
}

export async function updateMemberJourney(actor, { asRole, cellId, personId, input }) {
  const moduleCode = String(input.moduleCode || '').trim(); const completedOn = input.completedOn ? date(input.completedOn, 'Data de conclusão') : null; if (!moduleCode) throw error('Módulo inválido.');
  return transaction(async (client) => { await requireCell(client, actor, asRole, cellId, { manage: true, leaderOnly: true }); const member = await client.query(`select 1 from public.cell_memberships where cell_id=$1 and person_id=$2 and ended_at is null`, [cellId, personId]); if (!member.rowCount) throw error('Pessoa não pertence à célula.', 403); await client.query(`insert into public.person_formation_completions (person_id,module_code,completed_on,recorded_by_user_id) values ($1,$2,$3,$4) on conflict (person_id,module_code) do update set completed_on=excluded.completed_on,recorded_by_user_id=excluded.recorded_by_user_id,recorded_at=now()`, [personId, moduleCode, completedOn, actor.userId]); await audit(client, actor, 'update_cell_member_journey', 'person', personId, 'Jornada atualizada pela liderança.', { cellId, moduleCode }); return true; });
}

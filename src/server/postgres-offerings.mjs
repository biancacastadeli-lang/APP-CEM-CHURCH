import { getPostgresPool } from './postgres.mjs';

const statuses = new Set(['pending', 'sent', 'confirmed']);
const transitions = new Map([['pending:sent', true], ['sent:confirmed', true]]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(message, status = 400) { const value = new Error(message); value.status = status; return value; }
function requireAdmin(actor) {
  if (!actor?.userId || actor.source !== 'postgres') throw fail('Sessão PostgreSQL inválida.', 401);
  if (!actor.roles?.includes('admin')) throw fail('Sem permissão administrativa.', 403);
}
function validId(value, label = 'Identificador') { if (!uuid.test(String(value || ''))) throw fail(`${label} inválido.`); return String(value); }
function validDate(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) throw fail(`${label} inválida.`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw fail(`${label} inválida.`);
  return value;
}
function note(value) {
  if (value == null) return null;
  if (typeof value !== 'string' || value.trim().length > 2000) throw fail('Observação administrativa inválida.');
  return value.trim() || null;
}
function money(value) {
  const normalized = String(value ?? '').trim().replace(',', '.');
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(normalized)) throw fail('Valor da oferta inválido.');
  return normalized;
}
function cents(value) { const [whole, decimal = ''] = String(value).split('.'); return BigInt(whole) * 100n + BigInt(`${decimal}00`.slice(0, 2)); }

export function assertOfferingTransition(current, next) {
  if (!statuses.has(current) || !statuses.has(next) || !transitions.has(`${current}:${next}`)) throw fail('Transição de oferta não permitida.', 409);
}

async function transaction(work) {
  const client = await getPostgresPool().connect();
  try { await client.query('begin'); const result = await work(client); await client.query('commit'); return result; }
  catch (cause) { await client.query('rollback').catch(() => {}); throw cause; }
  finally { client.release(); }
}

async function audit(client, actor, action, meetingId, summary, metadata = {}) {
  await client.query(
    `insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, summary, metadata)
     values ($1,$2,'meeting_offering',$3,$4,$5::jsonb)`,
    [actor.userId, action, String(meetingId), summary, JSON.stringify(metadata)]
  );
}

function mapOffering(row) {
  return {
    meetingId: row.meeting_id, cell: { id: row.cell_id, name: row.cell_name },
    meetingDate: row.meeting_date, meetingTime: row.meeting_time, amount: row.amount,
    currency: row.currency, status: row.treasury_status, administrativeNote: row.administrative_note || '',
    recordedAt: row.created_at, updatedAt: row.updated_at,
    recordedBy: row.recorded_by_name || null, sentAt: row.sent_to_treasury_at, sentBy: row.sent_by_name || null
  };
}

const offeringSelect = `
  select offerings.meeting_id, offerings.amount, offerings.currency, offerings.treasury_status,
         offerings.administrative_note, offerings.created_at, offerings.updated_at,
         offerings.sent_to_treasury_at, meetings.cell_id, meetings.meeting_date, meetings.meeting_time,
         cells.name as cell_name, recorder.full_name as recorded_by_name, sender.full_name as sent_by_name
    from public.meeting_offerings offerings
    join public.cell_meetings meetings on meetings.id=offerings.meeting_id
    join public.cells cells on cells.id=meetings.cell_id
    left join public.app_users recorded_user on recorded_user.id=offerings.recorded_by_user_id
    left join public.people recorder on recorder.id=recorded_user.person_id
    left join public.app_users sent_user on sent_user.id=offerings.sent_to_treasury_by_user_id
    left join public.people sender on sender.id=sent_user.person_id`;

export async function listAdminOfferings(actor, filters = {}) {
  requireAdmin(actor);
  const status = filters.status ? String(filters.status) : null;
  if (status && !statuses.has(status)) throw fail('Situação da oferta inválida.');
  const cellId = filters.cellId ? validId(filters.cellId, 'Célula') : null;
  const from = filters.from ? validDate(filters.from, 'Data inicial') : null;
  const to = filters.to ? validDate(filters.to, 'Data final') : null;
  if (from && to && from > to) throw fail('O período informado é inválido.');
  const client = await getPostgresPool().connect();
  try {
    const result = await client.query(`${offeringSelect}
      where ($1::text is null or offerings.treasury_status=$1)
        and ($2::uuid is null or meetings.cell_id=$2)
        and ($3::date is null or meetings.meeting_date >= $3)
        and ($4::date is null or meetings.meeting_date <= $4)
      order by meetings.meeting_date desc, meetings.meeting_time desc nulls last, cells.name
      limit 250`, [status, cellId, from, to]);
    return { offerings: result.rows.map(mapOffering) };
  } finally { client.release(); }
}

export async function getAdminOffering(actor, meetingId) {
  requireAdmin(actor); meetingId = validId(meetingId, 'Oferta');
  const client = await getPostgresPool().connect();
  try {
    const current = await client.query(`${offeringSelect} where offerings.meeting_id=$1`, [meetingId]);
    if (!current.rowCount) throw fail('Oferta não encontrada.', 404);
    const adjustments = await client.query(
      `select adjustments.id,adjustments.previous_amount,adjustments.corrected_amount,
              adjustments.administrative_note,adjustments.created_at,people.full_name as changed_by_name
         from public.meeting_offering_adjustments adjustments
         left join public.app_users users on users.id=adjustments.changed_by_user_id
         left join public.people people on people.id=users.person_id
        where adjustments.meeting_id=$1 order by adjustments.created_at desc`, [meetingId]);
    return { offering: mapOffering(current.rows[0]), adjustments: adjustments.rows.map((row) => ({ id: row.id, previousAmount: row.previous_amount, correctedAmount: row.corrected_amount, administrativeNote: row.administrative_note || '', createdAt: row.created_at, changedBy: row.changed_by_name || null })) };
  } finally { client.release(); }
}

export async function transitionAdminOffering(actor, meetingId, input = {}) {
  requireAdmin(actor); meetingId = validId(meetingId, 'Oferta');
  const next = String(input.status || '');
  if (!statuses.has(next)) throw fail('Situação da oferta inválida.');
  const administrativeNote = note(input.administrativeNote);
  return transaction(async (client) => {
    const current = await client.query(`select treasury_status from public.meeting_offerings where meeting_id=$1 for update`, [meetingId]);
    if (!current.rowCount) throw fail('Oferta não encontrada.', 404);
    const previous = current.rows[0].treasury_status;
    assertOfferingTransition(previous, next);
    const fields = next === 'sent'
      ? `treasury_status='sent',sent_to_treasury_at=now(),sent_to_treasury_by_user_id=$1,administrative_note=coalesce($2,administrative_note)`
      : `treasury_status='confirmed',administrative_note=coalesce($2,administrative_note)`;
    await client.query(`update public.meeting_offerings set ${fields} where meeting_id=$3`, [actor.userId, administrativeNote, meetingId]);
    await audit(client, actor, next === 'sent' ? 'send_meeting_offering' : 'confirm_meeting_offering', meetingId, next === 'sent' ? 'Oferta enviada à Tesouraria.' : 'Oferta confirmada.', { from: previous, to: next });
    return true;
  });
}

export async function correctAdminOffering(actor, meetingId, input = {}) {
  requireAdmin(actor); meetingId = validId(meetingId, 'Oferta');
  const corrected = money(input.amount); const administrativeNote = note(input.administrativeNote);
  return transaction(async (client) => {
    const current = await client.query(`select amount from public.meeting_offerings where meeting_id=$1 for update`, [meetingId]);
    if (!current.rowCount) throw fail('Oferta não encontrada.', 404);
    if (cents(current.rows[0].amount) === cents(corrected)) throw fail('Informe um valor diferente para registrar uma correção.', 409);
    await client.query(`insert into public.meeting_offering_adjustments (meeting_id,previous_amount,corrected_amount,administrative_note,changed_by_user_id) values ($1,$2,$3,coalesce($4,''),$5)`, [meetingId, current.rows[0].amount, corrected, administrativeNote, actor.userId]);
    await client.query(`update public.meeting_offerings set amount=$1,administrative_note=coalesce($2,administrative_note) where meeting_id=$3`, [corrected, administrativeNote, meetingId]);
    await audit(client, actor, 'correct_meeting_offering', meetingId, 'Valor da oferta corrigido com histórico preservado.', {});
    return true;
  });
}

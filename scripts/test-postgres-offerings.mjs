import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { closePostgresPool, getPostgresPool } from '../src/server/postgres.mjs';
import { assertOfferingTransition, listAdminOfferings } from '../src/server/postgres-offerings.mjs';

for (const [from, to] of [['pending', 'sent'], ['sent', 'confirmed']]) {
  assert.doesNotThrow(() => assertOfferingTransition(from, to));
}
for (const [from, to] of [['pending', 'confirmed'], ['sent', 'pending'], ['confirmed', 'sent'], ['pending', 'pending']]) {
  assert.throws(() => assertOfferingTransition(from, to), (error) => error.status === 409);
}

await assert.rejects(
  () => listAdminOfferings({ source: 'postgres', userId: '00000000-0000-4000-8000-000000000001', roles: ['member'] }),
  (error) => error.status === 403
);
await assert.rejects(
  () => listAdminOfferings(null),
  (error) => error.status === 401
);

const pool = getPostgresPool();
const client = await pool.connect();
const suffix = randomBytes(6).toString('hex');
const phone = () => `5511${Array.from(randomBytes(9), (byte) => byte % 10).join('')}`;

async function expectFailure(work) {
  await client.query('savepoint expected_failure'); let failed = false;
  try { await work(); } catch { failed = true; }
  await client.query('rollback to savepoint expected_failure'); await client.query('release savepoint expected_failure');
  assert.ok(failed, 'A operação deveria ser rejeitada.');
}

try {
  await client.query('begin');
  const person = await client.query(`insert into public.people (full_name,whatsapp,person_status) values ($1,$2,'member') returning id`, [`Teste oferta ${suffix}`, phone()]);
  const user = await client.query(`insert into public.app_users (person_id,password_hash,password_salt) values ($1,$2,$3) returning id`, [person.rows[0].id, 'a'.repeat(128), 'b'.repeat(32)]);
  const cell = await client.query(`insert into public.cells (name,weekday,meeting_time,address_line,neighborhood,city,state) values ($1,3,'19:30','Local','Bairro','Cidade','SP') returning id`, [`Célula oferta ${suffix}`]);
  const meeting = await client.query(`insert into public.cell_meetings (cell_id,meeting_date,meeting_time,meeting_status,created_by_user_id) values ($1,current_date,'19:30','held',$2) returning id`, [cell.rows[0].id, user.rows[0].id]);
  await client.query(`insert into public.meeting_offerings (meeting_id,amount,recorded_by_user_id) values ($1,'25.00',$2)`, [meeting.rows[0].id, user.rows[0].id]);
  await client.query(`update public.meeting_offerings set treasury_status='sent',sent_to_treasury_at=now(),sent_to_treasury_by_user_id=$2 where meeting_id=$1`, [meeting.rows[0].id, user.rows[0].id]);
  await client.query(`update public.meeting_offerings set treasury_status='confirmed' where meeting_id=$1`, [meeting.rows[0].id]);
  const offering = await client.query(`select treasury_status,sent_to_treasury_at,sent_to_treasury_by_user_id from public.meeting_offerings where meeting_id=$1`, [meeting.rows[0].id]);
  assert.equal(offering.rows[0].treasury_status, 'confirmed'); assert.ok(offering.rows[0].sent_to_treasury_at); assert.equal(offering.rows[0].sent_to_treasury_by_user_id, user.rows[0].id);
  await client.query(`insert into public.meeting_offering_adjustments (meeting_id,previous_amount,corrected_amount,administrative_note,changed_by_user_id) values ($1,'25.00','30.00','Ajuste de conferência',$2)`, [meeting.rows[0].id, user.rows[0].id]);
  const history = await client.query(`select previous_amount,corrected_amount from public.meeting_offering_adjustments where meeting_id=$1`, [meeting.rows[0].id]);
  assert.equal(history.rowCount, 1); assert.equal(history.rows[0].previous_amount, '25.00'); assert.equal(history.rows[0].corrected_amount, '30.00');
  await expectFailure(() => client.query(`update public.meeting_offerings set amount=-1 where meeting_id=$1`, [meeting.rows[0].id]));
  await client.query('rollback');
  console.log('Oferta PostgreSQL: transições, histórico, vínculo de reunião e restrição de valor passaram com rollback.');
} catch (error) {
  await client.query('rollback').catch(() => {}); throw error;
} finally {
  client.release(); await closePostgresPool();
}

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { closePostgresPool, getPostgresPool } from '../src/server/postgres.mjs';
import { createMeeting, getMyCell } from '../src/server/postgres-my-cell.mjs';

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
  const people = [];
  for (const name of ['Liderança', 'Secretaria', 'Membro', 'Visitante', 'Outra pessoa']) {
    const result = await client.query(`insert into public.people (full_name,whatsapp,person_status,birth_date) values ($1,$2,'member','2000-09-19') returning id`, [`Teste ${name} ${suffix}`, phone()]);
    people.push(result.rows[0].id);
  }
  const [leaderPerson, secretaryPerson, memberPerson, visitorPerson, outsiderPerson] = people;
  const leaderUser = await client.query(`insert into public.app_users (person_id,password_hash,password_salt) values ($1,$2,$3) returning id`, [leaderPerson, 'a'.repeat(128), 'b'.repeat(32)]);
  const secretaryUser = await client.query(`insert into public.app_users (person_id,password_hash,password_salt) values ($1,$2,$3) returning id`, [secretaryPerson, 'c'.repeat(128), 'd'.repeat(32)]);
  await client.query(`insert into public.user_roles (user_id,role_code) values ($1,'leader'),($2,'secretary')`, [leaderUser.rows[0].id, secretaryUser.rows[0].id]);
  const cell = await client.query(`insert into public.cells (name,weekday,meeting_time,address_line,neighborhood,city,state) values ($1,3,'19:30','Local','Bairro','Cidade','SP') returning id`, [`Célula reuniões ${suffix}`]);
  const cellId = cell.rows[0].id;
  await client.query(`insert into public.cell_memberships (cell_id,person_id) values ($1,$2),($1,$3)`, [cellId, leaderPerson, memberPerson]);
  await client.query(`insert into public.cell_leaderships (cell_id,person_id) values ($1,$2)`, [cellId, leaderPerson]);
  await client.query(`insert into public.cell_secretaries (cell_id,person_id) values ($1,$2)`, [cellId, secretaryPerson]);
  const meeting = await client.query(`insert into public.cell_meetings (cell_id,meeting_date,meeting_time,meeting_status,created_by_user_id) values ($1,current_date,'19:30','scheduled',$2) returning id,meeting_time`, [cellId, leaderUser.rows[0].id]);
  assert.equal(String(meeting.rows[0].meeting_time).slice(0, 5), '19:30');
  await client.query(`update public.cell_meetings set meeting_status='held' where id=$1`, [meeting.rows[0].id]);
  await client.query(`update public.cell_meetings set meeting_status='not_held' where id=$1`, [meeting.rows[0].id]);
  await expectFailure(() => client.query(`update public.cell_meetings set meeting_status='completed' where id=$1`, [meeting.rows[0].id]));
  await client.query(`insert into public.meeting_attendance (meeting_id,person_id,attendance_status) values ($1,$2,'present')`, [meeting.rows[0].id, memberPerson]);
  await expectFailure(() => client.query(`insert into public.meeting_attendance (meeting_id,person_id,attendance_status) values ($1,$2,'present')`, [meeting.rows[0].id, memberPerson]));
  const visitor = await client.query(`insert into public.visitors (person_id,source,consent_contact) values ($1,'cell_meeting',false) returning id`, [visitorPerson]);
  await client.query(`insert into public.meeting_attendance (meeting_id,visitor_id,attendance_status) values ($1,$2,'present')`, [meeting.rows[0].id, visitor.rows[0].id]);
  await client.query(`insert into public.meeting_offerings (meeting_id,amount,recorded_by_user_id) values ($1,'25.00',$2)`, [meeting.rows[0].id, secretaryUser.rows[0].id]);
  await expectFailure(() => client.query(`update public.meeting_offerings set amount=-1 where meeting_id=$1`, [meeting.rows[0].id]));
  const photo = await client.query(`insert into public.meeting_photos (meeting_id,storage_object_path,uploaded_by_user_id) values ($1,$2,$3) returning id`, [meeting.rows[0].id, `tests/${suffix}.jpg`, secretaryUser.rows[0].id]);
  await expectFailure(() => client.query(`update public.meeting_photos set publication_status='published',published_at=now(),published_by_user_id=$1 where id=$2`, [secretaryUser.rows[0].id, photo.rows[0].id]));
  await client.query(`update public.meeting_photos set publication_status='published',published_at=now(),published_by_user_id=$1 where id=$2`, [leaderUser.rows[0].id, photo.rows[0].id]);
  const birthdays = await client.query(`select extract(day from birth_date)::int as day from public.people where id=$1 and extract(month from birth_date)=extract(month from current_date)`, [memberPerson]);
  assert.equal(birthdays.rows[0].day, 19);
  await client.query('rollback');
  const noScopeActor = { source: 'postgres', userId: '00000000-0000-4000-8000-000000000010', personId: '00000000-0000-4000-8000-000000000011', roles: ['member'] };
  const emptyCell = await getMyCell(noScopeActor, { asRole: 'member' });
  assert.equal(emptyCell.cell, null, 'Membro sem membresia não pode receber célula global.');
  await assert.rejects(() => createMeeting(noScopeActor, { asRole: 'member', cellId: '00000000-0000-4000-8000-000000000012', input: { meetingDate: '2026-09-19', meetingTime: '19:30', status: 'scheduled' } }), (cause) => cause.status === 403);
  console.log('Verificação concluída: reuniões, horário histórico, presença, visitantes, oferta, aniversariantes e regras de fotos preservam integridade.');
} catch (error) {
  await client.query('rollback').catch(() => {}); throw error;
} finally {
  client.release(); await closePostgresPool();
}

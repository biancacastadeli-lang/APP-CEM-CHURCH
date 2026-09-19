import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { closePostgresPool, getPostgresPool } from '../src/server/postgres.mjs';
import { createMemberReferral, createPublicPreRegistration, listCareReferrals, listCareVisitors, listReceptionVisitors } from '../src/server/postgres-welcome.mjs';

await assert.rejects(() => createPublicPreRegistration({ name: '', whatsapp: '5511999999999', consent: true }), (error) => error.status === 400);
await assert.rejects(() => createPublicPreRegistration({ name: 'Pessoa', whatsapp: '5511999999999', consent: false }), (error) => error.status === 400);
await assert.rejects(() => listReceptionVisitors({ source: 'postgres', userId: '00000000-0000-4000-8000-000000000001', roles: ['member'] }), (error) => error.status === 403);
await assert.rejects(() => listCareVisitors({ source: 'postgres', userId: '00000000-0000-4000-8000-000000000001', roles: ['welcome1'] }), (error) => error.status === 403);
await assert.rejects(() => listCareVisitors(null), (error) => error.status === 401);
await assert.rejects(() => createMemberReferral({ source: 'postgres', userId: '00000000-0000-4000-8000-000000000001', personId: '00000000-0000-4000-8000-000000000002', roles: ['leader'] }, { name: 'Pessoa', whatsapp: '5511999999999' }), (error) => error.status === 403);
await assert.rejects(() => listCareReferrals({ source: 'postgres', userId: '00000000-0000-4000-8000-000000000001', roles: ['secretary'] }), (error) => error.status === 403);

const pool = getPostgresPool();
const client = await pool.connect();
const suffix = randomBytes(6).toString('hex');
const phone = () => `5511${Array.from(randomBytes(9), (byte) => byte % 10).join('')}`;

try {
  await client.query('begin');
  const member = await client.query(`insert into public.people (full_name,whatsapp,person_status) values ($1,$2,'member') returning id`, [`Membro teste ${suffix}`, phone()]);
  const welcome = await client.query(`insert into public.people (full_name,whatsapp,person_status) values ($1,$2,'member') returning id`, [`Equipe 2 teste ${suffix}`, phone()]);
  const leader = await client.query(`insert into public.people (full_name,whatsapp,person_status) values ($1,$2,'member') returning id`, [`Líder teste ${suffix}`, phone()]);
  const indicated = await client.query(`insert into public.people (full_name,whatsapp,person_status) values ($1,$2,'visitor') returning id`, [`Indicação teste ${suffix}`, phone()]);
  const welcomeUser = await client.query(`insert into public.app_users (person_id,password_hash,password_salt) values ($1,$2,$3) returning id`, [welcome.rows[0].id, 'a'.repeat(128), 'b'.repeat(32)]);
  const leaderUser = await client.query(`insert into public.app_users (person_id,password_hash,password_salt) values ($1,$2,$3) returning id`, [leader.rows[0].id, 'c'.repeat(128), 'd'.repeat(32)]);
  await client.query(`insert into public.user_roles (user_id,role_code) values ($1,'welcome2'),($2,'leader')`, [welcomeUser.rows[0].id, leaderUser.rows[0].id]);
  const cell = await client.query(`insert into public.cells (name,weekday,meeting_time,address_line,neighborhood,city,state) values ($1,3,'19:30','Local','Bairro','Cidade','SP') returning id`, [`Célula acolhimento ${suffix}`]);
  await client.query(`insert into public.cell_leaderships (cell_id,person_id) values ($1,$2)`, [cell.rows[0].id, leader.rows[0].id]);
  const referral = await client.query(`insert into public.referrals (person_id,referred_by_person_id,referrer_note) values ($1,$2,'Observação inicial') returning id`, [indicated.rows[0].id, member.rows[0].id]);
  const care = await client.query(`insert into public.care_cases (referral_id,status,responsible_user_id) values ($1,'open',$2) returning id`, [referral.rows[0].id, welcomeUser.rows[0].id]);
  await client.query(`insert into public.care_records (care_case_id,contact_type,private_note,created_by_user_id) values ($1,'contact','NOTA-PRIVADA-DE-TESTE',$2)`, [care.rows[0].id, welcomeUser.rows[0].id]);
  const forwarded = await client.query(`insert into public.cell_referrals (care_case_id,cell_id,note_for_cell,referred_by_user_id) values ($1,$2,'Informação compartilhável',$3) returning id`, [care.rows[0].id, cell.rows[0].id, welcomeUser.rows[0].id]);
  const leaderView = await client.query(`select people.full_name,people.whatsapp,referrals.note_for_cell from public.cell_referrals referrals join public.care_cases care on care.id=referrals.care_case_id join public.referrals member_referrals on member_referrals.id=care.referral_id join public.people on people.id=member_referrals.person_id where referrals.id=$1 and referrals.cell_id=$2`, [forwarded.rows[0].id, cell.rows[0].id]);
  assert.equal(leaderView.rowCount, 1); assert.equal(leaderView.rows[0].note_for_cell, 'Informação compartilhável');
  const privateLeak = await client.query(`select private_note from public.care_records where care_case_id=$1`, [care.rows[0].id]);
  assert.equal(privateLeak.rows[0].private_note, 'NOTA-PRIVADA-DE-TESTE');
  await client.query(`update public.cell_referrals set delivery_status='returned',returned_at=now(),returned_by_user_id=$1,return_note='Retornar para análise' where id=$2 and cell_id=$3`, [leaderUser.rows[0].id, forwarded.rows[0].id, cell.rows[0].id]);
  const returned = await client.query(`select delivery_status,return_note from public.cell_referrals where id=$1`, [forwarded.rows[0].id]);
  assert.equal(returned.rows[0].delivery_status, 'returned'); assert.equal(returned.rows[0].return_note, 'Retornar para análise');
  await client.query('rollback');
  console.log('Boas-Vindas PostgreSQL: indicação, cuidado privado, encaminhamento e devolução passaram com rollback.');
} catch (error) {
  await client.query('rollback').catch(() => {}); throw error;
} finally {
  client.release(); await closePostgresPool();
}

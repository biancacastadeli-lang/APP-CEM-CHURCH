import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { closePostgresPool, getPostgresPool } from '../src/server/postgres.mjs';

const pool = getPostgresPool();
const client = await pool.connect();
const suffix = randomBytes(6).toString('hex');
const whatsapp = `5511${Array.from(randomBytes(9), (byte) => byte % 10).join('')}`;

async function rejects(work) {
  await client.query('savepoint expected_failure');
  let failed = false;
  try { await work(); } catch { failed = true; }
  await client.query('rollback to savepoint expected_failure');
  await client.query('release savepoint expected_failure');
  assert.ok(failed, 'A operação deveria ser recusada pela integridade do banco.');
}

try {
  await client.query('begin');
  const ministry = await client.query(`select id from public.ministries where lower(name)=lower('Família') limit 1`);
  assert.equal(ministry.rowCount, 1, 'O ministério estrutural Família precisa existir.');
  const people = await client.query(
    `insert into public.people (full_name,whatsapp,person_status) values
      ($1,$2,'member'),($3,$4,'member'),($5,$6,'member') returning id`,
    [`Teste Líder A ${suffix}`, whatsapp, `Teste Líder B ${suffix}`, `${whatsapp.slice(0, -1)}8`, `Teste Supervisor ${suffix}`, `${whatsapp.slice(0, -1)}7`]
  );
  const [leaderOne, leaderTwo, supervisor] = people.rows.map((row) => row.id);
  await client.query('insert into public.ministry_supervisor_assignments (ministry_id,person_id) values ($1,$2)', [ministry.rows[0].id, supervisor]);
  const cell = await client.query(`insert into public.cells (name,weekday,meeting_time,address_line,neighborhood,city,state,ministry_id) values ($1,1,'19:30','Local temporário','Bairro','Cidade','SP',$2) returning id`, [`Célula organizacional ${suffix}`, ministry.rows[0].id]);
  const cellId = cell.rows[0].id;
  await client.query('insert into public.cell_supervisor_assignments (cell_id,person_id) values ($1,$2)', [cellId, supervisor]);
  await client.query('insert into public.cell_leaderships (cell_id,person_id) values ($1,$2),($1,$3)', [cellId, leaderOne, leaderTwo]);
  const currentLeaders = await client.query('select person_id from public.cell_leaderships where cell_id=$1 and ended_at is null', [cellId]);
  assert.equal(currentLeaders.rowCount, 2, 'A célula deve aceitar duas lideranças ativas.');
  await rejects(() => client.query('insert into public.cell_leaderships (cell_id,person_id) values ($1,$2)', [cellId, leaderOne]));
  await rejects(() => client.query('insert into public.cell_supervisor_assignments (cell_id,person_id) values ($1,$2)', [cellId, leaderOne]));
  await client.query('rollback');
  console.log('Verificação PostgreSQL: ministérios, supervisão e liderança múltipla passaram sem persistir dados.');
} catch (error) {
  await client.query('rollback').catch(() => {});
  throw error;
} finally {
  client.release();
  await closePostgresPool();
}

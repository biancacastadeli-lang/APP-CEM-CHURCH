import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { getPostgresPool, closePostgresPool } from '../src/server/postgres.mjs';
import { listPeople } from '../src/server/postgres-people-cells.mjs';

const pool = getPostgresPool();
const client = await pool.connect();
const suffix = randomBytes(6).toString('hex');
const testWhatsapp = `5511${Array.from(randomBytes(9), (byte) => byte % 10).join('')}`;

async function expectConstraintFailure(work) {
  await client.query('savepoint expected_constraint_failure');
  let rejected = false;
  try {
    await work();
  } catch (error) {
    rejected = true;
    assert.ok(error.code || error.message, 'A constraint deve rejeitar a operação.');
  } finally {
    await client.query('rollback to savepoint expected_constraint_failure');
    await client.query('release savepoint expected_constraint_failure');
  }
  assert.ok(rejected, 'A operação deveria violar uma constraint.');
}

try {
  await client.query('begin');
  const person = await client.query(`insert into public.people (full_name, whatsapp, person_status) values ($1,$2,'visitor') returning id`, [`Teste temporário ${suffix}`, testWhatsapp]);
  const personId = person.rows[0].id;
  const history = await client.query(`select source_type, current_status from public.person_status_history where person_id=$1`, [personId]);
  assert.deepEqual(history.rows, [{ source_type: 'person', current_status: 'visitor' }]);
  await expectConstraintFailure(() => client.query(`insert into public.people (full_name, whatsapp) values ('Duplicidade temporária',$1)`, [testWhatsapp]));

  const cellOne = await client.query(`insert into public.cells (name,weekday,meeting_time,address_line,neighborhood,city,state) values ($1,1,'19:30','Local A','Bairro','Cidade','SP') returning id`, [`Célula temporária A ${suffix}`]);
  const cellTwo = await client.query(`insert into public.cells (name,weekday,meeting_time,address_line,neighborhood,city,state) values ($1,2,'19:30','Local B','Bairro','Cidade','SP') returning id`, [`Célula temporária B ${suffix}`]);
  await client.query(`insert into public.cell_memberships (cell_id,person_id) values ($1,$2)`, [cellOne.rows[0].id, personId]);
  await expectConstraintFailure(() => client.query(`insert into public.cell_memberships (cell_id,person_id) values ($1,$2)`, [cellTwo.rows[0].id, personId]));
  await client.query(`update public.cell_memberships set ended_at=current_date where cell_id=$1 and person_id=$2 and ended_at is null`, [cellOne.rows[0].id, personId]);
  await client.query(`insert into public.cell_memberships (cell_id,person_id) values ($1,$2)`, [cellTwo.rows[0].id, personId]);
  await client.query(`insert into public.cell_leaderships (cell_id,person_id) values ($1,$2)`, [cellOne.rows[0].id, personId]);
  await client.query(`insert into public.cell_secretaries (cell_id,person_id) values ($1,$2)`, [cellOne.rows[0].id, personId]);
  await client.query(`insert into public.person_ministry_assignments (person_id,ministry_function_code,cell_id) values ($1,'host',$2)`, [personId, cellOne.rows[0].id]);
  await client.query(`insert into public.person_ministry_assignments (person_id,ministry_function_code,cell_id) values ($1,'social_assistant',$2)`, [personId, cellOne.rows[0].id]);
  await client.query(`insert into public.person_ministry_assignments (person_id,ministry_function_code) values ($1,'treasurer')`, [personId]);
  await expectConstraintFailure(() => client.query(`insert into public.person_ministry_assignments (person_id,ministry_function_code,cell_id) values ($1,'treasurer',$2)`, [personId, cellOne.rows[0].id]));
  await client.query('rollback');

  await assert.rejects(() => listPeople({ roles: ['member'] }), (error) => error.status === 403);
  await assert.rejects(() => listPeople({ roles: ['secretary'] }), (error) => error.status === 403);
  const admin = await client.query(`select user_id from public.user_roles where role_code='admin' limit 1`);
  if (admin.rowCount) {
    const noScope = await listPeople({ userId: admin.rows[0].user_id, roles: ['supervisor'] });
    assert.deepEqual(noScope, [], 'Supervisor sem escopo não pode receber Pessoas globalmente.');
  }
  console.log('Verificação concluída: Pessoas e Células preservam integridade, escopo de funções e bloqueios administrativos.');
} catch (error) {
  await client.query('rollback').catch(() => {});
  throw error;
} finally {
  client.release();
  await closePostgresPool();
}

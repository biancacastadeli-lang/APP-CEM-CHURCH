import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile('supabase/migrations/20260919160000_add_organizational_teams.sql', 'utf8');
const teams = await readFile('src/server/postgres-teams.mjs', 'utf8');
const peopleCells = await readFile('src/server/postgres-people-cells.mjs', 'utf8');
const welcome = await readFile('src/server/postgres-welcome.mjs', 'utf8');
const app = await readFile('src/app.js', 'utf8');

for (const required of [
  'create table public.ministries',
  'create table public.ministry_supervisor_assignments',
  'create table public.cell_supervisor_assignments',
  'drop index public.cell_leaderships_one_current_leader',
  'cell_leaderships_one_active_person_per_cell',
  "('Família')", "('Jovens')", "('Mulheres')", "('Kids')",
  'enable row level security'
]) assert.ok(migration.includes(required), `Migration organizacional sem: ${required}`);

assert.ok(!/insert into public\.(people|cells|app_users|user_roles)/i.test(migration), 'A migration não pode criar dados pessoais ou credenciais.');
assert.ok(!/(database_url|service_role|anon_key|postgres:\/\/[^\s]+)/i.test(migration), 'A migration não pode conter credenciais.');
assert.ok(teams.includes("requireAdmin(actor)"), 'As operações de Equipes devem exigir Administrador.');
assert.ok(teams.includes("welcomeRoles"), 'Boas-Vindas deve continuar usando papéis existentes.');
assert.ok(peopleCells.includes('syncLeaders'), 'A atualização de lideranças deve preservar múltiplos vínculos.');
assert.ok(peopleCells.includes('cell_supervisor_assignments'), 'O escopo organizacional de Supervisor deve ser considerado.');
assert.ok(peopleCells.includes('assertCellLinksAreValid'), 'O vínculo entre Supervisor e ministério deve ser validado antes da gravação.');
assert.ok(peopleCells.includes("validationError('Selecione uma pessoa vinculada como Supervisora ao mesmo ministério.')"), 'O conflito de Supervisor deve retornar uma mensagem controlada.');
assert.ok(welcome.includes('string_agg(people.full_name'), 'Encaminhamentos devem suportar múltiplas lideranças sem duplicar células.');
assert.ok(app.includes("'teams'"), 'A área Equipes deve estar presente no frontend.');
assert.ok(app.includes('personPicker'), 'A seleção de pessoas precisa suportar busca visual.');
assert.ok(app.includes("el.dataset.pickerMultiple === 'true'"), 'Seletores únicos não podem acumular pessoas.');
assert.ok(app.includes("Selecione o ministério da célula."), 'O formulário deve validar o ministério antes de enviar.');

console.log('Validação estática: estrutura organizacional e Equipes passaram.');

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile('supabase/migrations/20260919160000_add_organizational_teams.sql', 'utf8');
const teams = await readFile('src/server/postgres-teams.mjs', 'utf8');
const peopleCells = await readFile('src/server/postgres-people-cells.mjs', 'utf8');
const welcome = await readFile('src/server/postgres-welcome.mjs', 'utf8');
const app = await readFile('src/app.js', 'utf8');
const styles = await readFile('src/styles.css', 'utf8');
const server = await readFile('server.mjs', 'utf8');

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
assert.ok(app.includes('class="choice-card'), 'O seletor de Ministério deve usar cards próprios.');
assert.ok(app.includes('class="weekday-choice'), 'O seletor de dia deve usar segmentos próprios.');
assert.ok(app.includes('class="admin-form supervisor-form"'), 'O modal de Supervisor precisa usar o design system administrativo.');
assert.ok(app.includes('class="structured-form welcome-team-form"'), 'O modal de Boas-Vindas precisa usar o mesmo contexto visual estruturado.');
assert.ok(app.includes('class="person-picker-copy"'), 'O card de pessoa precisa separar nome e informação secundária.');
assert.ok(app.includes('class="person-picker-check"'), 'A seleção de pessoa precisa ter indicação visual própria.');
assert.ok(app.includes('data-supervisor-summary'), 'O modal precisa mostrar confirmação antes de vincular o Supervisor.');
assert.ok(app.includes('Buscar pessoa pelo nome, telefone ou e-mail...'), 'A busca de Supervisor precisa abranger os identificadores permitidos.');
assert.ok(app.includes('aria-pressed="${isSelected}"'), 'Controles segmentados precisam expor o estado de seleção.');
assert.ok(styles.includes('.modal .cell-form .choice-card'), 'Cards de Ministério precisam sobrescrever a aparência nativa.');
assert.ok(styles.includes('.modal .cell-form .weekday-choice'), 'Segmentos de dia precisam sobrescrever a aparência nativa.');
assert.ok(styles.includes('.modal .structured-form .choice-card'), 'O modal de Supervisor precisa ter estilo escuro específico para Ministério.');
assert.ok(styles.includes('.modal .structured-form .person-picker-option'), 'Os cards de pessoa precisam ter estilo escuro específico nos modais.');
assert.ok(styles.includes('.admin-modal'), 'O design system precisa definir uma superfície administrativa própria.');
assert.ok(styles.includes('.admin-form .choice-card'), 'Cards de Ministério precisam ter estilo próprio no modal administrativo.');
assert.ok(styles.includes('.admin-form .person-picker-option'), 'Resultados de pessoa precisam ter estilo próprio no modal administrativo.');
assert.ok(styles.includes('.admin-selection-summary'), 'A confirmação do Supervisor precisa ter apresentação visual própria.');
assert.ok(styles.includes('.person-picker-copy strong'), 'Nome e telefone precisam permanecer em blocos separados.');
assert.ok(styles.includes('.modal select{appearance:none;-webkit-appearance:none'), 'Selects residuais dos modais não podem usar a aparência nativa clara.');
assert.ok(styles.includes('.modal .cell-form .choice-card:focus-visible'), 'Os seletores precisam manter foco visível por teclado.');
assert.ok(styles.startsWith('@charset "UTF-8";'), 'A folha de estilos deve declarar UTF-8.');
assert.ok(styles.includes('button{appearance:none;-webkit-appearance:none;cursor:pointer}'), 'Botões não podem herdar a aparência nativa do navegador.');
assert.ok(styles.includes('input[type="checkbox"]{accent-color:var(--accent)}'), 'Checkboxes devem seguir a cor de destaque do aplicativo.');
assert.ok(server.includes("'Cache-Control': 'no-cache'"), 'Assets estáticos precisam revalidar após um deploy.');
assert.ok(server.includes("'text/css; charset=utf-8'"), 'A folha de estilos deve ser enviada em UTF-8.');
assert.ok(server.includes("'text/javascript; charset=utf-8'"), 'O módulo do frontend deve ser enviado em UTF-8.');
assert.ok(!/(?:Ã[\u0080-\u00BF]|Â[\u0080-\u00BF]|�)/u.test(app), 'O frontend não pode conter texto corrompido.');

console.log('Validação estática: estrutura organizacional e Equipes passaram.');

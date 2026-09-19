import { randomBytes, scryptSync } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { closePostgresPool, getPostgresPool, isPostgresConfigured } from '../src/server/postgres.mjs';

class BootstrapValidationError extends Error {}

function ask(question) {
  const readline = createInterface({ input, output });
  return readline.question(question).finally(() => readline.close());
}

function askHidden(question) {
  if (!input.isTTY) throw new BootstrapValidationError('Este comando exige um terminal interativo para proteger a senha.');
  output.write(question);
  input.setRawMode(true);
  input.resume();
  input.setEncoding('utf8');

  return new Promise((resolve, reject) => {
    let value = '';
    const finish = () => {
      input.setRawMode(false);
      input.pause();
      input.removeListener('data', onData);
      output.write('\n');
    };
    const onData = (character) => {
      if (character === '\u0003') {
        finish();
        reject(new BootstrapValidationError('Operação cancelada.'));
      } else if (character === '\r' || character === '\n') {
        finish();
        resolve(value);
      } else if (character === '\u0008' || character === '\u007f') {
        value = value.slice(0, -1);
      } else {
        value += character;
      }
    };
    input.on('data', onData);
  });
}

function normalizeName(name) {
  const normalized = String(name || '').trim();
  if (!normalized || normalized.length > 120) throw new BootstrapValidationError('Nome completo inválido.');
  return normalized;
}

function normalizeEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new BootstrapValidationError('E-mail inválido.');
  return normalized;
}

function normalizeWhatsApp(whatsapp) {
  const normalized = String(whatsapp || '').replace(/\D/g, '');
  if (normalized.length < 10 || normalized.length > 13) throw new BootstrapValidationError('WhatsApp inválido.');
  return normalized;
}

function validatePassword(password, confirmation) {
  if (password !== confirmation) throw new BootstrapValidationError('As senhas não coincidem.');
  if (typeof password !== 'string' || password.length < 10 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    throw new BootstrapValidationError('A senha não atende à política mínima de segurança.');
  }
}

function hashPassword(password, salt) {
  return scryptSync(password, salt, 64).toString('hex');
}

async function createInitialPostgresAdmin({ name, email, whatsapp, password, passwordConfirmation }) {
  if (!isPostgresConfigured()) throw new BootstrapValidationError('DATABASE_URL não está configurada para este ambiente local.');
  const normalizedName = normalizeName(name);
  const normalizedEmail = normalizeEmail(email);
  const normalizedWhatsApp = normalizeWhatsApp(whatsapp);
  validatePassword(password, passwordConfirmation);

  const client = await getPostgresPool().connect();
  try {
    await client.query('begin isolation level serializable');
    // Serializa exclusivamente o bootstrap inicial, sem expor token ou senha.
    await client.query("select pg_advisory_xact_lock(hashtext('cem-connect:first-postgres-admin'))");

    const existingAdmin = await client.query(
      "select 1 from public.user_roles where role_code = 'admin' limit 1"
    );
    if (existingAdmin.rowCount) {
      throw new BootstrapValidationError('Já existe um Administrador. Use a Administração do sistema para criar novos acessos.');
    }

    const existingPerson = await client.query(
      'select 1 from public.people where email = $1 or whatsapp = $2 limit 1',
      [normalizedEmail, normalizedWhatsApp]
    );
    if (existingPerson.rowCount) throw new BootstrapValidationError('Já existe uma pessoa com este e-mail ou WhatsApp.');

    const role = await client.query("select 1 from public.roles where code = 'admin'");
    if (!role.rowCount) throw new BootstrapValidationError('O papel estrutural de Administrador não está disponível no banco.');

    const person = await client.query(
      'insert into public.people (full_name, email, whatsapp) values ($1, $2, $3) returning id',
      [normalizedName, normalizedEmail, normalizedWhatsApp]
    );
    const salt = randomBytes(16).toString('hex');
    const user = await client.query(
      'insert into public.app_users (person_id, password_hash, password_salt, is_active) values ($1, $2, $3, true) returning id',
      [person.rows[0].id, hashPassword(password, salt), salt]
    );
    await client.query(
      "insert into public.user_roles (user_id, role_code) values ($1, 'admin')",
      [user.rows[0].id]
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => {});
    if (error instanceof BootstrapValidationError) throw error;
    throw new Error('Não foi possível criar o primeiro Administrador PostgreSQL. Nenhuma alteração foi concluída.');
  } finally {
    client.release();
  }
}

try {
  output.write('\nInicialização do primeiro Administrador PostgreSQL do CEM CONNECT\n\n');
  const name = await ask('Nome completo: ');
  const email = await ask('E-mail: ');
  const whatsapp = await ask('WhatsApp: ');
  const password = await askHidden('Senha: ');
  const confirmation = await askHidden('Confirme a senha: ');
  await createInitialPostgresAdmin({ name, email, whatsapp, password, passwordConfirmation: confirmation });
  output.write('Primeiro Administrador PostgreSQL criado com sucesso.\n');
} catch (error) {
  output.write(`Não foi possível criar o primeiro Administrador PostgreSQL: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  await closePostgresPool().catch(() => {});
}

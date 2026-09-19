import assert from 'node:assert/strict';
import { actorFromPostgresSession, authenticatePostgres, passwordHash, postgresBootstrap, revokePostgresSession, verifyPassword } from '../src/server/postgres-auth.mjs';

const salt = '0123456789abcdef0123456789abcdef';
const hash = passwordHash('SenhaDeTeste#123', salt);
assert.equal(hash.length, 128, 'O hash scrypt deve ter 64 bytes em hexadecimal.');
assert.equal(verifyPassword('SenhaDeTeste#123', hash, salt), true, 'A senha válida deve ser reconhecida.');
assert.equal(verifyPassword('SenhaIncorreta#123', hash, salt), false, 'A senha inválida deve ser rejeitada.');

const bootstrap = postgresBootstrap({
  source: 'postgres', userId: '00000000-0000-4000-8000-000000000001', personId: '00000000-0000-4000-8000-000000000002',
  name: 'Usuário de teste', email: 'teste@example.invalid', whatsapp: '5511999999999', roles: ['leader', 'supervisor']
});
assert.deepEqual(bootstrap.currentUser.roles, ['leader', 'supervisor'], 'Múltiplos papéis devem permanecer distintos na sessão.');
assert.equal(bootstrap.administration, null, 'O bootstrap PostgreSQL não pode reutilizar a identidade SQLite.');

if (process.env.DATABASE_URL) {
  assert.equal(await authenticatePostgres('nao-existe@example.invalid', 'SenhaIncorreta#123'), null, 'Credencial inexistente deve retornar resposta neutra.');
  assert.equal(await actorFromPostgresSession('token-sqlite-antigo-nao-valido'), null, 'Uma sessão SQLite antiga não pode ser aceita no PostgreSQL.');
  await revokePostgresSession('token-inexistente-de-teste');
}

console.log('Verificação concluída: autenticação PostgreSQL usa scrypt, sessões isoladas e bootstrap sem identidade SQLite.');

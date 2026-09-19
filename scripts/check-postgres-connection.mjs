import { checkPostgresConnection, closePostgresPool, isPostgresConfigured, PostgresNotConfiguredError } from '../src/server/postgres.mjs';

if (!isPostgresConfigured()) {
  console.log('DATABASE_URL não configurada; diagnóstico PostgreSQL não executado. O SQLite continua sendo a persistência ativa.');
  process.exit(0);
}

try {
  const result = await checkPostgresConnection();
  if (result.missingTables.length) {
    console.error(`Conectado ao PostgreSQL, mas faltam tabelas essenciais: ${result.missingTables.join(', ')}.`);
    process.exitCode = 1;
  } else {
    console.log(`Conexão PostgreSQL verificada: banco=${result.database}; usuário=${result.user}.`);
    console.log(`Tabelas confirmadas: ${result.foundTables.join(', ')}.`);
  }
} catch (error) {
  if (error instanceof PostgresNotConfiguredError) {
    console.log('DATABASE_URL não configurada; diagnóstico PostgreSQL não executado. O SQLite continua sendo a persistência ativa.');
  } else {
    console.error('Não foi possível verificar a conexão PostgreSQL. Confira a configuração do ambiente sem expor credenciais.');
    process.exitCode = 1;
  }
} finally {
  await closePostgresPool();
}

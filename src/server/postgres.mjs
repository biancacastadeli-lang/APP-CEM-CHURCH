import pg from 'pg';

const { Pool } = pg;
const requiredTables = ['people', 'cells', 'app_users', 'visitors', 'cell_meetings', 'meeting_offerings', 'annual_themes', 'church_branding'];
let pool;

export class PostgresNotConfiguredError extends Error {
  constructor() {
    super('DATABASE_URL não está configurada.');
    this.name = 'PostgresNotConfiguredError';
  }
}

export function isPostgresConfigured() {
  return typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL.trim().length > 0;
}

export function getPostgresPool() {
  if (!isPostgresConfigured()) throw new PostgresNotConfiguredError();
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: process.env.NODE_ENV === 'production' ? 10 : 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000
    });
    pool.on('error', () => {
      console.error('O pool PostgreSQL encontrou um erro de conexão ociosa.');
    });
  }
  return pool;
}

export async function checkPostgresConnection() {
  const client = await getPostgresPool().connect();
  try {
    const identity = await client.query('select current_database() as database, current_user as user');
    const tables = await client.query(
      `select table_name
         from information_schema.tables
        where table_schema = 'public'
          and table_name = any($1::text[])
        order by table_name`,
      [requiredTables]
    );
    const foundTables = tables.rows.map((row) => row.table_name);
    return {
      database: identity.rows[0].database,
      user: identity.rows[0].user,
      foundTables,
      missingTables: requiredTables.filter((table) => !foundTables.includes(table))
    };
  } finally {
    client.release();
  }
}

export async function closePostgresPool() {
  if (pool) {
    const currentPool = pool;
    pool = undefined;
    await currentPool.end();
  }
}

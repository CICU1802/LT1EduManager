import pg from 'pg';
import { readFile } from 'node:fs/promises';

export function createDatabase(connectionString = process.env.DATABASE_URL) {
 if (!connectionString) return null;
 const pool = new pg.Pool({ connectionString, max: Number(process.env.DB_POOL_SIZE || 8), connectionTimeoutMillis: 10000 });
 pool.on('error', error => console.error('Database pool error:', error.code || 'connection error'));
 return {
  query: (sql, values) => pool.query(sql, values),
  async transaction(fn) {
   const client = await pool.connect();
   try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
   catch (error) { await client.query('ROLLBACK'); throw error; }
   finally { client.release(); }
  },
  close: () => pool.end()
 };
}
export async function migrate(database) {
 await database.transaction(client => client.query('SELECT pg_advisory_xact_lock(18022627)').then(() =>
  readFile(new URL('./schema.sql', import.meta.url), 'utf8').then(sql => client.query(sql))));
}

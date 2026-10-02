import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Client } from 'pg';

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL']?.trim();
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error('DATABASE_URL must be configured before Lists migrations can run.');
  }

  const migrationName = '001_loops.sql';
  const migrationSql = await readFile(join(__dirname, 'migrations', migrationName), 'utf8');
  const client = new Client({ connectionString: databaseUrl });

  try {
    await client.connect();
    await client.query('BEGIN');
    await client.query(
      `CREATE TABLE IF NOT EXISTS lists_schema_migrations (
        name VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
    );
    const applied = await client.query<{ readonly name: string }>(
      'SELECT name FROM lists_schema_migrations WHERE name = $1',
      [migrationName]
    );
    if (applied.rowCount === 0) {
      await client.query(migrationSql);
      await client.query('INSERT INTO lists_schema_migrations (name) VALUES ($1)', [migrationName]);
      process.stdout.write(`Applied ${migrationName}\n`);
    } else {
      process.stdout.write(`${migrationName} already applied\n`);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

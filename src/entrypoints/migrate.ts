import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Client } from 'pg';

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL']?.trim();
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error('DATABASE_URL must be configured before Lists migrations can run.');
  }

  const migrations = [
    '001_loops.sql',
    '002_lists_tags.sql',
    '003_loop_seed_identity.sql',
    '004_loop_comments.sql',
    '005_loop_asset_references.sql'
  ];
  const client = new Client({ connectionString: databaseUrl });

  try {
    await client.connect();
    await client.query(
      `CREATE TABLE IF NOT EXISTS lists_schema_migrations (
        name VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
    );
    for (const migrationName of migrations) {
      const applied = await client.query<{ readonly name: string }>(
        'SELECT name FROM lists_schema_migrations WHERE name = $1',
        [migrationName]
      );
      if (applied.rowCount !== 0) {
        process.stdout.write(`${migrationName} already applied\n`);
        continue;
      }
      const migrationSql = await readFile(join(__dirname, 'migrations', migrationName), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(migrationSql);
        await client.query('INSERT INTO lists_schema_migrations (name) VALUES ($1)', [
          migrationName
        ]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      process.stdout.write(`Applied ${migrationName}\n`);
    }
  } finally {
    await client.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

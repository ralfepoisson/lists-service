import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Client } from 'pg';
import { validateAppliedMigration } from './migrationIntegrity.js';

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
    const locked = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock(1735254327) AS locked'
    );
    if (!locked.rows[0]?.locked) throw new Error('Another Lists migration is active.');
    await client.query(
      `CREATE TABLE IF NOT EXISTS lists_schema_migrations (
        name VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
    );
    await client.query(
      'ALTER TABLE lists_schema_migrations ADD COLUMN IF NOT EXISTS sha256 CHAR(64)'
    );
    for (const migrationName of migrations) {
      const migrationSql = await readFile(join(__dirname, 'migrations', migrationName), 'utf8');
      const checksum = createHash('sha256').update(migrationSql).digest('hex');
      const applied = await client.query<{ readonly name: string; readonly sha256: string | null }>(
        'SELECT name, sha256 FROM lists_schema_migrations WHERE name = $1',
        [migrationName]
      );
      if (applied.rowCount !== 0) {
        const row = applied.rows[0]!;
        validateAppliedMigration(migrationName, row.sha256, checksum);
        if (row.sha256 === null) {
          await client.query(
            'UPDATE lists_schema_migrations SET sha256 = $2 WHERE name = $1 AND sha256 IS NULL',
            [migrationName, checksum]
          );
        }
        process.stdout.write(`${migrationName} already applied\n`);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(migrationSql);
        await client.query('INSERT INTO lists_schema_migrations (name, sha256) VALUES ($1, $2)', [
          migrationName,
          checksum
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

void main().catch(() => {
  console.error('Lists migration failed; source or database integrity gate rejected.');
  process.exitCode = 1;
});

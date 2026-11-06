/** Real maintained CLI against an owned pre007 PostgreSQL schema, never canonical tables. */
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

const explicitDsn = process.env['CALENDAR_LOOP_TEST_DSN'];
if (explicitDsn) {
  const target = new URL(explicitDsn);
  if (
    target.hostname !== '127.0.0.1' ||
    target.username !== 'lists_test' ||
    target.pathname !== '/postgres' ||
    !target.port ||
    target.port === '5432'
  )
    throw new Error('Calendar release tests require their owned loopback PostgreSQL fixture.');
}
const ownedPool = (): Pool =>
  new Pool(
    explicitDsn ? { connectionString: explicitDsn } : { host: '/tmp', database: 'postgres' }
  );

const enabled = process.env['CALENDAR_LOOP_TEST_PG'] === 'local-disposable-schema';
describe.skipIf(!enabled)('Calendar migration production entrypoint', () => {
  it('registers007 through the actual bundled CLI, preserving legacy data and checksums on repeat', async () => {
    const schema = `calendar_loop_cli_${randomUUID().replaceAll('-', '')}`;
    const admin = ownedPool();
    const folder = await mkdtemp(join(tmpdir(), 'calendar-loop-cli-'));
    let created = false;
    try {
      await admin.query(`CREATE SCHEMA ${schema}`);
      created = true;
      const names = (await readdir('migrations')).filter((name) => name.endsWith('.sql')).sort();
      const legacy = names.filter((name) => /^00[1-6]_/.test(name));
      const added = names.find((name) => name.startsWith('007_'))!;
      expect(legacy).toHaveLength(6);
      expect(added).toBeDefined();
      const client = await admin.connect();
      const id = randomUUID();
      let beforeLoop;
      let beforeRefs;
      let beforeMigrations;
      try {
        await client.query(`SET search_path TO ${schema}`);
        await client.query(`CREATE TABLE lists_schema_migrations (
          name VARCHAR(255) PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),sha256 CHAR(64))`);
        for (const name of legacy) {
          const source = await readFile(join('migrations', name), 'utf8');
          await client.query(source);
          await client.query('INSERT INTO lists_schema_migrations(name,sha256) VALUES($1,$2)', [
            name,
            createHash('sha256').update(source).digest('hex')
          ]);
        }
        await client.query(
          `INSERT INTO loops(id,account_id,title,priority,outcome,status,
          created_by_sub,updated_by_sub,created_at,updated_at)
          VALUES($1,'UNIT-account','UNIT preserved Loop','medium','UNIT outcome','open',
                 'UNIT-user','UNIT-user',now(),now())`,
          [id]
        );
        await client.query(
          `INSERT INTO loop_related_records(loop_id,record_kind,record_id,label,ordinal)
          VALUES($1,'document','UNIT-record','UNIT original label',0)`,
          [id]
        );
        beforeLoop = (await client.query('SELECT to_jsonb(l) AS value FROM loops l')).rows;
        beforeRefs = (await client.query('SELECT to_jsonb(r) AS value FROM loop_related_records r'))
          .rows;
        beforeMigrations = (
          await client.query('SELECT * FROM lists_schema_migrations ORDER BY name')
        ).rows;
      } finally {
        client.release();
      }
      const executable = join(folder, 'migrate.cjs');
      await build({
        entryPoints: ['src/entrypoints/migrate.ts'],
        outfile: executable,
        bundle: true,
        platform: 'node',
        target: 'node24',
        format: 'cjs',
        logLevel: 'silent'
      });
      await cp('migrations', join(folder, 'migrations'), { recursive: true });
      const url = new URL(explicitDsn ?? 'postgresql:///postgres');
      if (!explicitDsn) url.searchParams.set('host', '/tmp');
      url.searchParams.set('options', `-c search_path=${schema}`);
      const run = (): string =>
        execFileSync(process.execPath, [executable], {
          env: { ...process.env, DATABASE_URL: url.toString() },
          encoding: 'utf8',
          timeout: 20000
        });
      run();
      const version = await admin.query(`SELECT version FROM ${schema}.loops WHERE id=$1`, [id]);
      expect(version.rows).toEqual([{ version: 1 }]);
      expect(
        (await admin.query(`SELECT to_jsonb(l)-'version' AS value FROM ${schema}.loops l`)).rows
      ).toEqual(beforeLoop);
      expect(
        (await admin.query(`SELECT to_jsonb(r) AS value FROM ${schema}.loop_related_records r`))
          .rows
      ).toEqual(beforeRefs);
      expect(
        (
          await admin.query(
            `SELECT * FROM ${schema}.lists_schema_migrations WHERE name<>$1 ORDER BY name`,
            [added]
          )
        ).rows
      ).toEqual(beforeMigrations);
      expect(
        (
          await admin.query(`SELECT sha256 FROM ${schema}.lists_schema_migrations WHERE name=$1`, [
            added
          ])
        ).rows
      ).toEqual([
        {
          sha256: createHash('sha256')
            .update(await readFile(join('migrations', added)))
            .digest('hex')
        }
      ]);
      const allBeforeRepeat = (
        await admin.query(`SELECT * FROM ${schema}.lists_schema_migrations ORDER BY name`)
      ).rows;
      run();
      expect(
        (await admin.query(`SELECT * FROM ${schema}.lists_schema_migrations ORDER BY name`)).rows
      ).toEqual(allBeforeRepeat);
      expect(
        (await admin.query(`SELECT count(*)::int AS count FROM ${schema}.loop_append_operations`))
          .rows
      ).toEqual([{ count: 0 }]);
    } finally {
      if (created) {
        await admin.query(`DROP SCHEMA ${schema} CASCADE`);
        expect(
          (
            await admin.query('SELECT 1 FROM information_schema.schemata WHERE schema_name=$1', [
              schema
            ])
          ).rowCount
        ).toBe(0);
      }
      await admin.end();
      await rm(folder, { recursive: true, force: true });
    }
  }, 60000);
});

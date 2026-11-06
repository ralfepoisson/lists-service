import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';
import { LoopService } from '../../src/application/LoopService.js';
import { PostgresLoopRepository } from '../../src/adapters/postgres/PostgresLoopRepository.js';
import { Loop, type CalendarReferenceAppend } from '../../src/domain/Loop.js';

type Context = {
  repository: PostgresLoopRepository;
  service: LoopService;
  admin: Pool;
  schema: string;
  application: string;
};
async function isolated(work: (context: Context) => Promise<void>, legacy = false): Promise<void> {
  const schema = `calendar_loop_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ host: '/tmp', database: 'postgres' });
  let created = false;
  let repository: PostgresLoopRepository | undefined;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    created = true;
    const client = await admin.connect();
    try {
      await client.query(`SET search_path TO ${schema}`);
      for (const name of (await readdir('migrations'))
        .filter((x) => x.endsWith('.sql') && !(legacy && x.startsWith('007_')))
        .sort())
        await client.query(await readFile(`migrations/${name}`, 'utf8'));
    } finally {
      client.release();
    }
    const url = new URL('postgresql:///postgres');
    url.searchParams.set('host', '/tmp');
    url.searchParams.set('options', `-c search_path=${schema}`);
    url.searchParams.set('application_name', schema);
    repository = new PostgresLoopRepository(url.toString());
    await work({
      repository,
      service: new LoopService(repository),
      admin,
      schema,
      application: schema
    });
  } finally {
    if (repository) await repository.close();
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
  }
}
function append(
  eventId: string = randomUUID(),
  operationId: string = randomUUID()
): CalendarReferenceAppend {
  return {
    eventId,
    operationId,
    record: { kind: 'appointment', recordId: `calendar:${eventId}`, label: 'Calendar event' }
  };
}
async function waitLocks(context: Context, count: number): Promise<void> {
  const until = Date.now() + 4000;
  while (Date.now() < until) {
    const result = await context.admin.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",
      [context.application]
    );
    if (result.rows[0]!.count >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('The real database writers did not reach the expected lock barrier.');
}
async function hold(context: Context, id: string): Promise<PoolClient> {
  const client = await context.admin.connect();
  await client.query('BEGIN');
  await client.query(`SELECT id FROM ${context.schema}.loops WHERE id=$1 FOR UPDATE`, [id]);
  return client;
}
function observed<T>(work: Promise<T>): Promise<{ value: T } | { error: unknown }> {
  return work.then(
    (value) => ({ value }),
    (error) => ({ error })
  );
}

describe.skipIf(process.env['CALENDAR_LOOP_TEST_PG'] !== 'local-disposable-schema')(
  'Loop mutation real PostgreSQL',
  () => {
    it('persists integer freshness, rejects foreign owners and makes identical scalar updates no-ops', async () =>
      isolated(async (c) => {
        const loop = await c.service.create('owner', 'author', {
          title: 'Fixture',
          outcome: 'Done'
        });
        expect((await c.repository.findById('owner', loop.id))?.version).toBe(1);
        await expect(
          c.service.update('foreign', 'other', loop.id, { title: 'Hidden' })
        ).rejects.toMatchObject({ httpStatus: 404 });
        await expect(
          c.service.appendReference('foreign', 'other', loop.id, append())
        ).rejects.toMatchObject({ httpStatus: 404 });
        expect(
          (await c.service.update('owner', 'other', loop.id, { title: 'Fixture' })).version
        ).toBe(1);
        expect(
          (
            await c.admin.query(
              `SELECT count(*)::int AS count FROM ${c.schema}.loop_append_operations`
            )
          ).rows[0].count
        ).toBe(0);
      }));

    it('serializes append followed by metadata patch and rejects a legacy stale snapshot save', async () =>
      isolated(async (c) => {
        const loop = await c.service.create('owner', 'author', {
            title: 'Before',
            outcome: 'Done'
          }),
          input = append();
        const barrier = await hold(c, loop.id);
        try {
          const first = observed(c.service.appendReference('owner', 'agent', loop.id, input));
          await waitLocks(c, 1);
          const second = observed(c.service.update('owner', 'human', loop.id, { title: 'After' }));
          await waitLocks(c, 2);
          await barrier.query('COMMIT');
          expect(await first).toHaveProperty('value');
          expect(await second).toHaveProperty('value');
        } finally {
          await barrier.query('ROLLBACK');
          barrier.release();
        }
        const current = await c.service.get('owner', loop.id);
        expect(current.title).toBe('After');
        expect(current.relatedRecords).toEqual([input.record]);
        expect(current.version).toBe(3);
        await expect(
          c.repository.save(new Loop({ ...loop, title: 'Stale' }))
        ).rejects.toMatchObject({ httpStatus: 409 });
        expect((await c.service.get('owner', loop.id)).version).toBe(3);
      }));

    it.each(['append-first', 'close-first'])(
      'locks closure and append in both actual wait orders: %s',
      async (order) =>
        isolated(async (c) => {
          const loop = await c.service.create('owner', 'author', {
              title: 'Fixture',
              outcome: 'Done'
            }),
            input = append();
          const barrier = await hold(c, loop.id);
          try {
            const first = observed<unknown>(
              order === 'append-first'
                ? c.service.appendReference('owner', 'agent', loop.id, input)
                : c.service.close('owner', 'human', loop.id, true)
            );
            await waitLocks(c, 1);
            const second = observed<unknown>(
              order === 'append-first'
                ? c.service.close('owner', 'human', loop.id, true)
                : c.service.appendReference('owner', 'agent', loop.id, input)
            );
            await waitLocks(c, 2);
            await barrier.query('COMMIT');
            const one = await first,
              two = await second;
            expect(one).toHaveProperty('value');
            if (order === 'close-first') expect(two).toMatchObject({ error: { httpStatus: 409 } });
            else expect(two).toHaveProperty('value');
          } finally {
            await barrier.query('ROLLBACK');
            barrier.release();
          }
          const current = await c.service.get('owner', loop.id);
          expect(current.status).toBe('closed');
          expect(current.relatedRecords).toEqual(order === 'append-first' ? [input.record] : []);
          expect(current.version).toBe(order === 'append-first' ? 3 : 2);
          expect((await c.service.close('owner', 'human', loop.id, true)).version).toBe(
            current.version
          );
        })
    );

    it('serializes distinct appends and disjoint metadata patches without dropping any field', async () =>
      isolated(async (c) => {
        const loop = await c.service.create('owner', 'author', {
            title: 'Before',
            outcome: 'Done'
          }),
          one = append(),
          two = append();
        const barrier = await hold(c, loop.id);
        try {
          const a = observed(c.service.appendReference('owner', 'agent', loop.id, one));
          await waitLocks(c, 1);
          const b = observed(c.service.appendReference('owner', 'agent', loop.id, two));
          await waitLocks(c, 2);
          const d = observed(c.service.update('owner', 'human', loop.id, { title: 'Title' }));
          await waitLocks(c, 3);
          const e = observed(c.service.update('owner', 'human', loop.id, { outcome: 'Outcome' }));
          await waitLocks(c, 4);
          await barrier.query('COMMIT');
          for (const value of await Promise.all([a, b, d, e]))
            expect(value).toHaveProperty('value');
        } finally {
          await barrier.query('ROLLBACK');
          barrier.release();
        }
        const current = await c.service.get('owner', loop.id);
        expect(current.relatedRecords).toEqual([one.record, two.record]);
        expect(current).toMatchObject({ title: 'Title', outcome: 'Outcome', version: 5 });
      }));

    it('receipts prevent retry after explicit human unlink and retain immutable binding after closure', async () =>
      isolated(async (c) => {
        const loop = await c.service.create('owner', 'author', {
            title: 'Fixture',
            outcome: 'Done'
          }),
          input = append();
        const first = await c.service.appendReference('owner', 'agent', loop.id, input);
        expect(first).toMatchObject({
          appended: true,
          replayed: false,
          referencePresent: true,
          appliedVersion: 2
        });
        const duplicate = await c.service.appendReference(
          'owner',
          'agent',
          loop.id,
          append(input.eventId)
        );
        expect(duplicate).toMatchObject({ appended: false, replayed: false, appliedVersion: 2 });
        expect(duplicate.loop.version).toBe(2);
        await expect(
          c.service.update('owner', 'human', loop.id, { relatedRecords: [] })
        ).rejects.toMatchObject({ httpStatus: 400 });
        await expect(
          c.service.update('owner', 'human', loop.id, { relatedRecords: [], expectedVersion: 1 })
        ).rejects.toMatchObject({ httpStatus: 409 });
        const unlinked = await c.service.update('owner', 'human', loop.id, {
          relatedRecords: [],
          expectedVersion: 2
        });
        expect(unlinked.version).toBe(3);
        const replay = await c.service.appendReference('owner', 'agent', loop.id, input);
        expect(replay).toMatchObject({
          appended: false,
          replayed: true,
          referencePresent: false,
          appliedVersion: 2
        });
        expect(replay.loop.version).toBe(3);
        await c.service.close('owner', 'human', loop.id, true);
        const closed = await c.service.appendReference('owner', 'agent', loop.id, input);
        expect(closed.referencePresent).toBe(false);
        expect(closed.appliedVersion).toBe(2);
        expect(closed.loop.version).toBe(4);
        await expect(
          c.service.appendReference(
            'owner',
            'agent',
            loop.id,
            append(randomUUID(), input.operationId)
          )
        ).rejects.toMatchObject({ httpStatus: 409 });
        const other = await c.service.create('owner', 'author', {
          title: 'Another',
          outcome: 'Done'
        });
        await expect(
          c.service.appendReference('owner', 'agent', other.id, input)
        ).rejects.toMatchObject({ httpStatus: 409 });
        const before = await c.admin.query(
          `SELECT * FROM ${c.schema}.loop_append_operations ORDER BY operation_id`
        );
        const client = await c.admin.connect();
        try {
          await client.query(`SET search_path TO ${c.schema}`);
          await client.query(await readFile('migrations/007_loop_mutation_versions.sql', 'utf8'));
        } finally {
          client.release();
        }
        expect(
          (
            await c.admin.query(
              `SELECT * FROM ${c.schema}.loop_append_operations ORDER BY operation_id`
            )
          ).rows
        ).toEqual(before.rows);
      }));

    it('bumps versions for actual seeded-reference and comment mutations while preserving seed scalars', async () =>
      isolated(async (c) => {
        const original = await c.service.createSeeded('owner', 'author', {
          seedKey: 'seed',
          title: 'Keep title',
          description: 'Keep details',
          outcome: 'Done'
        });
        expect(original.loop.version).toBe(1);
        const input = {
          seedKey: 'seed',
          title: 'Do not replace',
          description: 'Do not replace',
          outcome: 'Different',
          relatedRecords: [{ kind: 'task' as const, recordId: 'task', label: 'Task' }]
        };
        const added = await c.service.createSeeded('owner', 'agent', input);
        expect(added.loop).toMatchObject({
          version: 2,
          title: 'Keep title',
          description: 'Keep details'
        });
        expect((await c.service.createSeeded('owner', 'agent', input)).loop.version).toBe(2);
        await c.service.addComment('owner', 'author', original.loop.id, 'A bounded comment');
        expect((await c.service.get('owner', original.loop.id)).version).toBe(3);
        await c.service.close('owner', 'author', original.loop.id, true);
        await expect(
          c.service.createSeeded('owner', 'agent', {
            ...input,
            relatedRecords: [{ kind: 'task', recordId: 'new', label: 'New' }]
          })
        ).rejects.toMatchObject({ httpStatus: 409 });
      }));
    it('serializes identical operation retries and rejects replacement made stale while waiting', async () =>
      isolated(async (c) => {
        const loop = await c.service.create('owner', 'author', {
            title: 'Fixture',
            outcome: 'Done'
          }),
          input = append();
        const barrier = await hold(c, loop.id);
        try {
          const one = observed(c.service.appendReference('owner', 'agent', loop.id, input));
          await waitLocks(c, 1);
          const two = observed(c.service.appendReference('owner', 'agent', loop.id, input));
          await waitLocks(c, 2);
          const replace = observed(
            c.service.update('owner', 'human', loop.id, { relatedRecords: [], expectedVersion: 1 })
          );
          await waitLocks(c, 3);
          await barrier.query('COMMIT');
          expect(await one).toMatchObject({ value: { appended: true, appliedVersion: 2 } });
          expect(await two).toMatchObject({
            value: { appended: false, replayed: true, appliedVersion: 2 }
          });
          expect(await replace).toMatchObject({ error: { httpStatus: 409 } });
        } finally {
          await barrier.query('ROLLBACK');
          barrier.release();
        }
        const current = await c.service.get('owner', loop.id);
        expect(current.relatedRecords).toEqual([input.record]);
        expect(current.version).toBe(2);
        expect(
          (
            await c.admin.query(
              `SELECT count(*)::int AS count FROM ${c.schema}.loop_append_operations`
            )
          ).rows[0].count
        ).toBe(1);
      }));

    it('backfills version1 without changing prior rows or references and migration replay is harmless', async () =>
      isolated(async (c) => {
        const id = randomUUID();
        await c.admin.query(
          `INSERT INTO ${c.schema}.loops(id,account_id,title,outcome,status,created_by_sub,updated_by_sub,created_at,updated_at) VALUES($1,'owner','Preserved','Done','open','author','author',now(),now())`,
          [id]
        );
        await c.admin.query(
          `INSERT INTO ${c.schema}.loop_related_records(loop_id,record_kind,record_id,label,ordinal) VALUES($1,'task','task','Task',0)`,
          [id]
        );
        const before = (
          await c.admin.query(`SELECT row_to_json(l) AS row FROM ${c.schema}.loops l WHERE id=$1`, [
            id
          ])
        ).rows[0].row as Record<string, unknown>;
        expect(before['version']).toBeUndefined();
        const client = await c.admin.connect();
        try {
          await client.query(`SET search_path TO ${c.schema}`);
          const sql = await readFile('migrations/007_loop_mutation_versions.sql', 'utf8');
          await client.query(sql);
          await client.query(sql);
        } finally {
          client.release();
        }
        const after = (
          await c.admin.query(`SELECT row_to_json(l) AS row FROM ${c.schema}.loops l WHERE id=$1`, [
            id
          ])
        ).rows[0].row as Record<string, unknown>;
        expect(after['version']).toBe(1);
        delete after['version'];
        expect(after).toEqual(before);
        const loop = await c.service.get('owner', id);
        expect(loop.version).toBe(1);
        expect(loop.relatedRecords).toEqual([{ kind: 'task', recordId: 'task', label: 'Task' }]);
      }, true));
    it('checks first-append freshness after a blocked metadata change, but replays old intent after human unlink', async () =>
      isolated(async (c) => {
        const loop = await c.service.create('owner', 'author', {
          title: 'Before',
          outcome: 'Done'
        });
        const input = { ...append(), expectedVersion: 1 };
        const barrier = await hold(c, loop.id);
        try {
          const human = observed(
            c.service.update('owner', 'human', loop.id, { title: 'New meaning' })
          );
          await waitLocks(c, 1);
          const agent = observed(c.service.appendReference('owner', 'agent', loop.id, input));
          await waitLocks(c, 2);
          await barrier.query('COMMIT');
          expect(await human).toHaveProperty('value');
          expect(await agent).toMatchObject({ error: { httpStatus: 409 } });
        } finally {
          await barrier.query('ROLLBACK');
          barrier.release();
        }
        expect((await c.service.get('owner', loop.id)).relatedRecords).toEqual([]);
        expect(
          (
            await c.admin.query(
              `SELECT count(*)::int AS count FROM ${c.schema}.loop_append_operations`
            )
          ).rows[0].count
        ).toBe(0);
        const current = await c.service.get('owner', loop.id),
          fresh = { ...input, expectedVersion: current.version };
        const applied = await c.service.appendReference('owner', 'agent', loop.id, fresh);
        expect(applied.appliedVersion).toBe(3);
        await c.service.update('owner', 'human', loop.id, {
          relatedRecords: [],
          expectedVersion: 3
        });
        await c.service.close('owner', 'human', loop.id, true);
        const replay = await c.service.appendReference('owner', 'agent', loop.id, fresh);
        expect(replay).toMatchObject({
          appended: false,
          replayed: true,
          referencePresent: false,
          appliedVersion: 3
        });
        expect(replay.loop.version).toBe(5);
        const changedFence = await c.service.appendReference('owner', 'agent', loop.id, {
          ...fresh,
          expectedVersion: 999
        });
        expect(changedFence).toMatchObject({
          appended: false,
          replayed: true,
          referencePresent: false,
          appliedVersion: 3
        });
        expect(changedFence.loop.version).toBe(5);
      }));
    it('bounds literal owner-only Calendar Loop search in PostgreSQL before transport', async () =>
      isolated(async (c) => {
        for (const title of [
          'Calendar candidate 1',
          'Calendar candidate 2',
          'Calendar candidate 3',
          'Literal % source'
        ])
          await c.service.create('owner', 'author', { title, outcome: 'Fixture outcome' });
        await c.service.create('foreign', 'other', {
          title: 'Calendar candidate foreign',
          outcome: 'Foreign fixture'
        });
        const rows = await c.repository.list('owner', 'open', {
          query: 'Calendar candidate',
          limit: 2
        });
        expect(rows).toHaveLength(2);
        expect(rows.every((row) => row.accountId === 'owner')).toBe(true);
        expect(
          (await c.repository.list('owner', 'open', { query: '% source', limit: 5 })).map(
            (row) => row.title
          )
        ).toEqual(['Literal % source']);
        await expect(
          c.repository.list('owner', 'open', { query: 'Calendar', limit: 6 })
        ).rejects.toThrow();
      }));
  }
);

import { readFile } from 'node:fs/promises';
import { afterAll, describe, expect, it } from 'vitest';

import { PostgresLoopRepository } from '../../src/adapters/postgres/PostgresLoopRepository.js';
import { Loop, type RelatedRecord } from '../../src/domain/Loop.js';
import { LoopService } from '../../src/application/LoopService.js';
import { Pool } from 'pg';

const databaseUrl = process.env['LISTS_TEST_DATABASE_URL'];

describe.skipIf(!databaseUrl)('PostgresLoopRepository on disposable PostgreSQL', () => {
  const repository = new PostgresLoopRepository(databaseUrl ?? '');
  const createdAt = new Date('2026-10-02T12:00:00.000Z');
  const loop = (
    id: string,
    accountId: string,
    relatedRecords: readonly RelatedRecord[] = [
      { kind: 'entity' as const, recordId: 'entity-1', label: 'Household' },
      { kind: 'task' as const, recordId: 'task-1', label: 'Follow up' }
    ]
  ): Loop =>
    new Loop({
      id,
      accountId,
      title: 'Follow up',
      description: undefined,
      priority: 'high',
      outcome: 'The action happened',
      dueDate: '2026-10-15',
      status: 'open',
      relatedRecords,
      createdBySub: 'user-1',
      updatedBySub: 'user-1',
      createdAt,
      updatedAt: createdAt,
      closedAt: undefined
    });

  it('persists and updates typed asset references across connections without affecting source records', async () => {
    const id = 'd8a17e6a-3266-4ec9-8950-fc21f59c8295';
    const records: RelatedRecord[] = [
      { kind: 'asset', recordId: 'asset-1', label: 'Vehicle' },
      { kind: 'entity', recordId: 'entity-1', label: 'Garage' },
      { kind: 'document', recordId: 'document-1', label: 'Receipt' },
      { kind: 'task', recordId: 'task-1', label: 'Follow up' }
    ];
    await repository.create(loop(id, 'tenant-assets', records));
    const reader = new PostgresLoopRepository(databaseUrl!);
    try {
      expect((await reader.findById('tenant-assets', id))?.relatedRecords).toEqual(records);
      expect(await reader.findById('tenant-other', id)).toBeUndefined();
      await repository.save(loop(id, 'tenant-assets', records.slice(0, 1)));
      expect((await reader.findById('tenant-assets', id))?.relatedRecords).toEqual(
        records.slice(0, 1)
      );
    } finally {
      await reader.close();
    }
  });

  it('widens the existing CHECK without deleting references and safely replays migration SQL', async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('CREATE SCHEMA asset_upgrade_acceptance');
      await client.query('SET LOCAL search_path TO asset_upgrade_acceptance');
      await client.query(await readFile('migrations/001_loops.sql', 'utf8'));
      const id = 'd8a17e6a-3266-4ec9-8950-fc21f59c8296';
      await client.query(
        `INSERT INTO loops(id,account_id,title,outcome,status,created_by_sub,updated_by_sub,created_at,updated_at)
         VALUES($1,'tenant-upgrade','Existing Loop','Recorded','open','author','author',now(),now())`,
        [id]
      );
      await client.query(
        `INSERT INTO loop_related_records(loop_id,record_kind,record_id,label,ordinal)
         VALUES($1,'entity','entity-existing','Preserved entity',0)`,
        [id]
      );
      const migration = await readFile('migrations/005_loop_asset_references.sql', 'utf8');
      await client.query(migration);
      await client.query(migration);
      await client.query(
        `INSERT INTO loop_related_records(loop_id,record_kind,record_id,label,ordinal)
         VALUES($1,'asset','asset-new','Added asset',1)`,
        [id]
      );
      const result = await client.query(
        'SELECT record_kind FROM loop_related_records ORDER BY ordinal'
      );
      expect(result.rows).toEqual([{ record_kind: 'entity' }, { record_kind: 'asset' }]);
      await expect(
        client.query(
          `INSERT INTO loop_related_records(loop_id,record_kind,record_id,label,ordinal)
         VALUES($1,'unknown','invalid','Rejected',2)`,
          [id]
        )
      ).rejects.toMatchObject({ code: '23514' });
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await pool.end();
    }
  });

  afterAll(async () => {
    await repository.close();
  });

  it('persists ordered attributed comments across repository connections and isolates tenants', async () => {
    const id = 'd8a17e6a-3266-4ec9-8950-fc21f59c8290';
    await repository.create(loop(id, 'tenant-comments'));
    const service = new LoopService(repository);
    const first = await service.addComment('tenant-comments', 'author-a', id, '  Initial update  ');
    const second = await service.addComment('tenant-comments', 'author-b', id, 'Follow up');
    const reader = new PostgresLoopRepository(databaseUrl!);
    try {
      expect(await reader.listComments('tenant-comments', id)).toEqual([first, second]);
      expect(await reader.listComments('tenant-other', id)).toEqual([]);
      await expect(service.listComments('tenant-other', id)).rejects.toThrow('not found');
      await expect(
        reader.addComment('tenant-other', { ...first, id: 'd8a17e6a-3266-4ec9-8950-fc21f59c8291' })
      ).rejects.toThrow('not found');
      await service.close('tenant-comments', 'author-a', id, true);
      await expect(
        reader.addComment('tenant-comments', {
          ...first,
          id: 'd8a17e6a-3266-4ec9-8950-fc21f59c8292'
        })
      ).rejects.toMatchObject({ httpStatus: 409 });
      expect(await reader.listComments('tenant-comments', id)).toHaveLength(2);
    } finally {
      await reader.close();
    }
  });

  it('rechecks closed status after a concurrent close holds the Loop row lock', async () => {
    const id = 'd8a17e6a-3266-4ec9-8950-fc21f59c8293';
    await repository.create(loop(id, 'tenant-race'));
    const pool = new Pool({ connectionString: databaseUrl });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("UPDATE loops SET status = 'closed', closed_at = now() WHERE id = $1", [
        id
      ]);
      const insertion = repository.addComment('tenant-race', {
        id: 'd8a17e6a-3266-4ec9-8950-fc21f59c8294',
        loopId: id,
        content: 'Concurrent comment',
        authorSub: 'author',
        createdAt: new Date()
      });
      const rejected = expect(insertion).rejects.toMatchObject({ httpStatus: 409 });
      await client.query('COMMIT');
      await rejected;
      expect(await repository.listComments('tenant-race', id)).toEqual([]);
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await pool.end();
    }
  });

  it('round-trips dates and ordered references while isolating tenants and statuses', async () => {
    const first = 'd8a17e6a-3266-4ec9-8950-fc21f59c828a';
    const second = 'd8a17e6a-3266-4ec9-8950-fc21f59c828b';
    expect(await repository.isReady()).toBe(true);
    await repository.create(loop(first, 'tenant-a'));
    await repository.create(loop(second, 'tenant-b'));

    await expect(repository.findById('tenant-b', first)).resolves.toBeUndefined();
    await expect(repository.list('tenant-a', 'all')).resolves.toHaveLength(1);
    await expect(repository.list('tenant-a', 'closed')).resolves.toEqual([]);
    const stored = await repository.findById('tenant-a', first);
    expect(stored?.dueDate).toBe('2026-10-15');
    expect(stored?.relatedRecords.map((record) => record.kind)).toEqual(['entity', 'task']);

    const closed = new Loop({
      ...stored!,
      status: 'closed',
      closedAt: new Date('2026-10-03T12:00:00.000Z')
    });
    await repository.save(closed);
    await expect(repository.list('tenant-a', 'open')).resolves.toEqual([]);
    await expect(repository.list('tenant-a', 'closed')).resolves.toMatchObject([
      { id: first, status: 'closed' }
    ]);
    await expect(repository.list('tenant-b', 'all')).resolves.toMatchObject([
      { id: second, accountId: 'tenant-b' }
    ]);
  });

  it('rolls back failed creates and rejects cross-tenant saves without altering references', async () => {
    const failedId = 'd8a17e6a-3266-4ec9-8950-fc21f59c828c';
    const duplicate = loop(failedId, 'tenant-a', [
      { kind: 'task', recordId: 'same', label: 'One' },
      { kind: 'task', recordId: 'same', label: 'Two' }
    ]);
    await expect(repository.create(duplicate)).rejects.toThrow();
    await expect(repository.findById('tenant-a', failedId)).resolves.toBeUndefined();

    const protectedId = 'd8a17e6a-3266-4ec9-8950-fc21f59c828d';
    await repository.create(loop(protectedId, 'tenant-a'));
    const original = await repository.findById('tenant-a', protectedId);
    await expect(
      repository.save(new Loop({ ...original!, accountId: 'tenant-b' }))
    ).rejects.toThrow('Loop no longer exists.');
    const unchanged = await repository.findById('tenant-a', original!.id);
    expect(unchanged?.relatedRecords).toEqual(original?.relatedRecords);
  });

  it('reconciles seeded references idempotently while preserving the existing Loop identity', async () => {
    const accountId = 'tenant-seed-integration';
    const seedKey = 'approved-test-seed-v1';
    const first = new Loop({
      ...loop('d8a17e6a-3266-4ec9-8950-fc21f59c828e', accountId, [
        { kind: 'email', recordId: 'thread-1', label: 'Relevant thread' }
      ]),
      seedKey
    });
    const replay = new Loop({
      ...loop('d8a17e6a-3266-4ec9-8950-fc21f59c828f', accountId, [
        { kind: 'email', recordId: 'thread-1', label: 'Relevant thread' },
        { kind: 'task', recordId: 'todoist-1', label: 'Follow up' }
      ]),
      seedKey
    });

    await expect(repository.createSeeded(accountId, seedKey, first)).resolves.toMatchObject({
      created: true
    });
    await expect(repository.createSeeded(accountId, seedKey, replay)).resolves.toMatchObject({
      created: false,
      loop: {
        id: first.id,
        relatedRecords: [
          { kind: 'email', recordId: 'thread-1' },
          { kind: 'task', recordId: 'todoist-1' }
        ]
      }
    });
  });
});

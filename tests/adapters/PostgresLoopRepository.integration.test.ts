import { afterAll, describe, expect, it } from 'vitest';

import { PostgresLoopRepository } from '../../src/adapters/postgres/PostgresLoopRepository.js';
import { Loop } from '../../src/domain/Loop.js';

const databaseUrl = process.env['LISTS_TEST_DATABASE_URL'];

describe.skipIf(!databaseUrl)('PostgresLoopRepository on disposable PostgreSQL', () => {
  const repository = new PostgresLoopRepository(databaseUrl ?? '');
  const createdAt = new Date('2026-10-02T12:00:00.000Z');
  const loop = (
    id: string,
    accountId: string,
    relatedRecords = [
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

  afterAll(async () => {
    await repository.close();
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
});

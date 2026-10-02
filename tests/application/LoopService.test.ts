import { describe, expect, it } from 'vitest';

import { LoopService } from '../../src/application/LoopService.js';
import type { LoopRepository } from '../../src/application/ports/LoopRepository.js';
import type { Loop, RelatedRecord } from '../../src/domain/Loop.js';
import { ValidationError } from '../../src/domain/errors.js';

class InMemoryLoopRepository implements LoopRepository {
  readonly loops: Loop[] = [];

  async create(loop: Loop): Promise<Loop> {
    this.loops.push(loop);
    return loop;
  }

  async findById(accountId: string, id: string): Promise<Loop | undefined> {
    return this.loops.find((loop) => loop.accountId === accountId && loop.id === id);
  }

  async list(accountId: string, status: 'open' | 'closed' | 'all'): Promise<Loop[]> {
    return this.loops.filter(
      (loop) => loop.accountId === accountId && (status === 'all' || loop.status === status)
    );
  }

  async save(loop: Loop): Promise<Loop> {
    const index = this.loops.findIndex((candidate) => candidate.id === loop.id);
    this.loops[index] = loop;
    return loop;
  }

  async isReady(): Promise<boolean> {
    return true;
  }
}

describe('LoopService', () => {
  it('creates an open account-scoped loop with its required outcome and record references', async () => {
    const repository = new InMemoryLoopRepository();
    const service = new LoopService(
      repository,
      () => 'loop-1',
      () => new Date('2026-09-30T12:00:00Z')
    );

    await expect(
      service.create('account-123', 'user-123', {
        title: '  Car service  ',
        description: '  Annual service and MOT.  ',
        priority: 'high',
        outcome: '  The car has been serviced.  ',
        dueDate: '2026-10-15',
        relatedRecords: [{ kind: 'task', recordId: 'todoist-task-7', label: 'Book the service' }]
      })
    ).resolves.toMatchObject({
      id: 'loop-1',
      accountId: 'account-123',
      title: 'Car service',
      description: 'Annual service and MOT.',
      priority: 'high',
      outcome: 'The car has been serviced.',
      status: 'open',
      createdBySub: 'user-123',
      relatedRecords: [{ kind: 'task', recordId: 'todoist-task-7', label: 'Book the service' }]
    });
  });

  it('requires the outcome confirmation before closing a loop', async () => {
    const repository = new InMemoryLoopRepository();
    const service = new LoopService(
      repository,
      () => 'loop-1',
      () => new Date('2026-09-30T12:00:00Z')
    );
    await service.create('account-123', 'user-123', {
      title: 'Car service',
      outcome: 'The car has been serviced.'
    });

    await expect(service.close('account-123', 'user-123', 'loop-1', false)).rejects.toBeInstanceOf(
      ValidationError
    );
    await expect(service.close('account-123', 'user-123', 'loop-1', true)).resolves.toMatchObject({
      status: 'closed',
      closedAt: new Date('2026-09-30T12:00:00Z')
    });
  });

  it.each([
    [{ title: ' ', outcome: 'Done' }, 'title'],
    [{ title: 'Follow up', outcome: ' ' }, 'outcome'],
    [{ title: 'Follow up', outcome: 'Done', priority: 'urgent' }, 'priority'],
    [{ title: 'Follow up', outcome: 'Done', dueDate: '2026-02-30' }, 'dueDate'],
    [{ title: 'Follow up', outcome: 'Done', dueDate: '2026/10/15' }, 'dueDate']
  ])('rejects invalid required values and impossible calendar dates', async (input, field) => {
    const service = new LoopService(new InMemoryLoopRepository());
    await expect(
      service.create('tenant-a', 'user-a', input as Parameters<typeof service.create>[2])
    ).rejects.toThrow(field);
  });

  it('rejects duplicate, malformed, and excessive related references', async () => {
    const service = new LoopService(new InMemoryLoopRepository());
    const create = (relatedRecords: unknown[]) =>
      service.create('tenant-a', 'user-a', {
        title: 'Follow up',
        outcome: 'Done',
        relatedRecords: relatedRecords as RelatedRecord[]
      });
    await expect(
      create([
        { kind: 'task', recordId: 'same', label: 'One' },
        { kind: 'task', recordId: 'same', label: 'Two' }
      ])
    ).rejects.toThrow('duplicate');
    await expect(create([{ kind: 'url', recordId: 'id', label: 'Unknown' }])).rejects.toThrow(
      'kind'
    );
    await expect(create([{ kind: 'entity', recordId: ' ', label: 'Name' }])).rejects.toThrow(
      'recordId'
    );
    await expect(create([{ kind: 'entity', recordId: 'id', label: ' ' }])).rejects.toThrow('label');
    await expect(
      create(
        Array.from({ length: 101 }, (_, index) => ({
          kind: 'task',
          recordId: `${index}`,
          label: 'Task'
        }))
      )
    ).rejects.toThrow('100');
  });

  it('updates open loops while preserving omitted fields and clearing nullable fields', async () => {
    const repository = new InMemoryLoopRepository();
    let now = new Date('2026-10-02T12:00:00Z');
    const service = new LoopService(
      repository,
      () => 'loop-1',
      () => now
    );
    await service.create('tenant-a', 'user-a', {
      title: 'Before',
      description: 'Detail',
      outcome: 'Before done',
      dueDate: '2026-10-15',
      relatedRecords: [{ kind: 'task', recordId: 'task-1', label: 'Task' }]
    });
    now = new Date('2026-10-03T12:00:00Z');
    const updated = await service.update('tenant-a', 'user-b', 'loop-1', {
      title: 'After',
      description: null,
      dueDate: null,
      priority: 'low',
      relatedRecords: [{ kind: 'entity', recordId: 'entity-1', label: 'Entity' }]
    });
    expect(updated).toMatchObject({
      title: 'After',
      description: undefined,
      dueDate: undefined,
      priority: 'low',
      outcome: 'Before done',
      updatedBySub: 'user-b',
      updatedAt: now,
      relatedRecords: [{ kind: 'entity', recordId: 'entity-1', label: 'Entity' }]
    });
    await expect(
      service.update('tenant-a', 'user-b', 'loop-1', { outcome: 'New result', relatedRecords: [] })
    ).resolves.toMatchObject({ outcome: 'New result', relatedRecords: [] });
  });

  it('rejects empty or inaccessible edits and keeps closing idempotent', async () => {
    const repository = new InMemoryLoopRepository();
    const service = new LoopService(
      repository,
      () => 'loop-1',
      () => new Date('2026-10-02T12:00:00Z')
    );
    await service.create('tenant-a', 'user-a', { title: 'Follow up', outcome: 'Done' });
    await expect(service.update('tenant-a', 'user-a', 'loop-1', {})).rejects.toThrow('field');
    await expect(
      service.update('tenant-b', 'user-b', 'loop-1', { title: 'Foreign' })
    ).rejects.toThrow();
    await expect(service.get('tenant-b', 'loop-1')).rejects.toThrow();
    const firstClose = await service.close('tenant-a', 'user-a', 'loop-1', true);
    await expect(service.close('tenant-a', 'user-b', 'loop-1', true)).resolves.toBe(firstClose);
    await expect(service.update('tenant-a', 'user-a', 'loop-1', { title: 'Late' })).rejects.toThrow(
      'Closed'
    );
  });
});

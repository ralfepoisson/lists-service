import { describe, expect, it } from 'vitest';

import { LoopService } from '../../src/application/LoopService.js';
import type { LoopRepository } from '../../src/application/ports/LoopRepository.js';
import type { Loop } from '../../src/domain/Loop.js';
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
});

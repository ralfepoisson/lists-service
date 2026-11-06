import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { LoopService } from '../../src/application/LoopService.js';
import { InMemoryLoopRepository } from '../support/InMemoryLoopRepository.js';

describe('Loop field-presence and version mutation policy', () => {
  it('requires a current version before replacing references, preserving them on scalar edits', async () => {
    const service = new LoopService(new InMemoryLoopRepository(), () => 'id');
    const original = await service.create('owner', 'author', {
      title: 'Before',
      outcome: 'Done',
      relatedRecords: [{ kind: 'task', recordId: 'task', label: 'Task' }]
    });
    await expect(
      service.update('owner', 'author', original.id, { relatedRecords: [] })
    ).rejects.toMatchObject({ httpStatus: 400 });
    const edited = await service.update('owner', 'author', original.id, { title: 'After' });
    expect(edited.relatedRecords).toEqual(original.relatedRecords);
    expect(edited.version).toBe(2);
    await expect(
      service.update('owner', 'author', original.id, { relatedRecords: [], expectedVersion: 1 })
    ).rejects.toMatchObject({ httpStatus: 409 });
  });
  it('requires literal true closure and restricts append context to a fixed nonprivate Calendar reference', async () => {
    const service = new LoopService(new InMemoryLoopRepository(), () => 'id');
    const loop = await service.create('owner', 'author', { title: 'Before', outcome: 'Done' });
    await expect(
      service.close('owner', 'author', loop.id, 'true' as unknown as boolean)
    ).rejects.toMatchObject({ httpStatus: 400 });
    const eventId = randomUUID(),
      operationId = randomUUID();
    for (const record of [
      { kind: 'task' as const, recordId: `calendar:${eventId}`, label: 'Calendar event' },
      { kind: 'appointment' as const, recordId: eventId, label: 'Calendar event' },
      { kind: 'appointment' as const, recordId: `calendar:${eventId}`, label: 'Private title' }
    ]) {
      await expect(
        service.appendReference('owner', 'agent', loop.id, { eventId, operationId, record })
      ).rejects.toMatchObject({ httpStatus: 400 });
    }
  });
  it('rejects invalid optional append freshness versions without admitting an operation', async () => {
    const service = new LoopService(new InMemoryLoopRepository(), () => 'id');
    const loop = await service.create('owner', 'author', { title: 'Fixture', outcome: 'Done' }),
      eventId = randomUUID();
    for (const expectedVersion of [0, -1, 1.5, '1', null]) {
      const input = {
        eventId,
        operationId: randomUUID(),
        record: {
          kind: 'appointment' as const,
          recordId: `calendar:${eventId}`,
          label: 'Calendar event'
        },
        expectedVersion: expectedVersion as number
      };
      await expect(service.appendReference('owner', 'agent', loop.id, input)).rejects.toMatchObject(
        { httpStatus: 400 }
      );
    }
  });
});

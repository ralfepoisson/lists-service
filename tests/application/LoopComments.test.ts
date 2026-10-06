import { describe, expect, it } from 'vitest';

import { LoopService } from '../../src/application/LoopService.js';
import { InMemoryLoopRepository } from '../support/InMemoryLoopRepository.js';

describe('Loop profile comments', () => {
  const setup = async (): Promise<LoopService> => {
    let nextId = 0;
    const service = new LoopService(
      new InMemoryLoopRepository(),
      () => `id-${++nextId}`,
      () => new Date('2026-10-06T12:00:00.000Z')
    );
    await service.create('tenant-a', 'user-a', { title: 'Follow up', outcome: 'Done' });
    return service;
  };

  it('appends trimmed comments with immutable author and timestamp and reads them in order', async () => {
    const service = await setup();
    await expect(service.listComments('tenant-a', 'id-1')).resolves.toEqual([]);
    const first = await service.addComment('tenant-a', 'user-a', 'id-1', '  First update  ');
    const second = await service.addComment('tenant-a', 'user-b', 'id-1', 'Second update');
    expect(first).toEqual({
      id: 'id-2',
      loopId: 'id-1',
      content: 'First update',
      authorSub: 'user-a',
      createdAt: new Date('2026-10-06T12:00:00.000Z')
    });
    await expect(service.listComments('tenant-a', 'id-1')).resolves.toEqual([first, second]);
  });

  it.each(['', '  ', 'x'.repeat(4_001), 42])(
    'rejects empty, oversized or non-text content',
    async (content) => {
      const service = await setup();
      await expect(
        service.addComment('tenant-a', 'user-a', 'id-1', content as string)
      ).rejects.toThrow('content');
      await expect(service.listComments('tenant-a', 'id-1')).resolves.toEqual([]);
    }
  );

  it('hides foreign Loops for both comment reads and writes', async () => {
    const service = await setup();
    await expect(service.listComments('tenant-b', 'id-1')).rejects.toThrow('not found');
    await expect(service.addComment('tenant-b', 'user-b', 'id-1', 'Foreign')).rejects.toThrow(
      'not found'
    );
    await expect(service.listComments('tenant-a', 'id-1')).resolves.toEqual([]);
  });

  it('keeps existing comments readable when closed and refuses new comments', async () => {
    const service = await setup();
    const existing = await service.addComment('tenant-a', 'user-a', 'id-1', 'Before close');
    await service.close('tenant-a', 'user-a', 'id-1', true);
    await expect(service.addComment('tenant-a', 'user-a', 'id-1', 'Late')).rejects.toMatchObject({
      httpStatus: 409,
      code: 'LOOP_CLOSED'
    });
    await expect(service.listComments('tenant-a', 'id-1')).resolves.toEqual([existing]);
  });
});

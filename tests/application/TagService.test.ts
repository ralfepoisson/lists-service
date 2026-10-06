import { describe, expect, it } from 'vitest';
import { TagService } from '../../src/application/TagService.js';
import type { TagRepository, TagEntityKind } from '../../src/application/ports/TagRepository.js';
import type { Tag, TaggedEntity } from '../../src/application/ports/TagRepository.js';

class Repository implements TagRepository {
  readonly calls: unknown[][] = [];
  async list(...args: [string, string, number, number]): Promise<Tag[]> {
    this.calls.push(args);
    return [];
  }
  async create(...args: [string, string]): Promise<Tag> {
    this.calls.push(args);
    return { id: 't-1', name: args[1] };
  }
  async forEntity(...args: [string, TagEntityKind, string, string?]): Promise<Tag[]> {
    this.calls.push(args);
    return [];
  }
  async assign(...args: [string, string, TagEntityKind, string, string?]): Promise<Tag[]> {
    this.calls.push(args);
    return [];
  }
  async remove(...args: [string, string, TagEntityKind, string, string?]): Promise<Tag[]> {
    this.calls.push(args);
    return [];
  }
  async explore(...args: [string, string, TagEntityKind, number, number]): Promise<TaggedEntity[]> {
    this.calls.push(args);
    return [];
  }
}

describe('TagService', () => {
  it('normalizes labels, scopes operations to the supplied tenant, and supports bounded queries', async () => {
    const repository = new Repository();
    const service = new TagService(repository);
    expect(await service.create('tenant-a', '  Care   planning  ')).toEqual({
      id: 't-1',
      name: 'Care planning'
    });
    await service.list('tenant-a', ' plan ', 25, 50);
    await service.assign('tenant-a', 't-1', 'task', 'task-2', 'project-1');
    expect(repository.calls).toEqual([
      ['tenant-a', 'Care planning'],
      ['tenant-a', 'plan', 25, 50],
      ['tenant-a', 't-1', 'task', 'task-2', 'project-1']
    ]);
  });

  it('rejects empty labels, invalid pagination, and tasks without their project identity', async () => {
    const service = new TagService(new Repository());
    expect(() => service.create('tenant-a', '  ')).toThrow('name must contain');
    expect(() => service.list('tenant-a', '', 101, 0)).toThrow('limit must be');
    expect(() => service.forEntity('tenant-a', 'task', 'task-1')).toThrow('requires listId');
  });
});

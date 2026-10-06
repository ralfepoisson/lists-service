import type { Tag, TagEntityKind, TagRepository, TaggedEntity } from './ports/TagRepository.js';
import { ValidationError } from '../domain/errors.js';

export class TagService {
  constructor(private readonly repository: TagRepository) {}

  list(accountId: string, query = '', limit = 50, offset = 0): Promise<Tag[]> {
    this.page(limit, offset);
    const search = query.trim();
    if (search.length > 100) throw new ValidationError('query must be at most 100 characters.');
    return this.repository.list(accountId, search, limit, offset);
  }

  create(accountId: string, rawName: string): Promise<Tag> {
    if (typeof rawName !== 'string') throw new ValidationError('name must be a string.');
    const name = rawName.trim().replace(/\s+/gu, ' ');
    if (name.length === 0 || name.length > 64)
      throw new ValidationError('name must contain 1 to 64 characters.');
    return this.repository.create(accountId, name);
  }

  forEntity(
    accountId: string,
    kind: TagEntityKind,
    entityId: string,
    listId?: string
  ): Promise<Tag[]> {
    this.identity(kind, entityId, listId);
    return this.repository.forEntity(accountId, kind, entityId.trim(), listId?.trim());
  }

  assign(
    accountId: string,
    tagId: string,
    kind: TagEntityKind,
    entityId: string,
    listId?: string
  ): Promise<Tag[]> {
    this.identity(kind, entityId, listId);
    return this.repository.assign(accountId, this.id(tagId), kind, entityId.trim(), listId?.trim());
  }

  remove(
    accountId: string,
    tagId: string,
    kind: TagEntityKind,
    entityId: string,
    listId?: string
  ): Promise<Tag[]> {
    this.identity(kind, entityId, listId);
    return this.repository.remove(accountId, this.id(tagId), kind, entityId.trim(), listId?.trim());
  }

  explore(
    accountId: string,
    tagId: string,
    kind: TagEntityKind,
    limit = 50,
    offset = 0,
    status: 'open' | 'closed' | 'all' = 'open'
  ): Promise<TaggedEntity[]> {
    this.page(limit, offset);
    if (!['open', 'closed', 'all'].includes(status))
      throw new ValidationError('status must be open, closed, or all.');
    return this.repository.explore(accountId, this.id(tagId), kind, limit, offset, status);
  }

  private page(limit: number, offset: number): void {
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset > 100_000
    ) {
      throw new ValidationError('limit must be 1-100 and offset 0-100000.');
    }
  }

  private id(value: string): string {
    const id = value.trim();
    if (!id || id.length > 256) throw new ValidationError('A valid identifier is required.');
    return id;
  }

  private identity(kind: TagEntityKind, entityId: string, listId?: string): void {
    if (!['loop', 'task', 'item'].includes(kind))
      throw new ValidationError('kind must be loop, task, or item.');
    this.id(entityId);
    if ((kind === 'task' && !listId?.trim()) || (kind !== 'task' && listId !== undefined)) {
      throw new ValidationError(
        'A task requires listId; other taggable entities must not include listId.'
      );
    }
  }
}

import type {
  Tag,
  TagEntityKind,
  TagRepository,
  TaggedEntity
} from '../../src/application/ports/TagRepository.js';

export class InMemoryTagRepository implements TagRepository {
  private readonly tags = new Map<string, Tag[]>();
  private readonly assignments = new Map<
    string,
    { tagId: string; kind: TagEntityKind; entityId: string; listId: string }[]
  >();
  async list(accountId: string, query: string, limit: number, offset: number): Promise<Tag[]> {
    return (this.tags.get(accountId) ?? [])
      .filter((tag) =>
        tag.name.toLocaleLowerCase('en-GB').includes(query.toLocaleLowerCase('en-GB'))
      )
      .slice(offset, offset + limit);
  }
  async create(accountId: string, name: string): Promise<Tag> {
    const tags = this.tags.get(accountId) ?? [];
    const existing = tags.find(
      (tag) => tag.name.toLocaleLowerCase('en-GB') === name.toLocaleLowerCase('en-GB')
    );
    if (existing) return existing;
    const tag = { id: `tag-${tags.length + 1}`, name };
    tags.push(tag);
    this.tags.set(accountId, tags);
    return tag;
  }
  async forEntity(
    accountId: string,
    kind: TagEntityKind,
    entityId: string,
    listId = ''
  ): Promise<Tag[]> {
    const ids = (this.assignments.get(accountId) ?? [])
      .filter((item) => item.kind === kind && item.entityId === entityId && item.listId === listId)
      .map((item) => item.tagId);
    return (this.tags.get(accountId) ?? []).filter((tag) => ids.includes(tag.id));
  }
  async assign(
    accountId: string,
    tagId: string,
    kind: TagEntityKind,
    entityId: string,
    listId = ''
  ): Promise<Tag[]> {
    const assignments = this.assignments.get(accountId) ?? [];
    if (!(this.tags.get(accountId) ?? []).some((tag) => tag.id === tagId)) return [];
    if (
      !assignments.some(
        (item) =>
          item.tagId === tagId &&
          item.kind === kind &&
          item.entityId === entityId &&
          item.listId === listId
      )
    )
      assignments.push({ tagId, kind, entityId, listId });
    this.assignments.set(accountId, assignments);
    return this.forEntity(accountId, kind, entityId, listId);
  }
  async remove(
    accountId: string,
    tagId: string,
    kind: TagEntityKind,
    entityId: string,
    listId = ''
  ): Promise<Tag[]> {
    this.assignments.set(
      accountId,
      (this.assignments.get(accountId) ?? []).filter(
        (item) =>
          !(
            item.tagId === tagId &&
            item.kind === kind &&
            item.entityId === entityId &&
            item.listId === listId
          )
      )
    );
    return this.forEntity(accountId, kind, entityId, listId);
  }
  async explore(
    accountId: string,
    tagId: string,
    kind: TagEntityKind,
    limit: number,
    offset: number
  ): Promise<TaggedEntity[]> {
    return (this.assignments.get(accountId) ?? [])
      .filter((item) => item.tagId === tagId && item.kind === kind)
      .slice(offset, offset + limit)
      .map((item) => ({
        kind,
        id: item.entityId,
        ...(kind === 'task' ? { listId: item.listId } : {}),
        label: item.entityId
      }));
  }
}

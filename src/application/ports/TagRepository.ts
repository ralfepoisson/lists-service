export type TagEntityKind = 'loop' | 'task' | 'item';

export interface Tag {
  readonly id: string;
  readonly name: string;
}

export interface TaggedEntity {
  readonly kind: TagEntityKind;
  readonly id: string;
  readonly listId?: string;
  readonly label: string;
}

export interface TagRepository {
  list(accountId: string, query: string, limit: number, offset: number): Promise<Tag[]>;
  create(accountId: string, name: string): Promise<Tag>;
  forEntity(
    accountId: string,
    kind: TagEntityKind,
    entityId: string,
    listId?: string
  ): Promise<Tag[]>;
  assign(
    accountId: string,
    tagId: string,
    kind: TagEntityKind,
    entityId: string,
    listId?: string
  ): Promise<Tag[]>;
  remove(
    accountId: string,
    tagId: string,
    kind: TagEntityKind,
    entityId: string,
    listId?: string
  ): Promise<Tag[]>;
  explore(
    accountId: string,
    tagId: string,
    kind: TagEntityKind,
    limit: number,
    offset: number,
    status?: 'open' | 'closed' | 'all'
  ): Promise<TaggedEntity[]>;
}

import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type {
  Tag,
  TagEntityKind,
  TagRepository,
  TaggedEntity
} from '../../application/ports/TagRepository.js';
import { ValidationError } from '../../domain/errors.js';

interface TagRow {
  readonly id: string;
  readonly name: string;
}
interface EntityRow {
  readonly entity_id: string;
  readonly list_id: string;
}

export class PostgresTagRepository implements TagRepository {
  private readonly pool: Pool;
  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }
  async close(): Promise<void> {
    await this.pool.end();
  }

  async list(accountId: string, query: string, limit: number, offset: number): Promise<Tag[]> {
    const result = await this.pool.query<TagRow>(
      `SELECT id, name FROM lists_tags WHERE account_id = $1 AND strpos(normalized_name, lower($2)) > 0 ORDER BY normalized_name, id LIMIT $3 OFFSET $4`,
      [accountId, query, limit, offset]
    );
    return result.rows;
  }

  async create(accountId: string, name: string): Promise<Tag> {
    const normalized = name.toLocaleLowerCase('en-GB');
    const result = await this.pool.query<TagRow>(
      `INSERT INTO lists_tags (id, account_id, name, normalized_name) VALUES ($1, $2, $3, $4)
       ON CONFLICT (account_id, normalized_name) DO UPDATE SET normalized_name = EXCLUDED.normalized_name
       RETURNING id, name`,
      [randomUUID(), accountId, name, normalized]
    );
    return result.rows[0] as TagRow;
  }

  async forEntity(
    accountId: string,
    kind: TagEntityKind,
    entityId: string,
    listId = ''
  ): Promise<Tag[]> {
    const result = await this.pool.query<TagRow>(
      `SELECT t.id, t.name FROM lists_tag_assignments a JOIN lists_tags t ON t.account_id = a.account_id AND t.id = a.tag_id
       WHERE a.account_id = $1 AND a.entity_kind = $2 AND a.entity_id = $3 AND a.list_id = $4 ORDER BY t.normalized_name`,
      [accountId, kind, entityId, listId]
    );
    return result.rows;
  }

  async assign(
    accountId: string,
    tagId: string,
    kind: TagEntityKind,
    entityId: string,
    listId = ''
  ): Promise<Tag[]> {
    const owned = await this.pool.query(
      'SELECT 1 FROM lists_tags WHERE account_id = $1 AND id = $2',
      [accountId, tagId]
    );
    if (owned.rowCount !== 1)
      throw new ValidationError('The tag does not belong to the authenticated tenant.');
    await this.pool.query(
      `INSERT INTO lists_tag_assignments (account_id, tag_id, entity_kind, provider, list_id, entity_id)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
      [accountId, tagId, kind, kind === 'loop' ? 'lists' : 'todoist', listId, entityId]
    );
    return this.forEntity(accountId, kind, entityId, listId);
  }

  async remove(
    accountId: string,
    tagId: string,
    kind: TagEntityKind,
    entityId: string,
    listId = ''
  ): Promise<Tag[]> {
    await this.pool.query(
      `DELETE FROM lists_tag_assignments WHERE account_id = $1 AND tag_id = $2 AND entity_kind = $3 AND list_id = $4 AND entity_id = $5`,
      [accountId, tagId, kind, listId, entityId]
    );
    return this.forEntity(accountId, kind, entityId, listId);
  }

  async explore(
    accountId: string,
    tagId: string,
    kind: TagEntityKind,
    limit: number,
    offset: number,
    status: 'open' | 'closed' | 'all' = 'open'
  ): Promise<TaggedEntity[]> {
    const result = await this.pool.query<EntityRow>(
      `SELECT a.entity_id, a.list_id FROM lists_tag_assignments a
       WHERE a.account_id = $1 AND a.tag_id = $2 AND a.entity_kind = $3
         AND (a.entity_kind <> 'loop' OR $6 = 'all' OR EXISTS (
           SELECT 1 FROM loops l WHERE l.account_id = a.account_id AND l.id::text = a.entity_id AND l.status = $6
         ))
       ORDER BY a.created_at DESC, a.entity_id LIMIT $4 OFFSET $5`,
      [accountId, tagId, kind, limit, offset, status]
    );
    return result.rows.map((row) => ({
      kind,
      id: row.entity_id,
      ...(kind === 'task' ? { listId: row.list_id } : {}),
      label: row.entity_id
    }));
  }
}

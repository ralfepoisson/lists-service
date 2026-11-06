import { createHash } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import type { LoopRepository } from '../../application/ports/LoopRepository.js';
import type { LoopComment } from '../../domain/LoopComment.js';
import {
  LoopClosedError,
  LoopNotFoundError,
  LoopVersionConflictError,
  ValidationError
} from '../../domain/errors.js';
import {
  Loop,
  type CalendarReferenceAppend,
  type LoopAppendResult,
  type LoopPatch,
  type LoopPriority,
  type LoopStatus,
  type RelatedRecord
} from '../../domain/Loop.js';

interface LoopRow {
  readonly id: string;
  readonly account_id: string;
  readonly seed_key: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly priority: LoopPriority;
  readonly outcome: string;
  readonly due_date: string | null;
  readonly status: LoopStatus;
  readonly created_by_sub: string;
  readonly updated_by_sub: string;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly closed_at: Date | null;
  readonly version: number;
  readonly related_records: RelatedRecord[];
}
interface LoopCommentRow {
  readonly id: string;
  readonly loop_id: string;
  readonly content: string;
  readonly author_sub: string;
  readonly author_email: string | null;
  readonly created_at: Date;
}
interface AppendReceipt {
  readonly loop_id: string;
  readonly event_id: string;
  readonly payload_sha256: string;
  readonly applied_version: number;
}
const columns = `l.*,l.due_date::text AS due_date,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('kind',r.record_kind,'recordId',r.record_id,'label',r.label) ORDER BY r.ordinal)
    FROM loop_related_records r WHERE r.loop_id=l.id),'[]'::jsonb) AS related_records`;

export class PostgresLoopRepository implements LoopRepository {
  private readonly pool: Pool;
  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }
  async close(): Promise<void> {
    await this.pool.end();
  }
  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  private toLoop(row: LoopRow): Loop {
    return new Loop({
      id: row.id,
      accountId: row.account_id,
      ...(row.seed_key === null ? {} : { seedKey: row.seed_key }),
      title: row.title,
      description: row.description ?? undefined,
      priority: row.priority,
      outcome: row.outcome,
      dueDate: row.due_date ?? undefined,
      status: row.status,
      relatedRecords: row.related_records,
      createdBySub: row.created_by_sub,
      updatedBySub: row.updated_by_sub,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      closedAt: row.closed_at ?? undefined,
      version: row.version
    });
  }
  private async locked(client: PoolClient, accountId: string, id: string): Promise<Loop> {
    const result = await client.query<{ id: string }>(
      'SELECT id FROM loops WHERE account_id=$1 AND id=$2 FOR UPDATE',
      [accountId, id]
    );
    if (!result.rows[0]) throw new LoopNotFoundError();
    // The row lock serializes all writers. Refresh refs in a new statement after
    // waiting, avoiding READ COMMITTED's old correlated-subquery snapshot.
    return (await this.snapshot(client, accountId, id))!;
  }
  private async snapshot(
    connection: Pool | PoolClient,
    accountId: string,
    id: string
  ): Promise<Loop | undefined> {
    const result = await connection.query<LoopRow>(
      `SELECT ${columns} FROM loops l WHERE l.account_id=$1 AND l.id=$2`,
      [accountId, id]
    );
    return result.rows[0] ? this.toLoop(result.rows[0]) : undefined;
  }
  async findById(accountId: string, id: string): Promise<Loop | undefined> {
    return this.snapshot(this.pool, accountId, id);
  }
  async list(
    accountId: string,
    status: 'open' | 'closed' | 'all',
    search?: { readonly query: string; readonly limit: number }
  ): Promise<Loop[]> {
    if (search) {
      if (
        typeof search.query !== 'string' ||
        search.query.trim().length < 2 ||
        search.query.trim().length > 120 ||
        !Number.isSafeInteger(search.limit) ||
        search.limit < 1 ||
        search.limit > 5
      )
        throw new ValidationError('Calendar Loop search requires a literal query and limit1–5.');
      const result = await this.pool.query<LoopRow>(
        `SELECT ${columns} FROM loops l WHERE l.account_id=$1 AND l.status='open'
         AND strpos(lower(concat_ws(' ',l.title,l.description,l.outcome)),lower($2))>0
         ORDER BY l.updated_at DESC,l.id LIMIT $3`,
        [accountId, search.query.trim(), search.limit]
      );
      return result.rows.map((row) => this.toLoop(row));
    }
    const result = await this.pool.query<LoopRow>(
      `SELECT ${columns} FROM loops l WHERE l.account_id=$1 AND ($2='all' OR l.status=$2)
      ORDER BY CASE WHEN l.status='open' THEN 0 ELSE 1 END,l.due_date ASC NULLS LAST,l.created_at DESC`,
      [accountId, status]
    );
    return result.rows.map((row) => this.toLoop(row));
  }
  private async insert(client: PoolClient, loop: Loop, seeded = false): Promise<boolean> {
    const result = await client.query(
      `INSERT INTO loops(id,account_id,seed_key,title,description,priority,outcome,due_date,status,created_by_sub,updated_by_sub,created_at,updated_at,closed_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ${seeded ? 'ON CONFLICT(account_id,seed_key) DO NOTHING' : ''} RETURNING id`,
      [
        loop.id,
        loop.accountId,
        loop.seedKey ?? null,
        loop.title,
        loop.description ?? null,
        loop.priority,
        loop.outcome,
        loop.dueDate ?? null,
        loop.status,
        loop.createdBySub,
        loop.updatedBySub,
        loop.createdAt,
        loop.updatedAt,
        loop.closedAt ?? null
      ]
    );
    return result.rowCount === 1;
  }
  private async replace(client: PoolClient, loop: Loop): Promise<void> {
    await client.query('DELETE FROM loop_related_records WHERE loop_id=$1', [loop.id]);
    for (const [ordinal, record] of loop.relatedRecords.entries())
      await client.query(
        'INSERT INTO loop_related_records(loop_id,record_kind,record_id,label,ordinal) VALUES($1,$2,$3,$4,$5)',
        [loop.id, record.kind, record.recordId, record.label, ordinal]
      );
  }
  async create(loop: Loop): Promise<Loop> {
    return this.transaction(async (client) => {
      await this.insert(client, loop);
      await this.replace(client, loop);
      return (await this.snapshot(client, loop.accountId, loop.id))!;
    });
  }
  async createSeeded(
    accountId: string,
    seedKey: string,
    loop: Loop
  ): Promise<{ loop: Loop; created: boolean }> {
    if (accountId !== loop.accountId || seedKey !== loop.seedKey)
      throw new ValidationError('Seed ownership and identity must match.');
    return this.transaction(async (client) => {
      const created = await this.insert(client, loop, true);
      if (created) {
        await this.replace(client, loop);
        return { loop: (await this.snapshot(client, accountId, loop.id))!, created };
      }
      const row = await client.query<{ id: string }>(
        'SELECT id FROM loops WHERE account_id=$1 AND seed_key=$2',
        [accountId, seedKey]
      );
      const id = row.rows[0]?.id;
      if (!id) throw new LoopNotFoundError();
      const existing = await this.locked(client, accountId, id);
      const additions = loop.relatedRecords.filter(
        (record) =>
          !existing.relatedRecords.some(
            (r) => r.kind === record.kind && r.recordId === record.recordId
          )
      );
      if (additions.length) {
        if (existing.status === 'closed') throw new LoopClosedError();
        if (existing.relatedRecords.length + additions.length > 100)
          throw new ValidationError('A loop can reference at most 100 records.');
        await this.persist(
          client,
          existing,
          new Loop({ ...existing, relatedRecords: [...existing.relatedRecords, ...additions] }),
          loop.updatedBySub,
          loop.updatedAt
        );
      }
      return { loop: (await this.snapshot(client, accountId, id))!, created };
    });
  }
  private sameReferences(a: readonly RelatedRecord[], b: readonly RelatedRecord[]): boolean {
    return (
      JSON.stringify(a.map((r) => [r.kind, r.recordId, r.label])) ===
      JSON.stringify(b.map((r) => [r.kind, r.recordId, r.label]))
    );
  }
  private equalVisible(a: Loop, b: Loop): boolean {
    return (
      a.title === b.title &&
      a.description === b.description &&
      a.priority === b.priority &&
      a.outcome === b.outcome &&
      a.dueDate === b.dueDate &&
      a.status === b.status &&
      this.sameReferences(a.relatedRecords, b.relatedRecords)
    );
  }
  private async persist(
    client: PoolClient,
    prior: Loop,
    next: Loop,
    sub: string,
    now: Date
  ): Promise<Loop> {
    if (this.equalVisible(prior, next)) return prior;
    await client.query(
      `UPDATE loops SET title=$3,description=$4,priority=$5,outcome=$6,due_date=$7,status=$8,closed_at=$9,
      updated_by_sub=$10,updated_at=$11,version=version+1 WHERE account_id=$1 AND id=$2`,
      [
        prior.accountId,
        prior.id,
        next.title,
        next.description ?? null,
        next.priority,
        next.outcome,
        next.dueDate ?? null,
        next.status,
        next.closedAt ?? null,
        sub,
        now
      ]
    );
    if (!this.sameReferences(prior.relatedRecords, next.relatedRecords))
      await this.replace(client, next);
    return (await this.snapshot(client, prior.accountId, prior.id))!;
  }
  async patch(
    accountId: string,
    id: string,
    sub: string,
    patch: LoopPatch,
    now: Date
  ): Promise<Loop> {
    return this.transaction(async (client) => {
      const prior = await this.locked(client, accountId, id);
      if (prior.status === 'closed') throw new LoopClosedError();
      const { expectedVersion, ...fields } = patch;
      if (patch.relatedRecords !== undefined && expectedVersion === undefined)
        throw new ValidationError('Replacing relatedRecords requires expectedVersion.');
      if (expectedVersion !== undefined && expectedVersion !== prior.version)
        throw new LoopVersionConflictError();
      const next = new Loop({
        ...prior,
        ...fields,
        description:
          patch.description === null ? undefined : (patch.description ?? prior.description),
        dueDate: patch.dueDate === null ? undefined : (patch.dueDate ?? prior.dueDate)
      });
      return this.persist(client, prior, next, sub, now);
    });
  }
  async save(loop: Loop): Promise<Loop> {
    return this.transaction(async (client) => {
      const prior = await this.locked(client, loop.accountId, loop.id);
      if (prior.version !== loop.version) throw new LoopVersionConflictError();
      if (prior.status === 'closed') {
        if (this.equalVisible(prior, loop)) return prior;
        throw new LoopClosedError();
      }
      return this.persist(client, prior, loop, loop.updatedBySub, loop.updatedAt);
    });
  }
  async closeLoop(accountId: string, id: string, sub: string, now: Date): Promise<Loop> {
    return this.transaction(async (client) => {
      const prior = await this.locked(client, accountId, id);
      return prior.status === 'closed'
        ? prior
        : this.persist(
            client,
            prior,
            new Loop({ ...prior, status: 'closed', closedAt: now }),
            sub,
            now
          );
    });
  }
  async appendReference(
    accountId: string,
    id: string,
    sub: string,
    input: CalendarReferenceAppend,
    now: Date
  ): Promise<LoopAppendResult> {
    if (
      input.expectedVersion !== undefined &&
      (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1)
    )
      throw new ValidationError('expectedVersion must be a positive integer.');
    if (
      input.record.kind !== 'appointment' ||
      input.record.recordId !== `calendar:${input.eventId}` ||
      input.record.label !== 'Calendar event'
    )
      throw new ValidationError('Only the fixed Calendar event reference is permitted.');
    const digest = createHash('sha256')
      .update(
        JSON.stringify({
          eventId: input.eventId,
          record: {
            kind: input.record.kind,
            recordId: input.record.recordId,
            label: input.record.label
          }
        })
      )
      .digest('hex');
    return this.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        JSON.stringify([accountId, input.operationId])
      ]);
      const receipts = await client.query<AppendReceipt>(
        'SELECT loop_id,event_id,payload_sha256,applied_version FROM loop_append_operations WHERE account_id=$1 AND operation_id=$2',
        [accountId, input.operationId]
      );
      const receipt = receipts.rows[0];
      if (
        receipt &&
        (receipt.loop_id !== id.toLowerCase() ||
          receipt.event_id !== input.eventId ||
          receipt.payload_sha256 !== digest)
      )
        throw new LoopVersionConflictError(
          'Append operation identity was already bound to another payload.'
        );
      const prior = await this.locked(client, accountId, id);
      const present = prior.relatedRecords.some(
        (r) => r.kind === input.record.kind && r.recordId === input.record.recordId
      );
      if (receipt)
        return {
          loop: prior,
          appended: false,
          replayed: true,
          referencePresent: present,
          appliedVersion: receipt.applied_version
        };
      // Existing immutable receipts above are replayed without a fresh CAS:
      // their effect must never be repeated after later human edits/unlinks.
      if (input.expectedVersion !== undefined && input.expectedVersion !== prior.version)
        throw new LoopVersionConflictError(
          'Loop changed before the Calendar association was applied.'
        );
      if (prior.status === 'closed') throw new LoopClosedError();
      if (!present && prior.relatedRecords.length >= 100)
        throw new ValidationError('A loop can reference at most 100 records.');
      const loop = present
        ? prior
        : await this.persist(
            client,
            prior,
            new Loop({ ...prior, relatedRecords: [...prior.relatedRecords, input.record] }),
            sub,
            now
          );
      await client.query(
        'INSERT INTO loop_append_operations(account_id,operation_id,loop_id,event_id,payload_sha256,applied_version,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [accountId, input.operationId, id, input.eventId, digest, loop.version, now]
      );
      return {
        loop,
        appended: !present,
        replayed: false,
        referencePresent: true,
        appliedVersion: loop.version
      };
    });
  }
  async isReady(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
  async listComments(accountId: string, loopId: string): Promise<LoopComment[]> {
    const result = await this.pool.query<LoopCommentRow>(
      'SELECT id,loop_id,content,author_sub,author_email,created_at FROM loop_comments WHERE account_id=$1 AND loop_id=$2 ORDER BY ordinal',
      [accountId, loopId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      loopId: row.loop_id,
      content: row.content,
      authorSub: row.author_sub,
      createdAt: row.created_at,
      ...(row.author_email === null ? {} : { authorEmail: row.author_email })
    }));
  }
  async addComment(accountId: string, comment: LoopComment): Promise<LoopComment> {
    return this.transaction(async (client) => {
      const prior = await this.locked(client, accountId, comment.loopId);
      if (prior.status === 'closed') throw new LoopClosedError();
      await client.query(
        'INSERT INTO loop_comments(id,account_id,loop_id,content,author_sub,author_email,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [
          comment.id,
          accountId,
          comment.loopId,
          comment.content,
          comment.authorSub,
          comment.authorEmail ?? null,
          comment.createdAt
        ]
      );
      await client.query(
        'UPDATE loops SET version=version+1,updated_by_sub=$3,updated_at=$4 WHERE account_id=$1 AND id=$2',
        [accountId, comment.loopId, comment.authorSub, comment.createdAt]
      );
      return comment;
    });
  }
}

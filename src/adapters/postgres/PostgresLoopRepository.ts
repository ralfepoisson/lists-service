import { Pool, type PoolClient } from 'pg';

import type { LoopRepository } from '../../application/ports/LoopRepository.js';
import type { LoopComment } from '../../domain/LoopComment.js';
import { LoopClosedError, LoopNotFoundError } from '../../domain/errors.js';
import {
  Loop,
  type LoopPriority,
  type LoopStatus,
  type RelatedRecordKind
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
}

interface RelatedRecordRow {
  readonly record_kind: RelatedRecordKind;
  readonly record_id: string;
  readonly label: string;
}

interface LoopCommentRow {
  readonly id: string;
  readonly loop_id: string;
  readonly content: string;
  readonly author_sub: string;
  readonly author_email: string | null;
  readonly created_at: Date;
}

export class PostgresLoopRepository implements LoopRepository {
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async create(loop: Loop): Promise<Loop> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO loops
          (id, account_id, seed_key, title, description, priority, outcome, due_date, status, created_by_sub, updated_by_sub, created_at, updated_at, closed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
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
      await this.replaceRelatedRecords(client, loop);
      await client.query('COMMIT');
      return loop;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async createSeeded(
    accountId: string,
    seedKey: string,
    loop: Loop
  ): Promise<{ loop: Loop; created: boolean }> {
    const client = await this.pool.connect();
    let existingId: string | undefined;
    let created: boolean;
    try {
      await client.query('BEGIN');
      const inserted = await client.query<{ readonly id: string }>(
        `INSERT INTO loops
          (id, account_id, seed_key, title, description, priority, outcome, due_date, status, created_by_sub, updated_by_sub, created_at, updated_at, closed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (account_id, seed_key) DO NOTHING RETURNING id`,
        [
          loop.id,
          accountId,
          seedKey,
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
      created = inserted.rowCount === 1;
      if (!created) {
        const existing = await client.query<{ readonly id: string }>(
          'SELECT id FROM loops WHERE account_id = $1 AND seed_key = $2',
          [accountId, seedKey]
        );
        existingId = existing.rows[0]?.id;
        if (!existingId) throw new Error('Seed identity conflict could not be resolved.');
      }
      const loopId = created ? loop.id : existingId!;
      for (const record of loop.relatedRecords) {
        await client.query(
          `INSERT INTO loop_related_records (loop_id, record_kind, record_id, label, ordinal)
           VALUES ($1, $2, $3, $4, (SELECT COALESCE(MAX(ordinal) + 1, 0) FROM loop_related_records WHERE loop_id = $1))
           ON CONFLICT (loop_id, record_kind, record_id) DO NOTHING`,
          [loopId, record.kind, record.recordId, record.label]
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    if (!created && existingId) {
      const existing = await this.findById(accountId, existingId);
      if (!existing) throw new Error('Seeded Loop disappeared after reconciliation.');
      return { loop: existing, created: false };
    }
    return { loop, created };
  }

  async findById(accountId: string, id: string): Promise<Loop | undefined> {
    const result = await this.pool.query<LoopRow>(
      `SELECT id, account_id, seed_key, title, description, priority, outcome, due_date::text AS due_date, status, created_by_sub, updated_by_sub,
              created_at, updated_at, closed_at
         FROM loops WHERE account_id = $1 AND id = $2`,
      [accountId, id]
    );
    const row = result.rows[0];
    return row === undefined ? undefined : this.toLoop(row);
  }

  async list(accountId: string, status: 'open' | 'closed' | 'all'): Promise<Loop[]> {
    const result = await this.pool.query<LoopRow>(
      `SELECT id, account_id, seed_key, title, description, priority, outcome, due_date::text AS due_date, status, created_by_sub, updated_by_sub,
              created_at, updated_at, closed_at
         FROM loops
        WHERE account_id = $1 AND ($2 = 'all' OR status = $2)
        ORDER BY CASE WHEN status = 'open' THEN 0 ELSE 1 END,
                 due_date ASC NULLS LAST, created_at DESC`,
      [accountId, status]
    );
    return Promise.all(result.rows.map((row) => this.toLoop(row)));
  }

  async save(loop: Loop): Promise<Loop> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE loops
            SET title = $3, description = $4, priority = $5, outcome = $6, due_date = $7, status = $8, updated_by_sub = $9,
                updated_at = $10, closed_at = $11
          WHERE account_id = $1 AND id = $2`,
        [
          loop.accountId,
          loop.id,
          loop.title,
          loop.description ?? null,
          loop.priority,
          loop.outcome,
          loop.dueDate ?? null,
          loop.status,
          loop.updatedBySub,
          loop.updatedAt,
          loop.closedAt ?? null
        ]
      );
      if (result.rowCount !== 1) throw new Error('Loop no longer exists.');
      await client.query('DELETE FROM loop_related_records WHERE loop_id = $1', [loop.id]);
      await this.replaceRelatedRecords(client, loop);
      await client.query('COMMIT');
      return loop;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
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
      `SELECT id, loop_id, content, author_sub, author_email, created_at FROM loop_comments
        WHERE account_id = $1 AND loop_id = $2 ORDER BY ordinal`,
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
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Serialize with Loop updates so closing cannot race past the writable check.
      const result = await client.query<{ readonly status: LoopStatus }>(
        'SELECT status FROM loops WHERE account_id = $1 AND id = $2 FOR UPDATE',
        [accountId, comment.loopId]
      );
      const loop = result.rows[0];
      if (loop === undefined) throw new LoopNotFoundError();
      if (loop.status === 'closed') throw new LoopClosedError();
      await client.query(
        `INSERT INTO loop_comments (id, account_id, loop_id, content, author_sub, author_email, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
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
      await client.query('COMMIT');
      return comment;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async toLoop(row: LoopRow): Promise<Loop> {
    const records = await this.pool.query<RelatedRecordRow>(
      `SELECT record_kind, record_id, label
         FROM loop_related_records WHERE loop_id = $1 ORDER BY ordinal ASC`,
      [row.id]
    );
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
      relatedRecords: records.rows.map((record) => ({
        kind: record.record_kind,
        recordId: record.record_id,
        label: record.label
      })),
      createdBySub: row.created_by_sub,
      updatedBySub: row.updated_by_sub,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      closedAt: row.closed_at ?? undefined
    });
  }

  private async replaceRelatedRecords(client: PoolClient, loop: Loop): Promise<void> {
    await Promise.all(
      loop.relatedRecords.map((record, ordinal) =>
        client.query(
          `INSERT INTO loop_related_records (loop_id, record_kind, record_id, label, ordinal)
           VALUES ($1, $2, $3, $4, $5)`,
          [loop.id, record.kind, record.recordId, record.label, ordinal]
        )
      )
    );
  }
}

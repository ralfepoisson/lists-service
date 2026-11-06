import type { LoopRepository } from '../../src/application/ports/LoopRepository.js';
import {
  Loop,
  type LoopPatch,
  type CalendarReferenceAppend,
  type LoopAppendResult
} from '../../src/domain/Loop.js';
import type { LoopComment } from '../../src/domain/LoopComment.js';

import {
  LoopClosedError,
  LoopNotFoundError,
  LoopVersionConflictError,
  ValidationError
} from '../../src/domain/errors.js';

export class InMemoryLoopRepository implements LoopRepository {
  readonly loops: Loop[] = [];
  readonly comments: { accountId: string; comment: LoopComment }[] = [];

  async listComments(accountId: string, loopId: string): Promise<LoopComment[]> {
    return this.comments
      .filter((entry) => entry.accountId === accountId && entry.comment.loopId === loopId)
      .map((entry) => entry.comment);
  }

  async addComment(accountId: string, comment: LoopComment): Promise<LoopComment> {
    const prior = this.owned(accountId, comment.loopId);
    if (prior.status === 'closed') throw new LoopClosedError();
    this.comments.push({ accountId, comment });
    this.loops[this.loops.indexOf(prior)] = new Loop({
      ...prior,
      version: prior.version + 1,
      updatedBySub: comment.authorSub,
      updatedAt: comment.createdAt
    });
    return comment;
  }

  async create(loop: Loop): Promise<Loop> {
    this.loops.push(loop);
    return loop;
  }

  async createSeeded(
    accountId: string,
    seedKey: string,
    loop: Loop
  ): Promise<{ loop: Loop; created: boolean }> {
    const existing = this.loops.find(
      (candidate) => candidate.accountId === accountId && candidate.seedKey === seedKey
    );
    if (existing) {
      const additions = loop.relatedRecords.filter(
        (r) => !existing.relatedRecords.some((v) => v.kind === r.kind && v.recordId === r.recordId)
      );
      if (additions.length && existing.status === 'closed') throw new LoopClosedError();
      return {
        loop: additions.length
          ? this.replace(
              existing,
              new Loop({
                ...existing,
                relatedRecords: [...existing.relatedRecords, ...additions],
                updatedAt: loop.updatedAt,
                updatedBySub: loop.updatedBySub
              })
            )
          : existing,
        created: false
      };
    }
    this.loops.push(loop);
    return { loop, created: true };
  }

  async findById(accountId: string, id: string): Promise<Loop | undefined> {
    return this.loops.find((loop) => loop.accountId === accountId && loop.id === id);
  }

  async list(
    accountId: string,
    status: 'open' | 'closed' | 'all',
    search?: { readonly query: string; readonly limit: number }
  ): Promise<Loop[]> {
    const rows = this.loops.filter(
      (loop) => loop.accountId === accountId && (status === 'all' || loop.status === status)
    );
    return search
      ? rows
          .filter((loop) =>
            [loop.title, loop.description, loop.outcome]
              .join(' ')
              .toLowerCase()
              .includes(search.query.toLowerCase())
          )
          .slice(0, search.limit)
      : rows;
  }

  private owned(accountId: string, id: string): Loop {
    const loop = this.loops.find((x) => x.accountId === accountId && x.id === id);
    if (!loop) throw new LoopNotFoundError();
    return loop;
  }
  private replace(prior: Loop, next: Loop): Loop {
    const visible = (x: Loop): string =>
      JSON.stringify([
        x.title,
        x.description,
        x.priority,
        x.outcome,
        x.dueDate,
        x.status,
        x.relatedRecords.map((r) => [r.kind, r.recordId, r.label])
      ]);
    if (visible(prior) === visible(next)) return prior;
    const value = new Loop({ ...next, version: prior.version + 1 });
    this.loops[this.loops.indexOf(prior)] = value;
    return value;
  }
  async save(loop: Loop): Promise<Loop> {
    const prior = this.owned(loop.accountId, loop.id);
    if (prior.version !== loop.version) throw new LoopVersionConflictError();
    return this.replace(prior, loop);
  }
  async patch(
    accountId: string,
    id: string,
    sub: string,
    patch: LoopPatch,
    now: Date
  ): Promise<Loop> {
    const prior = this.owned(accountId, id);
    if (prior.status === 'closed') throw new LoopClosedError();
    const { expectedVersion, ...fields } = patch;
    if (patch.relatedRecords !== undefined && expectedVersion === undefined)
      throw new ValidationError('Replacing relatedRecords requires expectedVersion.');
    if (expectedVersion !== undefined && expectedVersion !== prior.version)
      throw new LoopVersionConflictError();
    return this.replace(
      prior,
      new Loop({
        ...prior,
        ...fields,
        description:
          patch.description === null ? undefined : (patch.description ?? prior.description),
        dueDate: patch.dueDate === null ? undefined : (patch.dueDate ?? prior.dueDate),
        updatedBySub: sub,
        updatedAt: now
      })
    );
  }
  async closeLoop(accountId: string, id: string, sub: string, now: Date): Promise<Loop> {
    const prior = this.owned(accountId, id);
    return prior.status === 'closed'
      ? prior
      : this.replace(
          prior,
          new Loop({ ...prior, status: 'closed', closedAt: now, updatedBySub: sub, updatedAt: now })
        );
  }
  private readonly receipts = new Map<string, { binding: string; version: number }>();
  async appendReference(
    accountId: string,
    id: string,
    sub: string,
    input: CalendarReferenceAppend,
    now: Date
  ): Promise<LoopAppendResult> {
    const key = JSON.stringify([accountId, input.operationId]),
      binding = JSON.stringify([
        id,
        input.eventId,
        input.record.kind,
        input.record.recordId,
        input.record.label
      ]);
    const prior = this.owned(accountId, id),
      receipt = this.receipts.get(key);
    if (receipt && receipt.binding !== binding) throw new LoopVersionConflictError();
    const present = prior.relatedRecords.some(
      (r) => r.kind === input.record.kind && r.recordId === input.record.recordId
    );
    if (receipt)
      return {
        loop: prior,
        appended: false,
        replayed: true,
        referencePresent: present,
        appliedVersion: receipt.version
      };
    if (input.expectedVersion !== undefined && input.expectedVersion !== prior.version)
      throw new LoopVersionConflictError(
        'Loop changed before the Calendar association was applied.'
      );
    if (prior.status === 'closed') throw new LoopClosedError();
    const loop = present
      ? prior
      : this.replace(
          prior,
          new Loop({
            ...prior,
            relatedRecords: [...prior.relatedRecords, input.record],
            updatedBySub: sub,
            updatedAt: now
          })
        );
    this.receipts.set(key, { binding, version: loop.version });
    return {
      loop,
      appended: !present,
      replayed: false,
      referencePresent: true,
      appliedVersion: loop.version
    };
  }

  async isReady(): Promise<boolean> {
    return true;
  }
}

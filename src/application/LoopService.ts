import { randomUUID } from 'node:crypto';

import type {
  CalendarReferenceAppend,
  Loop,
  LoopAppendResult,
  LoopPatch,
  LoopPriority,
  RelatedRecord,
  RelatedRecordKind
} from '../domain/Loop.js';
import { Loop as LoopRecord } from '../domain/Loop.js';
import { LoopClosedError, LoopNotFoundError, ValidationError } from '../domain/errors.js';
import type { LoopComment } from '../domain/LoopComment.js';
import type { LoopRepository } from './ports/LoopRepository.js';

export interface CreateLoopInput {
  readonly title: string;
  readonly description?: string;
  readonly priority?: LoopPriority;
  readonly outcome: string;
  readonly dueDate?: string;
  readonly relatedRecords?: readonly RelatedRecord[];
}

export interface UpdateLoopInput {
  readonly expectedVersion?: number;
  readonly title?: string;
  readonly description?: string | null;
  readonly priority?: LoopPriority;
  readonly outcome?: string;
  readonly dueDate?: string | null;
  readonly relatedRecords?: readonly RelatedRecord[];
}

export interface SeedLoopInput {
  readonly seedKey: string;
  readonly title: string;
  readonly description: string;
  readonly outcome: string;
  readonly dueDate?: string;
  readonly relatedRecords?: readonly RelatedRecord[];
}

type IdentifierFactory = () => string;
type Clock = () => Date;

export class LoopService {
  constructor(
    private readonly repository: LoopRepository,
    private readonly identifiers: IdentifierFactory = randomUUID,
    private readonly clock: Clock = () => new Date()
  ) {}

  async create(accountId: string, sub: string, input: CreateLoopInput): Promise<Loop> {
    const now = this.clock();
    return this.repository.create(
      new LoopRecord({
        id: this.identifiers(),
        accountId,
        title: this.requiredText(input.title, 'title', 160),
        description: this.optionalText(input.description, 'description', 2_000),
        priority: this.priority(input.priority),
        outcome: this.requiredText(input.outcome, 'outcome', 2_000),
        dueDate: this.optionalDate(input.dueDate),
        status: 'open',
        relatedRecords: this.relatedRecords(input.relatedRecords ?? []),
        createdBySub: sub,
        updatedBySub: sub,
        createdAt: now,
        updatedAt: now,
        closedAt: undefined
      })
    );
  }

  async createSeeded(
    accountId: string,
    sub: string,
    input: SeedLoopInput
  ): Promise<{ loop: Loop; created: boolean }> {
    const seedKey = this.requiredText(input.seedKey, 'seedKey', 128);
    const now = this.clock();
    const loop = new LoopRecord({
      id: this.identifiers(),
      accountId,
      seedKey,
      title: this.requiredText(input.title, 'title', 160),
      description: this.optionalText(input.description, 'description', 2_000),
      priority: 'medium',
      outcome: this.requiredText(input.outcome, 'outcome', 2_000),
      dueDate: this.optionalDate(input.dueDate),
      status: 'open',
      relatedRecords: this.relatedRecords(input.relatedRecords ?? []),
      createdBySub: sub,
      updatedBySub: sub,
      createdAt: now,
      updatedAt: now,
      closedAt: undefined
    });
    return this.repository.createSeeded(accountId, seedKey, loop);
  }

  async list(accountId: string, status: 'open' | 'closed' | 'all'): Promise<Loop[]> {
    return this.repository.list(accountId, status);
  }

  async searchCalendarContext(accountId: string, query: string, limit: number): Promise<Loop[]> {
    if (
      typeof query !== 'string' ||
      query.trim().length < 2 ||
      query.trim().length > 120 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 5
    )
      throw new ValidationError('Calendar Loop search requires a literal query and limit1–5.');
    return this.repository.list(accountId, 'open', { query: query.trim(), limit });
  }

  async get(accountId: string, id: string): Promise<Loop> {
    const loop = await this.repository.findById(accountId, id);
    if (loop === undefined) throw new LoopNotFoundError();
    return loop;
  }

  async update(accountId: string, sub: string, id: string, input: UpdateLoopInput): Promise<Loop> {
    const patch: LoopPatch = {
      ...(input.title === undefined ? {} : { title: this.requiredText(input.title, 'title', 160) }),
      ...(input.description === undefined
        ? {}
        : {
            description:
              input.description === null
                ? null
                : this.optionalText(input.description, 'description', 2_000)!
          }),
      ...(input.priority === undefined ? {} : { priority: this.priority(input.priority) }),
      ...(input.outcome === undefined
        ? {}
        : { outcome: this.requiredText(input.outcome, 'outcome', 2_000) }),
      ...(input.dueDate === undefined
        ? {}
        : { dueDate: input.dueDate === null ? null : this.optionalDate(input.dueDate)! }),
      ...(input.relatedRecords === undefined
        ? {}
        : { relatedRecords: this.relatedRecords(input.relatedRecords) }),
      ...(input.expectedVersion === undefined ? {} : { expectedVersion: input.expectedVersion })
    };
    if (Object.keys(patch).filter((key) => key !== 'expectedVersion').length === 0)
      throw new ValidationError('At least one loop field must be provided.');
    if (
      input.expectedVersion !== undefined &&
      (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1)
    )
      throw new ValidationError('expectedVersion must be a positive integer.');
    if (input.relatedRecords !== undefined && input.expectedVersion === undefined)
      throw new ValidationError('Replacing relatedRecords requires expectedVersion.');
    return this.repository.patch(accountId, id, sub, patch, this.clock());
  }

  async listComments(accountId: string, id: string): Promise<LoopComment[]> {
    await this.get(accountId, id);
    return this.repository.listComments(accountId, id);
  }

  async addComment(
    accountId: string,
    sub: string,
    id: string,
    content: string,
    authorEmail?: string
  ): Promise<LoopComment> {
    const validatedContent = this.requiredText(content, 'content', 4_000);
    const loop = await this.get(accountId, id);
    if (loop.status === 'closed') throw new LoopClosedError();
    return this.repository.addComment(accountId, {
      id: this.identifiers(),
      loopId: id,
      content: validatedContent,
      authorSub: sub,
      ...(authorEmail === undefined ? {} : { authorEmail }),
      createdAt: this.clock()
    });
  }

  async close(accountId: string, sub: string, id: string, confirmed: boolean): Promise<Loop> {
    if (confirmed !== true) {
      throw new ValidationError(
        'Closing a loop requires confirming that its outcome has happened.'
      );
    }
    return this.repository.closeLoop(accountId, id, sub, this.clock());
  }

  async appendReference(
    accountId: string,
    sub: string,
    id: string,
    input: CalendarReferenceAppend
  ): Promise<LoopAppendResult> {
    if (
      input.expectedVersion !== undefined &&
      (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1)
    )
      throw new ValidationError('expectedVersion must be a positive integer.');
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
    if (!uuid.test(input.operationId) || !uuid.test(input.eventId))
      throw new ValidationError('Canonical operation and Calendar event UUIDs are required.');
    const eventId = input.eventId.toLowerCase();
    if (
      input.record.kind !== 'appointment' ||
      input.record.recordId !== `calendar:${eventId}` ||
      input.record.label !== 'Calendar event'
    )
      throw new ValidationError('Only the fixed Calendar event reference is permitted.');
    return this.repository.appendReference(
      accountId,
      id,
      sub,
      { ...input, eventId, operationId: input.operationId.toLowerCase() },
      this.clock()
    );
  }

  private requiredText(value: string, name: string, maximumLength: number): string {
    if (typeof value !== 'string') throw new ValidationError(`${name} must be a string.`);
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.length > maximumLength) {
      throw new ValidationError(`${name} must contain 1 to ${maximumLength} characters.`);
    }
    return trimmed;
  }

  private optionalDate(value: string | undefined): string | undefined {
    if (value === undefined) return undefined;
    const parsed = Date.parse(`${value}T00:00:00Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/u.test(value) ||
      Number.isNaN(parsed) ||
      new Date(parsed).toISOString().slice(0, 10) !== value
    ) {
      throw new ValidationError('dueDate must be an ISO calendar date (YYYY-MM-DD).');
    }
    return value;
  }

  private optionalText(
    value: string | undefined,
    name: string,
    maximumLength: number
  ): string | undefined {
    if (value === undefined) return undefined;
    return this.requiredText(value, name, maximumLength);
  }

  private priority(value: LoopPriority | undefined): LoopPriority {
    const priority = value ?? 'medium';
    if (!['high', 'medium', 'low'].includes(priority)) {
      throw new ValidationError('priority must be high, medium, or low.');
    }
    return priority;
  }

  private relatedRecords(records: readonly RelatedRecord[]): readonly RelatedRecord[] {
    if (!Array.isArray(records)) throw new ValidationError('relatedRecords must be an array.');
    if (records.length > 100)
      throw new ValidationError('A loop can reference at most 100 records.');
    const keys = new Set<string>();
    return records.map((record) => {
      if (!this.isRelatedRecordKind(record.kind)) {
        throw new ValidationError(
          'relatedRecords.kind must be task, appointment, email, document, entity, asset, or other.'
        );
      }
      const recordId = this.requiredText(record.recordId, 'relatedRecords.recordId', 256);
      const label = this.requiredText(record.label, 'relatedRecords.label', 256);
      const key = `${record.kind}:${recordId}`;
      if (keys.has(key))
        throw new ValidationError('relatedRecords must not contain duplicate references.');
      keys.add(key);
      return { kind: record.kind, recordId, label };
    });
  }

  private isRelatedRecordKind(value: string): value is RelatedRecordKind {
    return ['task', 'appointment', 'email', 'document', 'entity', 'asset', 'other'].includes(value);
  }
}

import { randomUUID } from 'node:crypto';

import type { Loop, LoopPriority, RelatedRecord, RelatedRecordKind } from '../domain/Loop.js';
import { Loop as LoopRecord } from '../domain/Loop.js';
import { LoopNotFoundError, ValidationError } from '../domain/errors.js';
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
  readonly title?: string;
  readonly description?: string | null;
  readonly priority?: LoopPriority;
  readonly outcome?: string;
  readonly dueDate?: string | null;
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

  async list(accountId: string, status: 'open' | 'closed' | 'all'): Promise<Loop[]> {
    return this.repository.list(accountId, status);
  }

  async get(accountId: string, id: string): Promise<Loop> {
    const loop = await this.repository.findById(accountId, id);
    if (loop === undefined) throw new LoopNotFoundError();
    return loop;
  }

  async update(accountId: string, sub: string, id: string, input: UpdateLoopInput): Promise<Loop> {
    const existing = await this.get(accountId, id);
    if (existing.status === 'closed') {
      throw new ValidationError('Closed loops cannot be updated.');
    }
    if (Object.keys(input).length === 0) {
      throw new ValidationError('At least one loop field must be provided.');
    }
    return this.repository.save(
      new LoopRecord({
        ...existing,
        title:
          input.title === undefined ? existing.title : this.requiredText(input.title, 'title', 160),
        description:
          input.description === undefined
            ? existing.description
            : input.description === null
              ? undefined
              : this.optionalText(input.description, 'description', 2_000),
        priority: input.priority === undefined ? existing.priority : this.priority(input.priority),
        outcome:
          input.outcome === undefined
            ? existing.outcome
            : this.requiredText(input.outcome, 'outcome', 2_000),
        dueDate:
          input.dueDate === undefined
            ? existing.dueDate
            : input.dueDate === null
              ? undefined
              : this.optionalDate(input.dueDate),
        relatedRecords:
          input.relatedRecords === undefined
            ? existing.relatedRecords
            : this.relatedRecords(input.relatedRecords),
        updatedBySub: sub,
        updatedAt: this.clock()
      })
    );
  }

  async close(accountId: string, sub: string, id: string, confirmed: boolean): Promise<Loop> {
    if (!confirmed) {
      throw new ValidationError(
        'Closing a loop requires confirming that its outcome has happened.'
      );
    }
    const existing = await this.get(accountId, id);
    if (existing.status === 'closed') return existing;
    const now = this.clock();
    return this.repository.save(
      new LoopRecord({
        ...existing,
        status: 'closed',
        updatedBySub: sub,
        updatedAt: now,
        closedAt: now
      })
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
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
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
    if (records.length > 100)
      throw new ValidationError('A loop can reference at most 100 records.');
    const keys = new Set<string>();
    return records.map((record) => {
      if (!this.isRelatedRecordKind(record.kind)) {
        throw new ValidationError(
          'relatedRecords.kind must be task, appointment, email, document, entity, or other.'
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
    return ['task', 'appointment', 'email', 'document', 'entity', 'other'].includes(value);
  }
}

export type LoopStatus = 'open' | 'closed';
export type LoopPriority = 'high' | 'medium' | 'low';

export type RelatedRecordKind =
  'task' | 'appointment' | 'email' | 'document' | 'entity' | 'asset' | 'other';

export interface RelatedRecord {
  readonly kind: RelatedRecordKind;
  readonly recordId: string;
  readonly label: string;
}

export interface LoopAttributes {
  readonly version?: number;
  readonly id: string;
  readonly accountId: string;
  readonly seedKey?: string;
  readonly title: string;
  readonly description: string | undefined;
  readonly priority: LoopPriority;
  readonly outcome: string;
  readonly dueDate: string | undefined;
  readonly status: LoopStatus;
  readonly relatedRecords: readonly RelatedRecord[];
  readonly createdBySub: string;
  readonly updatedBySub: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly closedAt: Date | undefined;
}

export class Loop implements LoopAttributes {
  readonly version: number;
  readonly id!: string;
  readonly accountId!: string;
  readonly seedKey?: string;
  readonly title!: string;
  readonly description!: string | undefined;
  readonly priority!: LoopPriority;
  readonly outcome!: string;
  readonly dueDate!: string | undefined;
  readonly status!: LoopStatus;
  readonly relatedRecords!: readonly RelatedRecord[];
  readonly createdBySub!: string;
  readonly updatedBySub!: string;
  readonly createdAt!: Date;
  readonly updatedAt!: Date;
  readonly closedAt!: Date | undefined;

  constructor(attributes: LoopAttributes) {
    Object.assign(this, attributes);
    this.version = attributes.version ?? 1;
  }
}

export interface LoopPatch {
  readonly title?: string;
  readonly description?: string | null;
  readonly priority?: LoopPriority;
  readonly outcome?: string;
  readonly dueDate?: string | null;
  readonly relatedRecords?: readonly RelatedRecord[];
  readonly expectedVersion?: number;
}

export interface CalendarReferenceAppend {
  readonly expectedVersion?: number;
  readonly operationId: string;
  readonly eventId: string;
  readonly record: RelatedRecord;
}

export interface LoopAppendResult {
  readonly loop: Loop;
  readonly appended: boolean;
  readonly replayed: boolean;
  readonly referencePresent: boolean;
  readonly appliedVersion: number;
}

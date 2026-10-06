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
  }
}

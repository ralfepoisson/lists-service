import type {
  CalendarReferenceAppend,
  Loop,
  LoopAppendResult,
  LoopPatch
} from '../../domain/Loop.js';
import type { LoopComment } from '../../domain/LoopComment.js';

export interface LoopRepository {
  create(loop: Loop): Promise<Loop>;
  createSeeded(
    accountId: string,
    seedKey: string,
    loop: Loop
  ): Promise<{ loop: Loop; created: boolean }>;
  findById(accountId: string, id: string): Promise<Loop | undefined>;
  list(
    accountId: string,
    status: 'open' | 'closed' | 'all',
    search?: { readonly query: string; readonly limit: number }
  ): Promise<Loop[]>;
  save(loop: Loop): Promise<Loop>;
  patch(accountId: string, id: string, sub: string, patch: LoopPatch, now: Date): Promise<Loop>;
  closeLoop(accountId: string, id: string, sub: string, now: Date): Promise<Loop>;
  appendReference(
    accountId: string,
    id: string,
    sub: string,
    input: CalendarReferenceAppend,
    now: Date
  ): Promise<LoopAppendResult>;
  listComments(accountId: string, loopId: string): Promise<LoopComment[]>;
  addComment(accountId: string, comment: LoopComment): Promise<LoopComment>;
  isReady(): Promise<boolean>;
}

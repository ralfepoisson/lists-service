import type { Loop } from '../../domain/Loop.js';
import type { LoopComment } from '../../domain/LoopComment.js';

export interface LoopRepository {
  create(loop: Loop): Promise<Loop>;
  createSeeded(
    accountId: string,
    seedKey: string,
    loop: Loop
  ): Promise<{ loop: Loop; created: boolean }>;
  findById(accountId: string, id: string): Promise<Loop | undefined>;
  list(accountId: string, status: 'open' | 'closed' | 'all'): Promise<Loop[]>;
  save(loop: Loop): Promise<Loop>;
  listComments(accountId: string, loopId: string): Promise<LoopComment[]>;
  addComment(accountId: string, comment: LoopComment): Promise<LoopComment>;
  isReady(): Promise<boolean>;
}

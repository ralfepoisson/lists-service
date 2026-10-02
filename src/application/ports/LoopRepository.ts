import type { Loop } from '../../domain/Loop.js';

export interface LoopRepository {
  create(loop: Loop): Promise<Loop>;
  findById(accountId: string, id: string): Promise<Loop | undefined>;
  list(accountId: string, status: 'open' | 'closed' | 'all'): Promise<Loop[]>;
  save(loop: Loop): Promise<Loop>;
  isReady(): Promise<boolean>;
}

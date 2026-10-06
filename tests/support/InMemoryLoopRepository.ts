import type { LoopRepository } from '../../src/application/ports/LoopRepository.js';
import type { Loop } from '../../src/domain/Loop.js';
import type { LoopComment } from '../../src/domain/LoopComment.js';

export class InMemoryLoopRepository implements LoopRepository {
  readonly loops: Loop[] = [];
  readonly comments: { accountId: string; comment: LoopComment }[] = [];

  async listComments(accountId: string, loopId: string): Promise<LoopComment[]> {
    return this.comments
      .filter((entry) => entry.accountId === accountId && entry.comment.loopId === loopId)
      .map((entry) => entry.comment);
  }

  async addComment(accountId: string, comment: LoopComment): Promise<LoopComment> {
    this.comments.push({ accountId, comment });
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
    if (existing) return { loop: existing, created: false };
    this.loops.push(loop);
    return { loop, created: true };
  }

  async findById(accountId: string, id: string): Promise<Loop | undefined> {
    return this.loops.find((loop) => loop.accountId === accountId && loop.id === id);
  }

  async list(accountId: string, status: 'open' | 'closed' | 'all'): Promise<Loop[]> {
    return this.loops.filter(
      (loop) => loop.accountId === accountId && (status === 'all' || loop.status === status)
    );
  }

  async save(loop: Loop): Promise<Loop> {
    const index = this.loops.findIndex((candidate) => candidate.id === loop.id);
    this.loops[index] = loop;
    return loop;
  }

  async isReady(): Promise<boolean> {
    return true;
  }
}

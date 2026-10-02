import type { LoopRepository } from '../../src/application/ports/LoopRepository.js';
import type { Loop } from '../../src/domain/Loop.js';

export class InMemoryLoopRepository implements LoopRepository {
  readonly loops: Loop[] = [];

  async create(loop: Loop): Promise<Loop> {
    this.loops.push(loop);
    return loop;
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

import type {
  ItemStatus,
  ShoppingListRepository
} from '../../application/ports/ShoppingListRepository.js';
import { UpstreamError } from '../../domain/errors.js';
import { ShoppingListItem } from '../../domain/ShoppingListItem.js';
import type { TodoistClient } from './TodoistClient.js';

export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

interface TodoistTask {
  readonly id: string;
  readonly project_id: string;
  readonly content: string;
  readonly description?: string;
  readonly added_at?: string;
  readonly completed_at?: string;
}

export class TodoistShoppingListRepository implements ShoppingListRepository {
  constructor(
    private readonly client: TodoistClient,
    private readonly projectId: string,
    private readonly completedLookbackDays: number,
    private readonly clock: Clock = new SystemClock()
  ) {}

  async list(status: ItemStatus): Promise<ShoppingListItem[]> {
    if (status === 'active') {
      return this.listActive();
    }
    if (status === 'completed') {
      return this.listCompleted();
    }
    const [activeItems, completedItems] = await Promise.all([
      this.listActive(),
      this.listCompleted()
    ]);
    return [...activeItems, ...completedItems];
  }

  async add(content: string): Promise<ShoppingListItem> {
    const payload = await this.client.post('/tasks', {
      content,
      project_id: this.projectId
    });
    return this.mapTask(this.parseTask(payload), false);
  }

  async delete(itemId: string): Promise<void> {
    await this.client.delete(`/tasks/${encodeURIComponent(itemId)}`);
  }

  async complete(itemId: string): Promise<void> {
    await this.client.post(`/tasks/${encodeURIComponent(itemId)}/close`);
  }

  async reopen(itemId: string): Promise<void> {
    await this.client.post(`/tasks/${encodeURIComponent(itemId)}/reopen`);
  }

  async isReady(): Promise<boolean> {
    await this.client.get('/tasks', { project_id: this.projectId, limit: '1' });
    return true;
  }

  private async listActive(): Promise<ShoppingListItem[]> {
    const tasks = await this.collectPages('/tasks', 'results', {
      project_id: this.projectId,
      limit: '200'
    });
    return tasks.map((task) => this.mapTask(task, false));
  }

  private async listCompleted(): Promise<ShoppingListItem[]> {
    const until = this.clock.now();
    const since = new Date(until);
    since.setUTCDate(since.getUTCDate() - this.completedLookbackDays);
    const tasks = await this.collectPages('/tasks/completed/by_completion_date', 'items', {
      project_id: this.projectId,
      since: since.toISOString(),
      until: until.toISOString(),
      limit: '200'
    });
    return tasks.map((task) => this.mapTask(task, true));
  }

  private async collectPages(
    path: string,
    collectionProperty: 'items' | 'results',
    baseQuery: Readonly<Record<string, string>>
  ): Promise<TodoistTask[]> {
    const tasks: TodoistTask[] = [];
    let cursor: string | undefined;
    do {
      const payload = await this.client.get(path, {
        ...baseQuery,
        ...(cursor === undefined ? {} : { cursor })
      });
      const page = this.parsePage(payload, collectionProperty);
      tasks.push(...page.tasks);
      cursor = page.nextCursor;
    } while (cursor !== undefined);
    return tasks;
  }

  private parsePage(
    payload: unknown,
    collectionProperty: 'items' | 'results'
  ): { tasks: TodoistTask[]; nextCursor: string | undefined } {
    if (!this.isRecord(payload) || !Array.isArray(payload[collectionProperty])) {
      throw this.malformedResponse();
    }
    const tasks = payload[collectionProperty].map((task) => this.parseTask(task));
    const nextCursor = payload['next_cursor'];
    if (nextCursor !== null && nextCursor !== undefined && typeof nextCursor !== 'string') {
      throw this.malformedResponse();
    }
    return { tasks, nextCursor: nextCursor ?? undefined };
  }

  private parseTask(payload: unknown): TodoistTask {
    if (
      !this.isRecord(payload) ||
      typeof payload['id'] !== 'string' ||
      typeof payload['project_id'] !== 'string' ||
      typeof payload['content'] !== 'string'
    ) {
      throw this.malformedResponse();
    }
    return {
      id: payload['id'],
      project_id: payload['project_id'],
      content: payload['content'],
      ...(typeof payload['description'] === 'string'
        ? { description: payload['description'] }
        : {}),
      ...(typeof payload['added_at'] === 'string' ? { added_at: payload['added_at'] } : {}),
      ...(typeof payload['completed_at'] === 'string'
        ? { completed_at: payload['completed_at'] }
        : {})
    };
  }

  private mapTask(task: TodoistTask, isCompleted: boolean): ShoppingListItem {
    return new ShoppingListItem(
      task.id,
      task.content,
      isCompleted,
      task.description,
      task.added_at,
      task.completed_at
    );
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private malformedResponse(): UpstreamError {
    return new UpstreamError('UPSTREAM_UNAVAILABLE', 'Todoist returned a malformed response.');
  }
}

import { randomUUID } from 'node:crypto';

import type {
  TaskListRepository,
  TaskPosition,
  TaskStatus
} from '../../application/ports/TaskListRepository.js';
import {
  TaskListNotFoundError,
  TaskNotFoundError,
  UpstreamError,
  ValidationError
} from '../../domain/errors.js';
import { TaskList } from '../../domain/TaskList.js';
import { TaskListTask } from '../../domain/TaskListTask.js';
import type { Clock } from './TodoistShoppingListRepository.js';
import { SystemClock } from './TodoistShoppingListRepository.js';
import type { TodoistClient } from './TodoistClient.js';

interface TodoistSection {
  readonly id: string;
  readonly project_id: string;
  readonly name: string;
}

interface TodoistTask {
  readonly id: string;
  readonly project_id: string;
  readonly section_id: string;
  readonly content: string;
  readonly child_order: number;
}

export class TodoistTaskListRepository implements TaskListRepository {
  constructor(
    private readonly client: TodoistClient,
    private readonly projectId: string,
    private readonly completedLookbackDays: number,
    private readonly clock: Clock = new SystemClock(),
    private readonly uuidFactory: () => string = randomUUID
  ) {}

  async listTaskLists(): Promise<TaskList[]> {
    const sections = await this.collectPages<TodoistSection>(
      '/sections',
      { project_id: this.projectId, limit: '200' },
      (value) => this.parseSection(value)
    );
    return sections.map((section) => new TaskList(section.id, section.name));
  }

  async createTaskList(name: string): Promise<TaskList> {
    const payload = await this.client.post('/sections', { name, project_id: this.projectId });
    const section = this.parseSection(payload);
    if (section.project_id !== this.projectId) throw this.malformedResponse();
    return new TaskList(section.id, section.name);
  }

  async archiveTaskList(listId: string): Promise<void> {
    await this.requireList(listId);
    await this.client.post(`/sections/${encodeURIComponent(listId)}/archive`);
  }

  async listTasks(listId: string, status: TaskStatus): Promise<TaskListTask[]> {
    await this.requireList(listId);
    if (status === 'active') return this.listActiveTasks(listId);
    if (status === 'completed') return this.listCompletedTasks(listId);
    const [active, completed] = await Promise.all([
      this.listActiveTasks(listId),
      this.listCompletedTasks(listId)
    ]);
    return [...active, ...completed];
  }

  async createTask(listId: string, content: string): Promise<TaskListTask> {
    await this.requireList(listId);
    const payload = await this.client.post('/tasks', {
      content,
      project_id: this.projectId,
      section_id: listId
    });
    return this.mapTask(this.parseTask(payload), false, listId);
  }

  async updateTask(listId: string, taskId: string, content: string): Promise<TaskListTask> {
    await this.requireTask(listId, taskId);
    const payload = await this.client.post(`/tasks/${encodeURIComponent(taskId)}`, { content });
    return this.mapTask(this.parseTask(payload), false, listId);
  }

  async deleteTask(listId: string, taskId: string): Promise<void> {
    await this.requireTask(listId, taskId);
    await this.client.delete(`/tasks/${encodeURIComponent(taskId)}`);
  }

  async completeTask(listId: string, taskId: string): Promise<void> {
    await this.requireTask(listId, taskId);
    await this.client.post(`/tasks/${encodeURIComponent(taskId)}/close`);
  }

  async reorderTasks(listId: string, orderedTasks: readonly TaskPosition[]): Promise<void> {
    await this.requireList(listId);
    const activeTasks = await this.listActiveTasks(listId);
    const activeIds = new Set(activeTasks.map((task) => task.id));
    if (
      activeIds.size !== orderedTasks.length ||
      orderedTasks.some((task) => !activeIds.has(task.id))
    ) {
      throw new ValidationError('Reorder tasks must exactly match the active list tasks.');
    }
    const commandId = this.uuidFactory();
    const payload = await this.client.postForm('/sync', {
      commands: JSON.stringify([
        {
          type: 'item_reorder',
          uuid: commandId,
          args: {
            items: orderedTasks.map((task) => ({
              id: task.id,
              child_order: task.position
            }))
          }
        }
      ])
    });
    if (!this.isRecord(payload) || !this.isRecord(payload['sync_status'])) {
      throw this.malformedResponse();
    }
    if (payload['sync_status'][commandId] !== 'ok') {
      throw new UpstreamError('UPSTREAM_UNAVAILABLE', 'Todoist rejected the task reorder.');
    }
  }

  private async requireList(listId: string): Promise<TodoistSection> {
    let section: TodoistSection;
    try {
      section = this.parseSection(
        await this.client.get(`/sections/${encodeURIComponent(listId)}`, {})
      );
    } catch (error: unknown) {
      if (error instanceof TaskListNotFoundError) throw error;
      if (this.isNotFound(error)) throw new TaskListNotFoundError();
      throw error;
    }
    if (section.project_id !== this.projectId) throw new TaskListNotFoundError();
    return section;
  }

  private async requireTask(listId: string, taskId: string): Promise<TodoistTask> {
    await this.requireList(listId);
    let task: TodoistTask;
    try {
      task = this.parseTask(await this.client.get(`/tasks/${encodeURIComponent(taskId)}`, {}));
    } catch (error: unknown) {
      if (this.isNotFound(error)) throw new TaskNotFoundError();
      throw error;
    }
    if (task.project_id !== this.projectId || task.section_id !== listId) {
      throw new TaskNotFoundError();
    }
    return task;
  }

  private async listActiveTasks(listId: string): Promise<TaskListTask[]> {
    const tasks = await this.collectPages<TodoistTask>(
      '/tasks',
      { project_id: this.projectId, section_id: listId, limit: '200' },
      (value) => this.parseTask(value)
    );
    return tasks
      .map((task) => this.mapTask(task, false, listId))
      .sort((left, right) => left.position - right.position);
  }

  private async listCompletedTasks(listId: string): Promise<TaskListTask[]> {
    const until = this.clock.now();
    const since = new Date(until);
    since.setUTCDate(since.getUTCDate() - this.completedLookbackDays);
    const tasks = await this.collectPages<TodoistTask>(
      '/tasks/completed/by_completion_date',
      {
        project_id: this.projectId,
        section_id: listId,
        since: since.toISOString(),
        until: until.toISOString(),
        limit: '200'
      },
      (value) => this.parseTask(value),
      'items'
    );
    return tasks
      .map((task) => this.mapTask(task, true, listId))
      .sort((left, right) => left.position - right.position);
  }

  private async collectPages<T>(
    path: string,
    baseQuery: Readonly<Record<string, string>>,
    parser: (value: unknown) => T,
    collectionProperty: 'items' | 'results' = 'results'
  ): Promise<T[]> {
    const collected: T[] = [];
    let cursor: string | undefined;
    do {
      const payload = await this.client.get(path, {
        ...baseQuery,
        ...(cursor === undefined ? {} : { cursor })
      });
      if (!this.isRecord(payload) || !Array.isArray(payload[collectionProperty])) {
        throw this.malformedResponse();
      }
      collected.push(...payload[collectionProperty].map(parser));
      const nextCursor = payload['next_cursor'];
      if (nextCursor !== null && nextCursor !== undefined && typeof nextCursor !== 'string') {
        throw this.malformedResponse();
      }
      cursor = nextCursor ?? undefined;
    } while (cursor !== undefined);
    return collected;
  }

  private parseSection(value: unknown): TodoistSection {
    if (
      !this.isRecord(value) ||
      typeof value['id'] !== 'string' ||
      typeof value['project_id'] !== 'string' ||
      typeof value['name'] !== 'string'
    ) {
      throw this.malformedResponse();
    }
    return { id: value['id'], project_id: value['project_id'], name: value['name'] };
  }

  private parseTask(value: unknown): TodoistTask {
    if (
      !this.isRecord(value) ||
      typeof value['id'] !== 'string' ||
      typeof value['project_id'] !== 'string' ||
      typeof value['section_id'] !== 'string' ||
      typeof value['content'] !== 'string' ||
      typeof value['child_order'] !== 'number' ||
      !Number.isInteger(value['child_order'])
    ) {
      throw this.malformedResponse();
    }
    return {
      id: value['id'],
      project_id: value['project_id'],
      section_id: value['section_id'],
      content: value['content'],
      child_order: value['child_order']
    };
  }

  private mapTask(task: TodoistTask, isCompleted: boolean, listId: string): TaskListTask {
    if (task.project_id !== this.projectId || task.section_id !== listId) {
      throw new TaskNotFoundError();
    }
    return new TaskListTask(task.id, listId, task.content, isCompleted, task.child_order);
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private isNotFound(error: unknown): boolean {
    return error instanceof Error && 'httpStatus' in error && error.httpStatus === 404;
  }

  private malformedResponse(): UpstreamError {
    return new UpstreamError('UPSTREAM_UNAVAILABLE', 'Todoist returned a malformed response.');
  }
}

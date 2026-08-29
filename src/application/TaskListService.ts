import { DestructiveActionNotConfirmedError, ValidationError } from '../domain/errors.js';
import { ItemContentPolicy } from '../domain/ItemContentPolicy.js';
import type { TaskList } from '../domain/TaskList.js';
import { TaskListNamePolicy } from '../domain/TaskListNamePolicy.js';
import type { TaskListTask } from '../domain/TaskListTask.js';
import type { TaskListRepository, TaskStatus } from './ports/TaskListRepository.js';

export interface TaskListSearchHit {
  readonly kind: 'task-list' | 'task-list-task';
  readonly resourceId: string;
  readonly title: string;
  readonly summary: string;
  readonly matchedField: 'name' | 'content';
  readonly score: number;
  readonly target: {
    readonly routeName: 'task-lists';
    readonly params: Readonly<Record<string, string>>;
  };
}

export class TaskListService {
  constructor(
    private readonly repository: TaskListRepository,
    private readonly namePolicy = new TaskListNamePolicy(),
    private readonly contentPolicy = new ItemContentPolicy()
  ) {}

  async listTaskLists(): Promise<TaskList[]> {
    return this.repository.listTaskLists();
  }

  async createTaskList(rawName: string): Promise<TaskList> {
    return this.repository.createTaskList(this.namePolicy.validate(rawName));
  }

  async search(rawQuery: string, limit: number): Promise<TaskListSearchHit[]> {
    const query = rawQuery.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-GB');
    if (
      query.length < 2 ||
      query.length > 120 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 30
    ) {
      throw new ValidationError('Search query must be 2 to 120 characters and limit 1 to 30.');
    }
    const results: TaskListSearchHit[] = [];
    const lists = await this.repository.listTaskLists();
    const listsWithTasks = await Promise.all(
      lists.map(async (list) => ({
        list,
        tasks: await this.repository.listTasks(list.id, 'active')
      }))
    );
    for (const { list, tasks } of listsWithTasks) {
      const listScore = this.matchScore(query, list.name);
      if (listScore > 0) {
        results.push({
          kind: 'task-list',
          resourceId: list.id,
          title: list.name,
          summary: 'Task list',
          matchedField: 'name',
          score: listScore,
          target: { routeName: 'task-lists', params: { listId: list.id } }
        });
      }
      for (const task of tasks) {
        const taskScore = this.matchScore(query, task.content);
        if (taskScore > 0) {
          results.push({
            kind: 'task-list-task',
            resourceId: task.id,
            title: task.content,
            summary: list.name,
            matchedField: 'content',
            score: taskScore,
            target: { routeName: 'task-lists', params: { listId: list.id, taskId: task.id } }
          });
        }
      }
    }
    return results
      .sort(
        (left, right) => right.score - left.score || left.title.localeCompare(right.title, 'en-GB')
      )
      .slice(0, limit);
  }

  async deleteTaskList(
    listId: string,
    isConfirmed: boolean
  ): Promise<{ readonly completedCount: number }> {
    const validatedListId = this.validateId(listId, 'task list');
    if (!isConfirmed) throw new DestructiveActionNotConfirmedError();
    const activeTasks = await this.repository.listTasks(validatedListId, 'active');
    for (const task of activeTasks) {
      await this.repository.completeTask(validatedListId, task.id);
    }
    await this.repository.archiveTaskList(validatedListId);
    return { completedCount: activeTasks.length };
  }

  async listTasks(listId: string, status: TaskStatus = 'active'): Promise<TaskListTask[]> {
    return this.repository.listTasks(this.validateId(listId, 'task list'), status);
  }

  async createTask(listId: string, rawContent: string): Promise<TaskListTask> {
    return this.repository.createTask(
      this.validateId(listId, 'task list'),
      this.contentPolicy.validate(rawContent)
    );
  }

  async updateTask(listId: string, taskId: string, rawContent: string): Promise<TaskListTask> {
    return this.repository.updateTask(
      this.validateId(listId, 'task list'),
      this.validateId(taskId, 'task'),
      this.contentPolicy.validate(rawContent)
    );
  }

  async deleteTask(listId: string, taskId: string): Promise<void> {
    await this.repository.deleteTask(
      this.validateId(listId, 'task list'),
      this.validateId(taskId, 'task')
    );
  }

  async completeTask(listId: string, taskId: string): Promise<void> {
    await this.repository.completeTask(
      this.validateId(listId, 'task list'),
      this.validateId(taskId, 'task')
    );
  }

  async reorderTasks(listId: string, taskIds: readonly string[]): Promise<void> {
    const validatedListId = this.validateId(listId, 'task list');
    const validatedTaskIds = taskIds.map((taskId) => this.validateId(taskId, 'task'));
    if (new Set(validatedTaskIds).size !== validatedTaskIds.length) {
      throw new ValidationError('taskIds must not contain duplicates.');
    }
    const activeTasks = await this.repository.listTasks(validatedListId, 'active');
    const activeIds = new Set(activeTasks.map((task) => task.id));
    if (
      validatedTaskIds.length !== activeIds.size ||
      validatedTaskIds.some((taskId) => !activeIds.has(taskId))
    ) {
      throw new ValidationError('taskIds must be an exact permutation of all active list tasks.');
    }
    await this.repository.reorderTasks(
      validatedListId,
      validatedTaskIds.map((id, index) => ({ id, position: index + 1 }))
    );
  }

  private validateId(value: string, resource: string): string {
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.startsWith('tmp-')) {
      throw new ValidationError(`A valid ${resource} ID is required.`);
    }
    return trimmed;
  }

  private matchScore(query: string, value: string): number {
    const candidate = value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-GB');
    if (candidate === query) return 1;
    if (candidate.startsWith(query)) return 0.9;
    return candidate.includes(query) ? 0.8 : 0;
  }
}

import { DestructiveActionNotConfirmedError, ValidationError } from '../domain/errors.js';
import { ItemContentPolicy } from '../domain/ItemContentPolicy.js';
import type { TaskList } from '../domain/TaskList.js';
import { TaskListNamePolicy } from '../domain/TaskListNamePolicy.js';
import type { TaskListTask } from '../domain/TaskListTask.js';
import type { TaskListRepository, TaskStatus } from './ports/TaskListRepository.js';

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
}

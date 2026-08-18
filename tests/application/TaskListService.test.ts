import { describe, expect, it } from 'vitest';

import { TaskListService } from '../../src/application/TaskListService.js';
import type {
  TaskListRepository,
  TaskStatus
} from '../../src/application/ports/TaskListRepository.js';
import { DestructiveActionNotConfirmedError, ValidationError } from '../../src/domain/errors.js';
import { TaskList } from '../../src/domain/TaskList.js';
import { TaskListTask } from '../../src/domain/TaskListTask.js';

class InMemoryTaskListRepository implements TaskListRepository {
  readonly completedIds: string[] = [];
  readonly archivedIds: string[] = [];
  readonly reordered: Array<{ id: string; position: number }> = [];
  failCompletionFor: string | undefined;

  constructor(
    readonly lists: TaskList[] = [new TaskList('list-1', 'Home')],
    readonly tasks: TaskListTask[] = [
      new TaskListTask('task-1', 'list-1', 'First', false, 1),
      new TaskListTask('task-2', 'list-1', 'Second', false, 2),
      new TaskListTask('task-3', 'list-1', 'Done', true, 3)
    ]
  ) {}

  async listTaskLists(): Promise<TaskList[]> {
    return [...this.lists];
  }

  async createTaskList(name: string): Promise<TaskList> {
    const list = new TaskList(`list-${this.lists.length + 1}`, name);
    this.lists.push(list);
    return list;
  }

  async archiveTaskList(listId: string): Promise<void> {
    this.archivedIds.push(listId);
  }

  async listTasks(listId: string, status: TaskStatus): Promise<TaskListTask[]> {
    return this.tasks.filter(
      (task) =>
        task.listId === listId &&
        (status === 'all' || task.isCompleted === (status === 'completed'))
    );
  }

  async createTask(listId: string, content: string): Promise<TaskListTask> {
    const task = new TaskListTask(
      `task-${this.tasks.length + 1}`,
      listId,
      content,
      false,
      this.tasks.length + 1
    );
    this.tasks.push(task);
    return task;
  }

  async updateTask(listId: string, taskId: string, content: string): Promise<TaskListTask> {
    return new TaskListTask(taskId, listId, content, false, 1);
  }

  async deleteTask(): Promise<void> {}

  async completeTask(_listId: string, taskId: string): Promise<void> {
    if (taskId === this.failCompletionFor) throw new Error('provider failure');
    this.completedIds.push(taskId);
  }

  async reorderTasks(
    _listId: string,
    orderedTasks: readonly { id: string; position: number }[]
  ): Promise<void> {
    this.reordered.push(...orderedTasks);
  }
}

describe('TaskListService', () => {
  it('creates a trimmed named task list', async () => {
    const repository = new InMemoryTaskListRepository();
    const service = new TaskListService(repository);

    await expect(service.createTaskList('  Errands  ')).resolves.toEqual(
      new TaskList('list-2', 'Errands')
    );
  });

  it('validates task-list names', async () => {
    const service = new TaskListService(new InMemoryTaskListRepository());

    await expect(service.createTaskList('   ')).rejects.toBeInstanceOf(ValidationError);
  });

  it('completes every remaining active task before archiving a deleted list', async () => {
    const repository = new InMemoryTaskListRepository();
    const service = new TaskListService(repository);

    await expect(service.deleteTaskList('list-1', true)).resolves.toEqual({ completedCount: 2 });
    expect(repository.completedIds).toEqual(['task-1', 'task-2']);
    expect(repository.archivedIds).toEqual(['list-1']);
  });

  it('requires confirmation and never archives after a task completion failure', async () => {
    const repository = new InMemoryTaskListRepository();
    const service = new TaskListService(repository);

    await expect(service.deleteTaskList('list-1', false)).rejects.toBeInstanceOf(
      DestructiveActionNotConfirmedError
    );
    repository.failCompletionFor = 'task-2';
    await expect(service.deleteTaskList('list-1', true)).rejects.toThrow('provider failure');
    expect(repository.archivedIds).toEqual([]);
  });

  it('requires an exact permutation of all active task IDs when reordering', async () => {
    const repository = new InMemoryTaskListRepository();
    const service = new TaskListService(repository);

    await service.reorderTasks('list-1', ['task-2', 'task-1']);
    expect(repository.reordered).toEqual([
      { id: 'task-2', position: 1 },
      { id: 'task-1', position: 2 }
    ]);
    await expect(service.reorderTasks('list-1', ['task-1'])).rejects.toBeInstanceOf(
      ValidationError
    );
    await expect(service.reorderTasks('list-1', ['task-1', 'task-1'])).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  it('validates content before creating and editing tasks', async () => {
    const repository = new InMemoryTaskListRepository();
    const service = new TaskListService(repository);

    await expect(service.createTask('list-1', '  Buy milk ')).resolves.toMatchObject({
      content: 'Buy milk'
    });
    await expect(service.updateTask('list-1', 'task-1', '  Updated ')).resolves.toMatchObject({
      content: 'Updated'
    });
  });
});

import type {
  TaskListRepository,
  TaskPosition,
  TaskStatus
} from '../../src/application/ports/TaskListRepository.js';
import { TaskList } from '../../src/domain/TaskList.js';
import { TaskListTask } from '../../src/domain/TaskListTask.js';

export class InMemoryTaskListRepository implements TaskListRepository {
  readonly completedIds: string[] = [];
  readonly deletedIds: string[] = [];
  readonly archivedIds: string[] = [];
  readonly reordered: TaskPosition[] = [];

  constructor(
    readonly lists: TaskList[] = [new TaskList('list-1', 'Home')],
    readonly tasks: TaskListTask[] = [
      new TaskListTask('task-1', 'list-1', 'Milk', false, 1),
      new TaskListTask('task-2', 'list-1', 'Bread', false, 2)
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
    const existing = this.tasks.find((task) => task.id === taskId && task.listId === listId);
    return new TaskListTask(taskId, listId, content, false, existing?.position ?? 1);
  }

  async deleteTask(_listId: string, taskId: string): Promise<void> {
    this.deletedIds.push(taskId);
  }

  async completeTask(_listId: string, taskId: string): Promise<void> {
    this.completedIds.push(taskId);
  }

  async reorderTasks(_listId: string, orderedTasks: readonly TaskPosition[]): Promise<void> {
    this.reordered.push(...orderedTasks);
  }
}

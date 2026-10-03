import type { TaskList } from '../../domain/TaskList.js';
import type { TaskListTask } from '../../domain/TaskListTask.js';

export interface TaskComment {
  readonly id: string;
  readonly taskId: string;
  readonly content: string;
}

export type TaskStatus = 'active' | 'completed' | 'all';

export interface TaskPosition {
  readonly id: string;
  readonly position: number;
}

export interface TaskListRepository {
  listTaskLists(): Promise<TaskList[]>;
  createTaskList(name: string): Promise<TaskList>;
  archiveTaskList(listId: string): Promise<void>;
  listTasks(listId: string, status: TaskStatus): Promise<TaskListTask[]>;
  createTask(listId: string, content: string, idempotencyKey?: string): Promise<TaskListTask>;
  createComment(
    listId: string,
    taskId: string,
    content: string,
    idempotencyKey?: string
  ): Promise<TaskComment>;
  updateTask(listId: string, taskId: string, content: string): Promise<TaskListTask>;
  deleteTask(listId: string, taskId: string): Promise<void>;
  completeTask(listId: string, taskId: string): Promise<void>;
  reorderTasks(listId: string, orderedTasks: readonly TaskPosition[]): Promise<void>;
}

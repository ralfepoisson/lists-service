import type { TaskListService } from '../TaskListService.js';

export interface TodoistConnectionStatus {
  readonly status: 'connected' | 'not_connected';
  readonly canManageConnection: false;
}

export interface TenantTaskListServiceProvider {
  connectionStatus(accountId: string): Promise<TodoistConnectionStatus>;
  forTenant(accountId: string): Promise<TaskListService>;
}

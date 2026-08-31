import type { TaskListService } from '../TaskListService.js';
import type { ShoppingListService } from '../ShoppingListService.js';
import type { ShoppingListPrintService } from '../ShoppingListPrintService.js';

export interface TodoistConnectionStatus {
  readonly status: 'connected' | 'not_connected';
  readonly canManageConnection: false;
}

export interface TenantTaskListServiceProvider {
  connectionStatus(accountId: string): Promise<TodoistConnectionStatus>;
  forTenant(accountId: string): Promise<TaskListService>;
  shoppingForTenant(accountId: string): Promise<{
    readonly shoppingList: ShoppingListService;
    readonly printService: ShoppingListPrintService;
  }>;
}

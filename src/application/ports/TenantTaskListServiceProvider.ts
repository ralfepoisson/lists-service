import type { TaskListService } from '../TaskListService.js';
import type { ShoppingListService } from '../ShoppingListService.js';
import type { ShoppingListPrintService } from '../ShoppingListPrintService.js';

export interface TodoistConnectionStatus {
  readonly status: 'connected' | 'not_connected';
  readonly canManageConnection: boolean;
  readonly version?: number;
  readonly managementMode?: 'profile_token';
  readonly credentialStatus?: 'server_configured' | 'saved_unverified';
}

export interface TenantTaskListServiceProvider {
  connectionStatus(accountId: string): Promise<TodoistConnectionStatus>;
  saveConnection?(
    accountId: string,
    subject: string,
    token: string,
    expectedVersion: number
  ): Promise<TodoistConnectionStatus>;
  disconnectConnection?(accountId: string, subject: string, expectedVersion: number): Promise<void>;
  forTenant(accountId: string): Promise<TaskListService>;
  shoppingForTenant(accountId: string): Promise<{
    readonly shoppingList: ShoppingListService;
    readonly printService: ShoppingListPrintService;
  }>;
}

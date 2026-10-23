import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RestControllerFactory,
  TenantTaskListServiceFactory
} from '../../src/bootstrap/ApplicationFactories.js';
import { PostgresLoopRepository } from '../../src/adapters/postgres/PostgresLoopRepository.js';
import { AppConfig } from '../../src/config/AppConfig.js';
import type { SecretProvider } from '../../src/application/ports/SecretProvider.js';
import type { ShoppingListService } from '../../src/application/ShoppingListService.js';
import type { ShoppingListPrintService } from '../../src/application/ShoppingListPrintService.js';
const config = AppConfig.fromRestEnvironment({
  REST_API_TOKEN_SECRET_ARN: 'rest',
  LIFE2_JWT_SIGNING_KEY_SECRET_ARN: 'jwt',
  LIFE2_ALLOWED_ACCOUNT_ID: 'tenant-a',
  TODOIST_TENANT_CATALOG_SECRET_ARN: 'catalog',
  DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused',
  SECRET_PROVIDER: 'file'
});
const secrets: SecretProvider = {
  getSecret: async (reference: string): Promise<string> =>
    reference === 'jwt' ? Buffer.alloc(32, 8).toString('base64') : 'unit-secret'
};
afterEach(() => vi.restoreAllMocks());
describe('optional Todoist connection heartbeat', () => {
  it('keeps unrelated Loops healthy after explicit Todoist disconnection without a provider request', async () => {
    vi.spyOn(TenantTaskListServiceFactory.prototype, 'connectionStatus').mockResolvedValue({
      status: 'not_connected',
      canManageConnection: true,
      version: 2
    });
    const provider = vi
      .spyOn(TenantTaskListServiceFactory.prototype, 'shoppingForTenant')
      .mockRejectedValue(new Error('provider must not be contacted'));
    vi.spyOn(PostgresLoopRepository.prototype, 'isReady').mockResolvedValue(true);
    const controller = await new RestControllerFactory(config, secrets).create();
    const response = await controller.handle({
      method: 'GET',
      path: '/health/heartbeat',
      headers: {},
      query: {},
      requestId: 'unit'
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ status: 'healthy', component: 'lists-service' });
    expect(provider).not.toHaveBeenCalled();
  });
  it('still reports genuine connected-provider failure and local database failure', async () => {
    const status = vi
      .spyOn(TenantTaskListServiceFactory.prototype, 'connectionStatus')
      .mockResolvedValue({ status: 'connected', canManageConnection: true, version: 1 });
    vi.spyOn(TenantTaskListServiceFactory.prototype, 'shoppingForTenant').mockResolvedValue({
      shoppingList: { isReady: async (): Promise<boolean> => false } as ShoppingListService,
      printService: {} as ShoppingListPrintService
    });
    const database = vi.spyOn(PostgresLoopRepository.prototype, 'isReady').mockResolvedValue(true);
    const controller = await new RestControllerFactory(config, secrets).create();
    const request = {
      method: 'GET',
      path: '/health/heartbeat',
      headers: {},
      query: {},
      requestId: 'unit'
    };
    expect((await controller.handle(request)).statusCode).toBe(503);
    status.mockResolvedValue({ status: 'not_connected', canManageConnection: true, version: 2 });
    database.mockResolvedValue(false);
    expect((await controller.handle(request)).statusCode).toBe(503);
  });
});

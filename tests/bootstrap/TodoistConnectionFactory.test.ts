import { describe, expect, it, vi } from 'vitest';
import { TenantTaskListServiceFactory } from '../../src/bootstrap/ApplicationFactories.js';
import { AppConfig } from '../../src/config/AppConfig.js';
import {
  TodoistConnectionManagement,
  type ConnectionRecord
} from '../../src/application/TodoistConnectionManagement.js';
import { ApplicationError } from '../../src/domain/errors.js';
class MemoryStore {
  rows = new Map<string, ConnectionRecord>();
  async read(id: string): Promise<ConnectionRecord | undefined> {
    return this.rows.get(id);
  }
  async write(
    id: string,
    value: Omit<ConnectionRecord, 'version'>,
    version: number
  ): Promise<void> {
    if ((this.rows.get(id)?.version ?? 0) !== version)
      throw new ApplicationError('VALIDATION_ERROR', 'Conflict', 409);
    this.rows.set(id, { ...value, version: version + 1 });
  }
}
describe('Todoist connection factory', () => {
  it('reports safe versioned metadata and unverified saves without provider calls or reading original tokens', async () => {
    const getSecret = vi
      .fn()
      .mockResolvedValue(
        JSON.stringify({
          connections: [
            {
              accountId: 'tenant-a',
              tokenSecretRef: 'original-token',
              shoppingProjectId: 'existing-project'
            }
          ]
        })
      );
    const config = AppConfig.fromRestEnvironment({
      REST_API_TOKEN_SECRET_ARN: 'rest',
      LIFE2_JWT_SIGNING_KEY_SECRET_ARN: 'jwt',
      LIFE2_ALLOWED_ACCOUNT_ID: 'tenant-a',
      DATABASE_URL: 'unused',
      SECRET_PROVIDER: 'file'
    });
    const factory = new TenantTaskListServiceFactory(
      config,
      { getSecret },
      'catalog',
      new TodoistConnectionManagement(new MemoryStore(), Buffer.alloc(32, 3))
    );
    expect(await factory.connectionStatus('tenant-a')).toMatchObject({
      status: 'connected',
      version: 0,
      canManageConnection: true,
      managementMode: 'profile_token',
      credentialStatus: 'server_configured'
    });
    expect(
      await factory.saveConnection('tenant-a', 'subject-a', 'unit-disposable-token', 0)
    ).toMatchObject({ status: 'connected', version: 1, credentialStatus: 'saved_unverified' });
    await factory.forTenant('tenant-a');
    await factory.disconnectConnection('tenant-a', 'subject-a', 1);
    const state = await factory.connectionStatus('tenant-a');
    expect(state.status).toBe('not_connected');
    expect(state.version).toBe(2);
    expect(state.credentialStatus).toBeUndefined();
    await expect(
      factory.saveConnection('tenant-b', 'subject-b', 'unit-token-b', 0)
    ).rejects.toMatchObject({ httpStatus: 403 });
    expect(await factory.connectionStatus('tenant-b')).toEqual({
      status: 'not_connected',
      canManageConnection: false
    });
    expect(getSecret).toHaveBeenCalledExactlyOnceWith('catalog');
  });
});

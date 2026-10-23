import { describe, expect, it, vi } from 'vitest';
import { RestApiController, type RestResponse } from '../../src/adapters/rest/RestApiController.js';
import type { RestAuthenticator } from '../../src/adapters/rest/RestBearerAuthenticator.js';
import type { TenantTaskListServiceProvider } from '../../src/application/ports/TenantTaskListServiceProvider.js';
import type { LoopService } from '../../src/application/LoopService.js';
import type { TagService } from '../../src/application/TagService.js';
const auth: RestAuthenticator = {
  authenticate: (header) =>
    header === 'Bearer life2'
      ? { authMethod: 'life2', accountId: 'tenant-a', sub: 'subject-a', email: 'a@example.test' }
      : header === 'Bearer automation'
        ? { authMethod: 'automation', accountId: 'tenant-a' }
        : undefined
};
function fixture(): {
  request: (
    method: string,
    body?: unknown,
    headers?: Record<string, string>
  ) => Promise<RestResponse>;
  saveConnection: ReturnType<typeof vi.fn>;
  disconnectConnection: ReturnType<typeof vi.fn>;
} {
  const saveConnection = vi.fn().mockResolvedValue({
    status: 'connected',
    canManageConnection: true,
    version: 1,
    credentialStatus: 'saved_unverified'
  });
  const disconnectConnection = vi.fn().mockResolvedValue(undefined);
  const provider = {
    saveConnection,
    disconnectConnection
  } as unknown as TenantTaskListServiceProvider;
  const controller = new RestApiController(
    auth,
    provider,
    {} as LoopService,
    {} as TagService,
    async () => true
  );
  const request = (
    method: string,
    body?: unknown,
    headers: Record<string, string> = {}
  ): Promise<RestResponse> =>
    controller.handle({
      method,
      path: '/v1/todoist/connection',
      headers: { authorization: 'Bearer life2', ...headers },
      query: {},
      requestId: 'r',
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
  return { request, saveConnection, disconnectConnection };
}
describe('Todoist management REST', () => {
  it('uses verified tenant/subject, strict write-only payload, version and unverified status', async () => {
    const f = fixture();
    const response = await f.request('PUT', { apiToken: 'disposable-token', expectedVersion: 0 });
    expect(response.statusCode).toBe(200);
    expect(f.saveConnection).toHaveBeenCalledWith('tenant-a', 'subject-a', 'disposable-token', 0);
    expect(response.body).not.toContain('disposable-token');
    expect(
      (
        await f.request('PUT', {
          apiToken: 'disposable-token',
          expectedVersion: 0,
          accountId: 'other'
        })
      ).statusCode
    ).toBe(400);
    expect(
      (
        await f.request(
          'PUT',
          { apiToken: 'disposable-token', expectedVersion: 0 },
          { authorization: 'Bearer automation' }
        )
      ).statusCode
    ).toBe(403);
  });
  it('requires explicit current-version disconnect confirmation without deleting provider data', async () => {
    const f = fixture();
    expect((await f.request('DELETE')).statusCode).toBe(400);
    expect(
      (
        await f.request('DELETE', undefined, {
          'x-confirm-destructive-action': 'true',
          'if-match': '1'
        })
      ).statusCode
    ).toBe(204);
    expect(f.disconnectConnection).toHaveBeenCalledExactlyOnceWith('tenant-a', 'subject-a', 1);
  });
});

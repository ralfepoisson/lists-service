import { describe, expect, it } from 'vitest';

import { TenantTodoistConnectionCatalog } from '../../src/adapters/todoist/TenantTodoistConnectionCatalog.js';
import type { SecretProvider } from '../../src/application/ports/SecretProvider.js';
import { ConfigurationError, TodoistNotConnectedError } from '../../src/domain/errors.js';

class MemorySecrets implements SecretProvider {
  constructor(private readonly values: Readonly<Record<string, string>>) {}
  async getSecret(reference: string): Promise<string> {
    const value = this.values[reference];
    if (value === undefined) throw new Error('missing');
    return value;
  }
}

describe('TenantTodoistConnectionCatalog', () => {
  it('resolves only the verified tenant connection without returning another tenant token', async () => {
    const catalog = new TenantTodoistConnectionCatalog(
      new MemorySecrets({
        catalog: JSON.stringify({
          connections: [
            { accountId: 'tenant-a', tokenSecretRef: 'token-a', shoppingProjectId: 'project-a' },
            {
              accountId: 'tenant-b',
              tokenSecretRef: 'token-b',
              shoppingProjectName: 'Tenant B Shopping'
            }
          ]
        }),
        'token-a': 'secret-a',
        'token-b': 'secret-b'
      }),
      'catalog'
    );

    await expect(catalog.tokenFor('tenant-a')).resolves.toBe('secret-a');
    await expect(catalog.tokenFor('tenant-b')).resolves.toBe('secret-b');
    await expect(catalog.connectionFor('tenant-a')).resolves.toEqual({
      token: 'secret-a',
      shoppingProjectId: 'project-a'
    });
    await expect(catalog.connectionFor('tenant-b')).resolves.toEqual({
      token: 'secret-b',
      shoppingProjectName: 'Tenant B Shopping'
    });
    await expect(catalog.tokenFor('tenant-c')).rejects.toBeInstanceOf(TodoistNotConnectedError);
  });

  it.each([
    'not-json',
    JSON.stringify({
      connections: [{ accountId: 'a', tokenSecretRef: 'x', shoppingProjectId: 'p', token: 'leak' }]
    }),
    JSON.stringify({ connections: [{ accountId: 'a', tokenSecretRef: 'x' }] }),
    JSON.stringify({
      connections: [
        {
          accountId: 'a',
          tokenSecretRef: 'x',
          shoppingProjectId: 'p',
          shoppingProjectName: 'Shopping'
        }
      ]
    }),
    JSON.stringify({
      connections: [
        { accountId: 'a', tokenSecretRef: 'x', shoppingProjectId: 'p' },
        { accountId: 'a', tokenSecretRef: 'y', shoppingProjectId: 'q' }
      ]
    })
  ])('fails closed for a malformed catalogue', async (value) => {
    const catalog = new TenantTodoistConnectionCatalog(
      new MemorySecrets({ catalog: value }),
      'catalog'
    );
    await expect(catalog.has('a')).rejects.toBeInstanceOf(ConfigurationError);
  });
});

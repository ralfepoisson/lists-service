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
            { accountId: 'tenant-a', tokenSecretRef: 'token-a' },
            { accountId: 'tenant-b', tokenSecretRef: 'token-b' }
          ]
        }),
        'token-a': 'secret-a',
        'token-b': 'secret-b'
      }),
      'catalog'
    );

    await expect(catalog.tokenFor('tenant-a')).resolves.toBe('secret-a');
    await expect(catalog.tokenFor('tenant-b')).resolves.toBe('secret-b');
    await expect(catalog.tokenFor('tenant-c')).rejects.toBeInstanceOf(TodoistNotConnectedError);
  });

  it.each([
    'not-json',
    JSON.stringify({ connections: [{ accountId: 'a', tokenSecretRef: 'x', token: 'leak' }] }),
    JSON.stringify({
      connections: [
        { accountId: 'a', tokenSecretRef: 'x' },
        { accountId: 'a', tokenSecretRef: 'y' }
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

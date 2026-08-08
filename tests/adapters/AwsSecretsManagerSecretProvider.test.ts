import type { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { describe, expect, it, vi } from 'vitest';

import { AwsSecretsManagerSecretProvider } from '../../src/adapters/secrets/AwsSecretsManagerSecretProvider.js';

describe('AwsSecretsManagerSecretProvider', () => {
  it('normalizes transport line endings without exposing or changing the secret content', async () => {
    const client = {
      send: vi.fn().mockResolvedValue({ SecretString: 'secret-value\r\n' })
    } as unknown as SecretsManagerClient;

    await expect(new AwsSecretsManagerSecretProvider(client).getSecret('secret-arn')).resolves.toBe(
      'secret-value'
    );
  });
});

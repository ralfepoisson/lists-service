import { GetSecretValueCommand, type SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

import type { SecretProvider } from '../../application/ports/SecretProvider.js';
import { ConfigurationError } from '../../domain/errors.js';

export class AwsSecretsManagerSecretProvider implements SecretProvider {
  private readonly cachedSecrets = new Map<string, Promise<string>>();

  constructor(private readonly client: SecretsManagerClient) {}

  async getSecret(secretArn: string): Promise<string> {
    const cachedSecret = this.cachedSecrets.get(secretArn);
    if (cachedSecret !== undefined) {
      return cachedSecret;
    }
    const secretPromise = this.loadSecret(secretArn);
    this.cachedSecrets.set(secretArn, secretPromise);
    try {
      return await secretPromise;
    } catch (error: unknown) {
      this.cachedSecrets.delete(secretArn);
      throw error;
    }
  }

  private async loadSecret(secretArn: string): Promise<string> {
    const response = await this.client.send(new GetSecretValueCommand({ SecretId: secretArn }));
    if (response.SecretString === undefined || response.SecretString.length === 0) {
      throw new ConfigurationError(`Secret ${secretArn} has no string value.`);
    }
    return response.SecretString;
  }
}

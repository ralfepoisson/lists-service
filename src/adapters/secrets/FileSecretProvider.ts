import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

import type { SecretProvider } from '../../application/ports/SecretProvider.js';
import { ConfigurationError } from '../../domain/errors.js';

export class FileSecretProvider implements SecretProvider {
  private readonly cachedSecrets = new Map<string, Promise<string>>();

  async getSecret(reference: string): Promise<string> {
    if (!isAbsolute(reference)) {
      throw new ConfigurationError('Local secret references must be absolute file paths.');
    }
    const cachedSecret = this.cachedSecrets.get(reference);
    if (cachedSecret !== undefined) {
      return cachedSecret;
    }
    const secretPromise = this.loadSecret(reference);
    this.cachedSecrets.set(reference, secretPromise);
    try {
      return await secretPromise;
    } catch (error: unknown) {
      this.cachedSecrets.delete(reference);
      throw error;
    }
  }

  private async loadSecret(reference: string): Promise<string> {
    let value: string;
    try {
      value = await readFile(reference, 'utf8');
    } catch {
      throw new ConfigurationError('The configured local secret could not be read.');
    }
    const normalized = value.trim();
    if (normalized.length === 0) {
      throw new ConfigurationError('The configured local secret is empty.');
    }
    return normalized;
  }
}

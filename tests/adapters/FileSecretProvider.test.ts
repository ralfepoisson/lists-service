import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { FileSecretProvider } from '../../src/adapters/secrets/FileSecretProvider.js';
import { ConfigurationError } from '../../src/domain/errors.js';

describe('FileSecretProvider', () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
  });

  it('loads a non-empty secret from an absolute read-only mount path', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'life2-lists-secret-'));
    directories.push(directory);
    const path = join(directory, 'todoist-token');
    await writeFile(path, 'real-boundary-value\n', { mode: 0o600 });

    await expect(new FileSecretProvider().getSecret(path)).resolves.toBe('real-boundary-value');
  });

  it.each(['relative/path', ''])('rejects unsafe secret reference %j', async (reference) => {
    await expect(new FileSecretProvider().getSecret(reference)).rejects.toBeInstanceOf(
      ConfigurationError
    );
  });

  it('does not expose filesystem error detail when a secret cannot be read', async () => {
    await expect(new FileSecretProvider().getSecret('/missing/life2-secret')).rejects.toThrow(
      'The configured local secret could not be read.'
    );
  });
});

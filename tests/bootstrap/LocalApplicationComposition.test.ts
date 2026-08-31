import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LocalRestApplicationComposition } from '../../src/bootstrap/LocalApplicationComposition.js';

describe('LocalRestApplicationComposition', () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
  });

  it('constructs the REST application entirely from file-backed secrets', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'life2-lists-local-composition-'));
    directories.push(directory);
    const todoistToken = await secretFile(directory, 'todoist-token', 'provider-token');
    const restToken = await secretFile(directory, 'rest-token', 'automation-token');
    const signingKey = await secretFile(
      directory,
      'jwt-key',
      Buffer.from('local-signing-key-with-at-least-32-bytes').toString('base64')
    );
    const tenantCatalog = await secretFile(
      directory,
      'tenant-catalog',
      JSON.stringify({
        connections: [
          {
            accountId: 'account-123',
            tokenSecretRef: todoistToken,
            shoppingProjectId: 'shopping-project'
          }
        ]
      })
    );

    const application = await LocalRestApplicationComposition.create({
      SECRET_PROVIDER: 'file',
      REST_API_TOKEN_SECRET_ARN: restToken,
      LIFE2_JWT_SIGNING_KEY_SECRET_ARN: signingKey,
      LIFE2_ALLOWED_ACCOUNT_ID: 'account-123',
      TODOIST_TENANT_CATALOG_SECRET_ARN: tenantCatalog,
      ALEXA_SKILL_ID: 'local-rest-only'
    });

    const response = await application.restController.handle({
      method: 'GET',
      path: '/health',
      headers: {},
      query: {},
      requestId: 'local-request'
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      data: { status: 'ok' },
      meta: { requestId: 'local-request' }
    });
  });
});

const secretFile = async (directory: string, name: string, value: string): Promise<string> => {
  const path = join(directory, name);
  await writeFile(path, value, { mode: 0o600 });
  return path;
};

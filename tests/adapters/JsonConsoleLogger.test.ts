import { afterEach, describe, expect, it, vi } from 'vitest';

import { JsonConsoleLogger } from '../../src/adapters/observability/JsonConsoleLogger.js';
import { safeRestOperation } from '../../src/entrypoints/RestLambdaEntrypoint.js';

describe('JsonConsoleLogger', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders only approved operational fields and omits accidental private context', () => {
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const logger = new JsonConsoleLogger('info');

    logger.log({
      level: 'warn',
      message: 'REST request completed.',
      requestId: 'request-1',
      channel: 'rest',
      operation: 'GET /v1/items',
      durationMs: 12,
      status: '401',
      authorization: 'Bearer private-token',
      body: 'private list content'
    } as never);

    const rendered = String(write.mock.calls[0]?.[0]);
    const entry = JSON.parse(rendered);
    expect(entry).toMatchObject({
      component: 'lists-service',
      level: 'warn',
      requestId: 'request-1',
      channel: 'rest',
      operation: 'GET /v1/items',
      durationMs: 12,
      status: '401'
    });
    expect(rendered).not.toContain('private-token');
    expect(rendered).not.toContain('private list content');
  });

  it('templates dynamic list and item identifiers before logging', () => {
    expect(safeRestOperation('POST', '/v1/items/private-item/complete')).toBe(
      'POST /v1/items/:itemId/complete'
    );
    expect(safeRestOperation('PATCH', '/v1/task-lists/private-list/tasks/private-task')).toBe(
      'PATCH /v1/task-lists/:listId/tasks/:taskId'
    );
  });
});

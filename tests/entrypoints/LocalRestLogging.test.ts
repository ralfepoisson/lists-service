import { describe, expect, it } from 'vitest';

import { localRestCompletionEvent } from '../../src/entrypoints/LocalRestLogging.js';

describe('localRestCompletionEvent', () => {
  it('records a templated operation, request id, status, severity, and duration', () => {
    expect(
      localRestCompletionEvent({
        method: 'PATCH',
        path: '/v1/task-lists/private-list/tasks/private-task',
        requestId: 'request-1',
        statusCode: 404,
        durationMs: 12.7
      })
    ).toEqual({
      level: 'warn',
      message: 'REST request completed.',
      requestId: 'request-1',
      channel: 'rest',
      operation: 'PATCH /v1/task-lists/:listId/tasks/:taskId',
      durationMs: 13,
      status: '404'
    });
  });

  it('uses error severity for server failures', () => {
    expect(
      localRestCompletionEvent({
        method: 'GET',
        path: '/health',
        requestId: 'request-2',
        statusCode: 500,
        durationMs: 1
      }).level
    ).toBe('error');
  });
});

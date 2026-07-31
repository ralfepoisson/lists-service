import { describe, expect, it } from 'vitest';

import { TodoistShoppingListRepository } from '../../src/adapters/todoist/TodoistShoppingListRepository.js';
import { TodoistClient } from '../../src/adapters/todoist/TodoistClient.js';
import type { HttpRequest, HttpTransport } from '../../src/adapters/todoist/ports/HttpTransport.js';
import type { Sleeper } from '../../src/adapters/todoist/ports/Sleeper.js';

class ScriptedHttpTransport implements HttpTransport {
  readonly requests: HttpRequest[] = [];

  constructor(private readonly responses: Array<Response | Error>) {}

  async send(request: HttpRequest): Promise<Response> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (response === undefined) {
      throw new Error('No scripted response remains.');
    }
    if (response instanceof Error) {
      throw response;
    }
    return response;
  }
}

class RecordingSleeper implements Sleeper {
  readonly delays: number[] = [];

  async sleep(delayMilliseconds: number): Promise<void> {
    this.delays.push(delayMilliseconds);
  }
}

class FixedClock {
  now(): Date {
    return new Date('2026-07-31T12:00:00.000Z');
  }
}

const jsonResponse = (
  body: unknown,
  status = 200,
  headers?: Readonly<Record<string, string>>
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  });

describe('TodoistShoppingListRepository', () => {
  it('retrieves every active page for the configured project', async () => {
    const transport = new ScriptedHttpTransport([
      jsonResponse({
        results: [
          {
            id: '1',
            project_id: 'shopping',
            content: 'milk',
            description: '',
            added_at: '2026-07-30T10:00:00Z'
          }
        ],
        next_cursor: 'next'
      }),
      jsonResponse({
        results: [
          {
            id: '2',
            project_id: 'shopping',
            content: 'bread',
            description: 'wholemeal',
            added_at: '2026-07-30T11:00:00Z'
          }
        ],
        next_cursor: null
      })
    ]);
    const repository = createRepository(transport);

    const items = await repository.list('active');

    expect(items.map((item) => item.content)).toEqual(['milk', 'bread']);
    expect(transport.requests[0]?.url).toContain('project_id=shopping');
    expect(transport.requests[1]?.url).toContain('cursor=next');
  });

  it('retrieves completed items from the bounded completion-date endpoint', async () => {
    const transport = new ScriptedHttpTransport([
      jsonResponse({
        items: [
          {
            id: '3',
            project_id: 'shopping',
            content: 'eggs',
            completed_at: '2026-07-30T12:00:00Z'
          }
        ],
        next_cursor: null
      })
    ]);
    const repository = createRepository(transport);

    const items = await repository.list('completed');

    expect(items[0]).toEqual(
      expect.objectContaining({ id: '3', content: 'eggs', isCompleted: true })
    );
    expect(transport.requests[0]?.url).toContain('/tasks/completed/by_completion_date?');
    expect(transport.requests[0]?.url).toContain('since=2026-05-02T12%3A00%3A00.000Z');
  });

  it('creates a task in the configured project', async () => {
    const transport = new ScriptedHttpTransport([
      jsonResponse({
        id: '4',
        project_id: 'shopping',
        content: 'tea',
        description: '',
        added_at: '2026-07-31T12:00:00Z'
      })
    ]);
    const repository = createRepository(transport);

    const item = await repository.add('tea');

    expect(item.id).toBe('4');
    expect(transport.requests[0]).toEqual(
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ content: 'tea', project_id: 'shopping' })
      })
    );
  });

  it.each([
    ['complete', 'POST', '/tasks/42/close'],
    ['reopen', 'POST', '/tasks/42/reopen'],
    ['delete', 'DELETE', '/tasks/42']
  ] as const)('maps %s to the current Todoist operation', async (operation, method, path) => {
    const transport = new ScriptedHttpTransport([new Response(null, { status: 200 })]);
    const repository = createRepository(transport);

    await repository[operation]('42');

    expect(transport.requests[0]).toEqual(
      expect.objectContaining({ method, url: `https://api.todoist.com/api/v1${path}` })
    );
  });

  it('retries a rate limit using Retry-After without exposing the token', async () => {
    const transport = new ScriptedHttpTransport([
      jsonResponse({ error: 'rate limited' }, 429, { 'retry-after': '2' }),
      jsonResponse({ results: [], next_cursor: null })
    ]);
    const sleeper = new RecordingSleeper();
    const repository = createRepository(transport, sleeper);

    await expect(repository.list('active')).resolves.toEqual([]);

    expect(sleeper.delays).toEqual([2000]);
    expect(transport.requests[0]?.headers['Authorization']).toBe('Bearer todoist-secret');
  });

  it('maps permanent upstream authentication failures without retrying', async () => {
    const transport = new ScriptedHttpTransport([jsonResponse({ error: 'no' }, 401)]);
    const sleeper = new RecordingSleeper();
    const repository = createRepository(transport, sleeper);

    await expect(repository.list('active')).rejects.toMatchObject({
      code: 'UPSTREAM_AUTHENTICATION_FAILED'
    });
    expect(sleeper.delays).toEqual([]);
  });

  it.each([403, 404])('does not retry permanent HTTP %s responses', async (status) => {
    const transport = new ScriptedHttpTransport([jsonResponse({ error: 'permanent' }, status)]);
    const sleeper = new RecordingSleeper();
    const repository = createRepository(transport, sleeper);

    await expect(repository.list('active')).rejects.toBeInstanceOf(Error);
    expect(sleeper.delays).toEqual([]);
    expect(transport.requests).toHaveLength(1);
  });

  it('retries transient 503 responses with bounded backoff', async () => {
    const transport = new ScriptedHttpTransport([
      jsonResponse({ error: 'temporary' }, 503),
      jsonResponse({ results: [], next_cursor: null })
    ]);
    const sleeper = new RecordingSleeper();
    const repository = createRepository(transport, sleeper);

    await expect(repository.list('active')).resolves.toEqual([]);
    expect(sleeper.delays).toEqual([250]);
  });

  it('maps a terminal timeout without leaking transport details', async () => {
    const timeout = new Error('secret transport detail');
    timeout.name = 'AbortError';
    const transport = new ScriptedHttpTransport([timeout, timeout, timeout]);
    const repository = createRepository(transport);

    await expect(repository.list('active')).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Todoist request timed out.'
    });
  });

  it('combines active and completed items for all status', async () => {
    const transport = new ScriptedHttpTransport([
      jsonResponse({
        results: [{ id: '1', project_id: 'shopping', content: 'milk' }],
        next_cursor: null
      }),
      jsonResponse({
        items: [
          {
            id: '2',
            project_id: 'shopping',
            content: 'bread',
            completed_at: '2026-07-30T12:00:00Z'
          }
        ],
        next_cursor: null
      })
    ]);
    const repository = createRepository(transport);

    await expect(repository.list('all')).resolves.toHaveLength(2);
  });

  it('rejects malformed upstream task payloads', async () => {
    const transport = new ScriptedHttpTransport([
      jsonResponse({ results: [{ id: 123, content: null }], next_cursor: null })
    ]);
    const repository = createRepository(transport);

    await expect(repository.list('active')).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE'
    });
  });
});

function createRepository(
  transport: HttpTransport,
  sleeper = new RecordingSleeper()
): TodoistShoppingListRepository {
  const client = new TodoistClient({
    baseUrl: 'https://api.todoist.com/api/v1',
    token: 'todoist-secret',
    transport,
    sleeper,
    maximumAttempts: 3,
    timeoutMilliseconds: 1000,
    random: (): number => 0
  });
  return new TodoistShoppingListRepository(client, 'shopping', 90, new FixedClock());
}

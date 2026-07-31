import { describe, expect, it } from 'vitest';

import { TodoistClient } from '../../src/adapters/todoist/TodoistClient.js';
import { TodoistProjectResolver } from '../../src/adapters/todoist/TodoistProjectResolver.js';
import type { HttpRequest, HttpTransport } from '../../src/adapters/todoist/ports/HttpTransport.js';
import type { Sleeper } from '../../src/adapters/todoist/ports/Sleeper.js';
import { ConfigurationError, UpstreamError } from '../../src/domain/errors.js';

class ScriptedHttpTransport implements HttpTransport {
  readonly requests: HttpRequest[] = [];

  constructor(private readonly responses: Response[]) {}

  async send(request: HttpRequest): Promise<Response> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (response === undefined) {
      throw new Error('No scripted response remains.');
    }
    return response;
  }
}

class ImmediateSleeper implements Sleeper {
  async sleep(): Promise<void> {}
}

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });

const createResolver = (transport: HttpTransport): TodoistProjectResolver =>
  new TodoistProjectResolver(
    new TodoistClient({
      baseUrl: 'https://api.todoist.test/api/v1',
      token: 'test-token',
      transport,
      sleeper: new ImmediateSleeper(),
      maximumAttempts: 1,
      timeoutMilliseconds: 1_000
    })
  );

describe('TodoistProjectResolver', () => {
  it('reuses the one exact existing project without creating another', async () => {
    const transport = new ScriptedHttpTransport([
      jsonResponse({ results: [{ id: 'existing-id', name: 'Shopping' }] })
    ]);

    await expect(createResolver(transport).resolveOrCreate(' Shopping ')).resolves.toBe(
      'existing-id'
    );
    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]?.method).toBe('GET');
  });

  it('creates the project when no exact project exists', async () => {
    const transport = new ScriptedHttpTransport([
      jsonResponse({ results: [] }),
      jsonResponse({ id: 'created-id', name: 'Shopping' })
    ]);

    await expect(createResolver(transport).resolveOrCreate('Shopping')).resolves.toBe('created-id');
    expect(transport.requests[1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Shopping' })
      })
    );
    expect(transport.requests[1]?.url).toBe('https://api.todoist.test/api/v1/projects');
  });

  it('refuses to choose or create when duplicate exact projects exist', async () => {
    const transport = new ScriptedHttpTransport([
      jsonResponse({
        results: [
          { id: 'first-id', name: 'Shopping' },
          { id: 'second-id', name: ' shopping ' }
        ]
      })
    ]);

    await expect(createResolver(transport).resolveOrCreate('Shopping')).rejects.toBeInstanceOf(
      ConfigurationError
    );
    expect(transport.requests).toHaveLength(1);
  });

  it('rejects a malformed created project response', async () => {
    const transport = new ScriptedHttpTransport([
      jsonResponse({ results: [] }),
      jsonResponse({ name: 'Shopping' })
    ]);

    await expect(createResolver(transport).resolveOrCreate('Shopping')).rejects.toBeInstanceOf(
      UpstreamError
    );
  });
});

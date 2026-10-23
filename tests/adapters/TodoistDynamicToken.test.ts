import { describe, expect, it, vi } from 'vitest';
import { TodoistClient } from '../../src/adapters/todoist/TodoistClient.js';
import { TodoistNotConnectedError } from '../../src/domain/errors.js';
describe('Todoist dynamic credential enforcement', () => {
  it('checks current tenant credentials on a retained client before every request', async () => {
    let connected = true;
    const send = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const client = new TodoistClient({
      baseUrl: 'https://api.todoist.com/api/v1',
      token: async (): Promise<string> => {
        if (!connected) throw new TodoistNotConnectedError();
        return 'unit-token';
      },
      transport: { send },
      sleeper: { sleep: async (): Promise<void> => {} },
      maximumAttempts: 3,
      timeoutMilliseconds: 1000
    });
    await client.get('/projects', {});
    connected = false;
    await expect(client.get('/projects', {})).rejects.toBeInstanceOf(TodoistNotConnectedError);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('does not retry a provider request if the connection was disconnected during backoff', async () => {
    let connected = true;
    const send = vi.fn().mockResolvedValue(new Response('{}', { status: 503 }));
    const client = new TodoistClient({
      baseUrl: 'https://api.todoist.com/api/v1',
      token: async (): Promise<string> => {
        if (!connected) throw new TodoistNotConnectedError();
        return 'unit-token';
      },
      transport: { send },
      sleeper: {
        sleep: async (): Promise<void> => {
          connected = false;
        }
      },
      maximumAttempts: 3,
      timeoutMilliseconds: 1000
    });
    await expect(client.get('/projects', {})).rejects.toBeInstanceOf(TodoistNotConnectedError);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

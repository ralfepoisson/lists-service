import { describe, expect, it } from 'vitest';

import { TodoistClient } from '../../src/adapters/todoist/TodoistClient.js';
import { TodoistTaskListRepository } from '../../src/adapters/todoist/TodoistTaskListRepository.js';
import type { HttpRequest, HttpTransport } from '../../src/adapters/todoist/ports/HttpTransport.js';
import { TaskListNotFoundError, TaskNotFoundError } from '../../src/domain/errors.js';

class ScriptedTransport implements HttpTransport {
  readonly requests: HttpRequest[] = [];
  constructor(private readonly responses: Response[]) {}
  async send(request: HttpRequest): Promise<Response> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (response === undefined) throw new Error('No response remains.');
    return response;
  }
}

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });

const createRepository = (transport: HttpTransport): TodoistTaskListRepository =>
  new TodoistTaskListRepository(
    new TodoistClient({
      baseUrl: 'https://api.todoist.com/api/v1',
      token: 'secret',
      transport,
      sleeper: { sleep: async () => undefined },
      maximumAttempts: 1,
      timeoutMilliseconds: 1000
    }),
    'container-project',
    90,
    { now: () => new Date('2026-08-18T12:00:00.000Z') },
    () => 'reorder-command'
  );

describe('TodoistTaskListRepository', () => {
  it('lists paginated sections only inside the configured project', async () => {
    const transport = new ScriptedTransport([
      json({
        results: [{ id: 'section-1', project_id: 'container-project', name: 'Home' }],
        next_cursor: 'next'
      }),
      json({
        results: [{ id: 'section-2', project_id: 'container-project', name: 'Work' }],
        next_cursor: null
      })
    ]);

    await expect(createRepository(transport).listTaskLists()).resolves.toEqual([
      { id: 'section-1', name: 'Home' },
      { id: 'section-2', name: 'Work' }
    ]);
    expect(transport.requests[0]?.url).toContain('project_id=container-project');
    expect(transport.requests[1]?.url).toContain('cursor=next');
  });

  it('creates a section in the configured project', async () => {
    const transport = new ScriptedTransport([
      json({ id: 'section-1', project_id: 'container-project', name: 'Home' })
    ]);

    await createRepository(transport).createTaskList('Home');

    expect(transport.requests[0]?.body).toBe(
      JSON.stringify({ name: 'Home', project_id: 'container-project' })
    );
  });

  it('rejects a section outside the configured project', async () => {
    const transport = new ScriptedTransport([
      json({ id: 'section-1', project_id: 'other-project', name: 'Private' })
    ]);

    await expect(
      createRepository(transport).listTasks('section-1', 'active')
    ).rejects.toBeInstanceOf(TaskListNotFoundError);
    expect(transport.requests).toHaveLength(1);
  });

  it('rejects a task outside the requested section before mutation', async () => {
    const transport = new ScriptedTransport([
      json({ id: 'section-1', project_id: 'container-project', name: 'Home' }),
      json({
        id: 'task-1',
        project_id: 'container-project',
        section_id: 'section-2',
        content: 'Secret',
        child_order: 1
      })
    ]);

    await expect(
      createRepository(transport).completeTask('section-1', 'task-1')
    ).rejects.toBeInstanceOf(TaskNotFoundError);
    expect(transport.requests).toHaveLength(2);
  });

  it('updates task content and maps its position', async () => {
    const task = {
      id: 'task-1',
      project_id: 'container-project',
      section_id: 'section-1',
      content: 'Old',
      child_order: 4
    };
    const transport = new ScriptedTransport([
      json({ id: 'section-1', project_id: 'container-project', name: 'Home' }),
      json(task),
      json({ ...task, content: 'New' })
    ]);

    await expect(
      createRepository(transport).updateTask('section-1', 'task-1', 'New')
    ).resolves.toMatchObject({ listId: 'section-1', content: 'New', position: 4 });
    expect(transport.requests[2]?.body).toBe(JSON.stringify({ content: 'New' }));
  });

  it('sends an item_reorder sync command after validating the exact section scope', async () => {
    const transport = new ScriptedTransport([
      json({ id: 'section-1', project_id: 'container-project', name: 'Home' }),
      json({
        results: [
          {
            id: 'task-1',
            project_id: 'container-project',
            section_id: 'section-1',
            content: 'One',
            child_order: 1
          },
          {
            id: 'task-2',
            project_id: 'container-project',
            section_id: 'section-1',
            content: 'Two',
            child_order: 2
          }
        ],
        next_cursor: null
      }),
      json({ sync_status: { 'reorder-command': 'ok' } })
    ]);
    const repository = createRepository(transport);

    await repository.reorderTasks('section-1', [
      { id: 'task-2', position: 1 },
      { id: 'task-1', position: 2 }
    ]);

    expect(transport.requests[2]).toMatchObject({ method: 'POST' });
    expect(transport.requests[2]?.url.endsWith('/sync')).toBe(true);
    expect(transport.requests[2]?.headers['Content-Type']).toBe(
      'application/x-www-form-urlencoded'
    );
    expect(transport.requests[2]?.body).toContain('item_reorder');
  });
});

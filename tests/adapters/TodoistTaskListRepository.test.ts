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
    90,
    { now: () => new Date('2026-08-18T12:00:00.000Z') },
    () => 'reorder-command'
  );

describe('TodoistTaskListRepository', () => {
  it('forwards stable idempotency keys on task creation and tenant-validated comments', async () => {
    const key = '123e4567-e89b-42d3-a456-426614174000';
    const project = { id: 'project-1', name: 'Home', child_order: 1, inbox_project: false };
    const task = {
      id: 'task-1',
      project_id: 'project-1',
      section_id: null,
      content: 'Task',
      child_order: 1
    };
    const transport = new ScriptedTransport([
      json(project),
      json(task),
      json(project),
      json(task),
      json({ id: 'comment-1', task_id: 'task-1', content: 'Feedback' })
    ]);
    const repository = createRepository(transport);
    await repository.createTask('project-1', 'Task', key);
    expect(transport.requests[1]?.headers['X-Request-Id']).toBe(key);
    expect(await repository.createComment('project-1', 'task-1', 'Feedback', key)).toEqual({
      id: 'comment-1',
      taskId: 'task-1',
      content: 'Feedback'
    });
    expect(transport.requests[4]?.headers['X-Request-Id']).toBe(key);
    expect(JSON.parse(transport.requests[4]?.body ?? '{}')).toEqual({
      task_id: 'task-1',
      content: 'Feedback'
    });
  });

  it('refuses a comment on a task outside the requested list without a provider mutation', async () => {
    const transport = new ScriptedTransport([
      json({ id: 'project-1', name: 'Home', child_order: 1, inbox_project: false }),
      json({
        id: 'task-1',
        project_id: 'other-list',
        section_id: null,
        content: 'Task',
        child_order: 1
      })
    ]);
    await expect(
      createRepository(transport).createComment('project-1', 'task-1', 'Feedback')
    ).rejects.toBeInstanceOf(TaskNotFoundError);
    expect(transport.requests).toHaveLength(2);
  });

  it('normalizes Todoist priorities from urgent 4 to P1 and normal 1 to P4', async () => {
    const transport = new ScriptedTransport([
      json({ id: 'project-1', name: 'Home', child_order: 1, inbox_project: false }),
      json({
        results: [4, 3, 2, 1].map((priority, index) => ({
          id: `task-${index}`,
          project_id: 'project-1',
          section_id: null,
          content: 'Task',
          child_order: index,
          priority
        })),
        next_cursor: null
      })
    ]);
    const tasks = await createRepository(transport).listTasks('project-1', 'active');
    expect(tasks.map((task) => Reflect.get(task, 'priority'))).toEqual([1, 2, 3, 4]);
  });

  it('preserves omitted provider priority without inventing one for completed history', async () => {
    const transport = new ScriptedTransport([
      json({ id: 'project-1', name: 'Home', child_order: 1, inbox_project: false }),
      json({
        items: [
          {
            id: 'task-1',
            project_id: 'project-1',
            section_id: null,
            content: 'Task',
            child_order: 1
          }
        ],
        next_cursor: null
      })
    ]);
    const tasks = await createRepository(transport).listTasks('project-1', 'completed');
    expect(JSON.parse(JSON.stringify(tasks[0]))).not.toHaveProperty('priority');
  });

  it.each([0, 5, 1.5, '4', null])('rejects malformed provider priority %s', async (priority) => {
    const transport = new ScriptedTransport([
      json({ id: 'project-1', name: 'Home', child_order: 1, inbox_project: false }),
      json({
        results: [
          {
            id: 'task-1',
            project_id: 'project-1',
            section_id: null,
            content: 'Task',
            child_order: 1,
            priority
          }
        ],
        next_cursor: null
      })
    ]);
    await expect(createRepository(transport).listTasks('project-1', 'active')).rejects.toThrow(
      'malformed response'
    );
  });

  it('lists every paginated active project visible to the connected Todoist tenant', async () => {
    const transport = new ScriptedTransport([
      json({
        results: [{ id: 'project-1', name: 'Home', child_order: 2, inbox_project: false }],
        next_cursor: 'next'
      }),
      json({
        results: [{ id: 'project-2', name: 'Work', child_order: 1, inbox_project: false }],
        next_cursor: null
      })
    ]);

    await expect(createRepository(transport).listTaskLists()).resolves.toEqual([
      { id: 'project-2', name: 'Work' },
      { id: 'project-1', name: 'Home' }
    ]);
    expect(transport.requests[0]?.url).toContain('/projects?');
    expect(transport.requests[1]?.url).toContain('cursor=next');
  });

  it('creates a Todoist project as a task list', async () => {
    const transport = new ScriptedTransport([
      json({ id: 'project-1', name: 'Home', child_order: 1, inbox_project: false })
    ]);

    await createRepository(transport).createTaskList('Home');

    expect(transport.requests[0]?.body).toBe(JSON.stringify({ name: 'Home' }));
  });

  it('rejects a project that is not visible through the connected account', async () => {
    const transport = new ScriptedTransport([new Response('', { status: 404 })]);

    await expect(
      createRepository(transport).listTasks('project-1', 'active')
    ).rejects.toBeInstanceOf(TaskListNotFoundError);
    expect(transport.requests).toHaveLength(1);
  });

  it('rejects a task outside the requested project before mutation', async () => {
    const transport = new ScriptedTransport([
      json({ id: 'project-1', name: 'Home', child_order: 1, inbox_project: false }),
      json({
        id: 'task-1',
        project_id: 'project-2',
        section_id: null,
        content: 'Secret',
        child_order: 1
      })
    ]);

    await expect(
      createRepository(transport).completeTask('project-1', 'task-1')
    ).rejects.toBeInstanceOf(TaskNotFoundError);
    expect(transport.requests).toHaveLength(2);
  });

  it('updates task content and maps its position', async () => {
    const task = {
      id: 'task-1',
      project_id: 'project-1',
      section_id: null,
      content: 'Old',
      child_order: 4
    };
    const transport = new ScriptedTransport([
      json({ id: 'project-1', name: 'Home', child_order: 1, inbox_project: false }),
      json(task),
      json({ ...task, content: 'New' })
    ]);

    await expect(
      createRepository(transport).updateTask('project-1', 'task-1', 'New')
    ).resolves.toMatchObject({ listId: 'project-1', content: 'New', position: 4 });
    expect(transport.requests[2]?.body).toBe(JSON.stringify({ content: 'New' }));
  });

  it('sends an item_reorder sync command after validating the exact project scope', async () => {
    const transport = new ScriptedTransport([
      json({ id: 'project-1', name: 'Home', child_order: 1, inbox_project: false }),
      json({
        results: [
          {
            id: 'task-1',
            project_id: 'project-1',
            section_id: null,
            content: 'One',
            child_order: 1
          },
          {
            id: 'task-2',
            project_id: 'project-1',
            section_id: null,
            content: 'Two',
            child_order: 2
          }
        ],
        next_cursor: null
      }),
      json({ sync_status: { 'reorder-command': 'ok' } })
    ]);
    const repository = createRepository(transport);

    await repository.reorderTasks('project-1', [
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

import { describe, expect, it } from 'vitest';

import {
  RestApiController,
  type RestRequest,
  type RestResponse
} from '../../src/adapters/rest/RestApiController.js';
import type {
  RestAuthenticator,
  RestPrincipal
} from '../../src/adapters/rest/RestBearerAuthenticator.js';
import { ShoppingListService } from '../../src/application/ShoppingListService.js';
import { LoopService } from '../../src/application/LoopService.js';
import { TaskListService } from '../../src/application/TaskListService.js';
import type { TodoistConnectionStatus } from '../../src/application/ports/TenantTaskListServiceProvider.js';
import { ShoppingListPrintService } from '../../src/application/ShoppingListPrintService.js';
import { PdfKitShoppingListRenderer } from '../../src/adapters/pdf/PdfKitShoppingListRenderer.js';
import { ShoppingListItem } from '../../src/domain/ShoppingListItem.js';
import { InMemoryShoppingListRepository } from '../support/InMemoryShoppingListRepository.js';
import { InMemoryTaskListRepository } from '../support/InMemoryTaskListRepository.js';
import { InMemoryLoopRepository } from '../support/InMemoryLoopRepository.js';

class FixtureAuthenticator implements RestAuthenticator {
  authenticate(header: string | undefined): RestPrincipal | undefined {
    if (header === 'Bearer rest-secret') {
      return { authMethod: 'automation', accountId: 'account-123' };
    }
    if (header === 'Bearer life2-tenant') {
      return {
        authMethod: 'life2',
        accountId: 'account-123',
        sub: 'user-123',
        email: 'user@example.com'
      };
    }
    if (header === 'Bearer life2-other') {
      return {
        authMethod: 'life2',
        accountId: 'account-456',
        sub: 'user-456',
        email: 'other@example.com'
      };
    }
    return undefined;
  }
}

class RestControllerFixture {
  readonly repository = new InMemoryShoppingListRepository([
    new ShoppingListItem('1', 'milk', false),
    new ShoppingListItem('2', 'bread', true)
  ]);
  readonly otherRepository = new InMemoryShoppingListRepository([
    new ShoppingListItem('other-1', 'tenant-b-item', false)
  ]);
  readonly taskListRepository = new InMemoryTaskListRepository();
  readonly taskListService = new TaskListService(this.taskListRepository);
  readonly loopService = new LoopService(
    new InMemoryLoopRepository(),
    () => 'loop-1',
    () => new Date('2026-09-30T12:00:00.000Z')
  );
  readonly requestedTenantIds: string[] = [];
  heartbeatHealthy = true;
  readonly controller = new RestApiController(
    new FixtureAuthenticator(),
    {
      connectionStatus: async (accountId): Promise<TodoistConnectionStatus> => ({
        status: ['account-123', 'account-456'].includes(accountId) ? 'connected' : 'not_connected',
        canManageConnection: false
      }),
      forTenant: async (accountId): Promise<TaskListService> => {
        this.requestedTenantIds.push(accountId);
        return this.taskListService;
      },
      shoppingForTenant: async (
        accountId
      ): Promise<{
        readonly shoppingList: ShoppingListService;
        readonly printService: ShoppingListPrintService;
      }> => {
        this.requestedTenantIds.push(accountId);
        const shoppingList = new ShoppingListService(
          accountId === 'account-456' ? this.otherRepository : this.repository
        );
        return {
          shoppingList,
          printService: new ShoppingListPrintService(
            shoppingList,
            new PdfKitShoppingListRenderer(),
            () => new Date('2026-08-17T08:30:00.000Z')
          )
        };
      }
    },
    this.loopService,
    async () => {
      this.requestedTenantIds.push('account-123');
      return this.heartbeatHealthy && (await new ShoppingListService(this.repository).isReady());
    }
  );

  request(overrides: Partial<RestRequest>): RestRequest {
    return {
      method: 'GET',
      path: '/health',
      headers: {},
      query: {},
      requestId: 'request-1',
      ...overrides
    };
  }
}

describe('RestApiController', () => {
  it('creates and lists account-scoped loops only for a Life2 principal', async () => {
    const fixture = new RestControllerFixture();

    const create = await fixture.controller.handle(
      fixture.request({
        method: 'POST',
        path: '/v1/loops',
        headers: { authorization: 'Bearer life2-tenant' },
        body: JSON.stringify({
          title: 'Car service',
          outcome: 'The car has been serviced.',
          relatedRecords: [{ kind: 'task', recordId: 'task-7', label: 'Book service' }]
        })
      })
    );
    expect(create.statusCode).toBe(201);
    expect(JSON.parse(create.body).data).toEqual({
      id: 'loop-1',
      title: 'Car service',
      description: undefined,
      priority: 'medium',
      outcome: 'The car has been serviced.',
      dueDate: undefined,
      status: 'open',
      relatedRecords: [{ kind: 'task', recordId: 'task-7', label: 'Book service' }],
      createdAt: '2026-09-30T12:00:00.000Z',
      updatedAt: '2026-09-30T12:00:00.000Z',
      closedAt: undefined
    });

    const list = await fixture.controller.handle(
      fixture.request({
        path: '/v1/loops',
        headers: { authorization: 'Bearer life2-tenant' }
      })
    );
    expect(JSON.parse(list.body).data).toHaveLength(1);

    const automation = await fixture.controller.handle(
      fixture.request({
        method: 'POST',
        path: '/v1/loops',
        headers: { authorization: 'Bearer rest-secret' },
        body: JSON.stringify({ title: 'Nope', outcome: 'Nope' })
      })
    );
    expect(automation.statusCode).toBe(403);
  });

  it('reads, updates, filters, and explicitly closes Loops without crossing tenants', async () => {
    const fixture = new RestControllerFixture();
    const headers = { authorization: 'Bearer life2-tenant' };
    const request = (
      method: string,
      path: string,
      body?: unknown,
      query: Record<string, string> = {}
    ): Promise<RestResponse> =>
      fixture.controller.handle(
        fixture.request({
          method: method as RestRequest['method'],
          path,
          headers,
          query,
          ...(body === undefined ? {} : { body: JSON.stringify(body) })
        })
      );

    expect(
      (
        await request('POST', '/v1/loops', {
          title: 'Follow up',
          description: 'Details',
          outcome: 'Done',
          dueDate: '2026-10-15',
          priority: 'high',
          relatedRecords: [{ kind: 'entity', recordId: 'entity-1', label: 'Person' }]
        })
      ).statusCode
    ).toBe(201);
    const own = await request('GET', '/v1/loops/loop-1');
    expect(JSON.parse(own.body).data).toMatchObject({ id: 'loop-1', dueDate: '2026-10-15' });
    const foreign = await fixture.controller.handle(
      fixture.request({
        path: '/v1/loops/loop-1',
        headers: { authorization: 'Bearer life2-other' }
      })
    );
    expect(foreign.statusCode).toBe(404);
    const changed = await request('PATCH', '/v1/loops/loop-1', {
      title: 'Updated',
      description: null,
      dueDate: null,
      priority: 'low',
      relatedRecords: []
    });
    expect(JSON.parse(changed.body).data).toMatchObject({
      title: 'Updated',
      priority: 'low',
      relatedRecords: []
    });
    expect(
      JSON.parse((await request('GET', '/v1/loops', undefined, { status: 'closed' })).body).data
    ).toEqual([]);
    expect((await request('POST', '/v1/loops/loop-1/close', { confirmed: false })).statusCode).toBe(
      400
    );
    const closed = await request('POST', '/v1/loops/loop-1/close', { confirmed: true });
    expect(JSON.parse(closed.body).data.status).toBe('closed');
    expect(
      JSON.parse((await request('GET', '/v1/loops', undefined, { status: 'closed' })).body).data
    ).toHaveLength(1);
    expect((await request('PATCH', '/v1/loops/loop-1', { title: 'Too late' })).statusCode).toBe(
      400
    );
    expect((await request('GET', '/v1/loops/missing')).statusCode).toBe(404);
  });

  it('rejects malformed Loop bodies, unsupported fields, and automation reads', async () => {
    const fixture = new RestControllerFixture();
    const headers = { authorization: 'Bearer life2-tenant' };
    for (const [path, method, body] of [
      ['/v1/loops', 'POST', undefined],
      ['/v1/loops', 'POST', '{'],
      ['/v1/loops', 'POST', '[]'],
      ['/v1/loops', 'POST', '{"title":"T","outcome":"O","accountId":"tenant-b"}'],
      ['/v1/loops', 'POST', '{"title":12,"outcome":"O"}'],
      ['/v1/loops', 'POST', '{"title":"T","outcome":"O","relatedRecords":{}}'],
      [
        '/v1/loops',
        'POST',
        '{"title":"T","outcome":"O","relatedRecords":[{"kind":"task","recordId":"x","label":"X","url":"https://example.com"}]}'
      ],
      ['/v1/loops/missing', 'PATCH', '{}'],
      ['/v1/loops/missing', 'PATCH', '{"title":123}'],
      ['/v1/loops/missing/close', 'POST', '{"confirmed":false}']
    ] as const) {
      const response = await fixture.controller.handle(
        fixture.request({ path, method, headers, ...(body === undefined ? {} : { body }) })
      );
      expect(response.statusCode, `${method} ${path} ${body}`).toBe(400);
    }
    expect(
      (
        await fixture.controller.handle(
          fixture.request({ path: '/v1/loops', headers, query: { status: 'invalid' } })
        )
      ).statusCode
    ).toBe(400);
    for (const path of ['/v1/loops', '/v1/loops/loop-1']) {
      const response = await fixture.controller.handle(
        fixture.request({ path, headers: { authorization: 'Bearer rest-secret' } })
      );
      expect(response.statusCode).toBe(403);
    }
  });

  it('serves unauthenticated liveness without checking Todoist', async () => {
    const fixture = new RestControllerFixture();

    const response = await fixture.controller.handle(fixture.request({}));

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('"status":"ok"');
  });

  it('checks the deployment-bound Todoist Shopping project for the public heartbeat', async () => {
    const fixture = new RestControllerFixture();

    const response = await fixture.controller.handle(
      fixture.request({ path: '/health/heartbeat' })
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      data: { status: 'healthy', component: 'lists-service' },
      meta: { requestId: 'request-1' }
    });
    expect(fixture.requestedTenantIds).toEqual(['account-123']);
  });

  it('reports an unavailable Todoist dependency as an unhealthy public heartbeat', async () => {
    const fixture = new RestControllerFixture();
    fixture.heartbeatHealthy = false;

    const response = await fixture.controller.handle(
      fixture.request({ path: '/health/heartbeat' })
    );

    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.body)).toEqual({
      data: { status: 'unhealthy', component: 'lists-service' },
      meta: { requestId: 'request-1' }
    });
  });

  it('publishes the component semantic version and release revision without authentication', async () => {
    const previous = process.env['LIFE2_RELEASE_REVISION'];
    process.env['LIFE2_RELEASE_REVISION'] = 'lists-test-revision';
    try {
      const fixture = new RestControllerFixture();
      const response = await fixture.controller.handle(fixture.request({ path: '/version' }));
      expect(JSON.parse(response.body)).toEqual({
        schemaVersion: 1,
        component: 'lists-service',
        version: '0.9.0',
        revision: 'lists-test-revision'
      });
    } finally {
      if (previous === undefined) delete process.env['LIFE2_RELEASE_REVISION'];
      else process.env['LIFE2_RELEASE_REVISION'] = previous;
    }
  });

  it('protects every endpoint except liveness', async () => {
    const fixture = new RestControllerFixture();

    const response = await fixture.controller.handle(
      fixture.request({ path: '/v1/items', method: 'GET' })
    );

    expect(response.statusCode).toBe(401);
    expect(response.body).not.toContain('rest-secret');
  });

  it('lists active items in the standard envelope', async () => {
    const fixture = new RestControllerFixture();

    const response = await fixture.controller.handle(
      fixture.request({
        path: '/v1/items',
        method: 'GET',
        headers: { authorization: 'Bearer rest-secret' }
      })
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      data: [expect.objectContaining({ id: '1', content: 'milk', isCompleted: false })],
      meta: { requestId: 'request-1', count: 1 }
    });
  });

  it('returns the current active list as a downloadable PDF', async () => {
    const fixture = new RestControllerFixture();

    const response = await fixture.controller.handle(
      fixture.request({
        path: '/v1/items.pdf',
        method: 'GET',
        headers: { authorization: 'Bearer rest-secret' }
      })
    );

    const pdf = Buffer.from(response.body, 'base64');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="shopping-list.pdf"'
    );
    expect(response.isBase64Encoded).toBe(true);
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(pdf.subarray(-6).toString('ascii')).toContain('%%EOF');
  }, 30_000);

  it('returns 201 for a new item and 200 for an exact duplicate', async () => {
    const fixture = new RestControllerFixture();
    const headers = { authorization: 'Bearer rest-secret' };

    const created = await fixture.controller.handle(
      fixture.request({
        path: '/v1/items',
        method: 'POST',
        headers,
        body: JSON.stringify({ content: 'tea' })
      })
    );
    const duplicate = await fixture.controller.handle(
      fixture.request({
        path: '/v1/items',
        method: 'POST',
        headers,
        body: JSON.stringify({ content: ' TEA ' })
      })
    );

    expect(created.statusCode).toBe(201);
    expect(duplicate.statusCode).toBe(200);
    expect(JSON.parse(duplicate.body).meta.alreadyExists).toBe(true);
  });

  it('rejects unknown add-item fields', async () => {
    const fixture = new RestControllerFixture();

    const response = await fixture.controller.handle(
      fixture.request({
        path: '/v1/items',
        method: 'POST',
        headers: { authorization: 'Bearer rest-secret' },
        body: JSON.stringify({ content: 'tea', projectId: 'attacker-choice' })
      })
    );

    expect(response.statusCode).toBe(400);
  });

  it('requires the destructive confirmation header when clearing completed items', async () => {
    const fixture = new RestControllerFixture();

    const response = await fixture.controller.handle(
      fixture.request({
        path: '/v1/items',
        method: 'DELETE',
        headers: { authorization: 'Bearer rest-secret' },
        query: { status: 'completed' }
      })
    );

    expect(response.statusCode).toBe(400);
    expect(fixture.repository.deletedIds).toEqual([]);
  });

  it('maps complete, reopen, and delete routes to the shared service', async () => {
    const fixture = new RestControllerFixture();
    const headers = { authorization: 'Bearer rest-secret' };

    await fixture.controller.handle(
      fixture.request({ path: '/v1/items/1/complete', method: 'POST', headers })
    );
    await fixture.controller.handle(
      fixture.request({ path: '/v1/items/1/reopen', method: 'POST', headers })
    );
    await fixture.controller.handle(
      fixture.request({ path: '/v1/items/1', method: 'DELETE', headers })
    );

    expect(fixture.repository.completedIds).toEqual(['1']);
    expect(fixture.repository.reopenedIds).toEqual(['1']);
    expect(fixture.repository.deletedIds).toEqual(['1']);
  });

  it('updates an active shopping item through the verified tenant service', async () => {
    const fixture = new RestControllerFixture();

    const response = await fixture.controller.handle(
      fixture.request({
        path: '/v1/items/1',
        method: 'PATCH',
        headers: { authorization: 'Bearer life2-tenant' },
        body: JSON.stringify({ content: 'oat milk' })
      })
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      data: expect.objectContaining({ id: '1', content: 'oat milk', isCompleted: false }),
      meta: { requestId: 'request-1' }
    });
    expect(fixture.requestedTenantIds).toEqual(['account-123']);
  });

  it('creates and lists named task lists', async () => {
    const fixture = new RestControllerFixture();
    const headers = { authorization: 'Bearer life2-tenant' };

    const created = await fixture.controller.handle(
      fixture.request({
        path: '/v1/task-lists',
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Errands' })
      })
    );
    const listed = await fixture.controller.handle(
      fixture.request({ path: '/v1/task-lists', method: 'GET', headers })
    );

    expect(created.statusCode).toBe(201);
    expect(JSON.parse(created.body).data).toMatchObject({ name: 'Errands' });
    expect(JSON.parse(listed.body).meta.count).toBe(2);
    expect(fixture.requestedTenantIds).toEqual(['account-123', 'account-123']);
  });

  it('searches only the Life2 tenant task-list service with a bounded body', async () => {
    const fixture = new RestControllerFixture();
    const response = await fixture.controller.handle(
      fixture.request({
        path: '/api/v1/search',
        method: 'POST',
        headers: { authorization: 'Bearer life2-tenant' },
        body: JSON.stringify({ query: 'milk', limit: 5, accountId: 'account-456' })
      })
    );

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(JSON.parse(response.body)).toEqual({
      items: [
        {
          kind: 'task-list-task',
          resourceId: 'task-1',
          title: 'Milk',
          summary: 'Home',
          matchedField: 'content',
          score: 1,
          target: { routeName: 'task-lists', params: { listId: 'list-1', taskId: 'task-1' } }
        }
      ]
    });
    expect(fixture.requestedTenantIds).toEqual(['account-123']);
  });

  it('rejects automation credentials and unbounded workspace search input', async () => {
    const fixture = new RestControllerFixture();
    const request = (authorization: string, body: object): Promise<RestResponse> =>
      fixture.controller.handle(
        fixture.request({
          path: '/api/v1/search',
          method: 'POST',
          headers: { authorization },
          body: JSON.stringify(body)
        })
      );

    expect((await request('Bearer rest-secret', { query: 'milk', limit: 5 })).statusCode).toBe(403);
    expect((await request('Bearer life2-tenant', { query: 'x', limit: 5 })).statusCode).toBe(400);
    expect((await request('Bearer life2-tenant', { query: 'milk', limit: 31 })).statusCode).toBe(
      400
    );
  });

  it('requires a tenant-identifying Life2 JWT for Task Lists and exposes tenant connection state', async () => {
    const fixture = new RestControllerFixture();

    const automation = await fixture.controller.handle(
      fixture.request({
        path: '/v1/task-lists',
        headers: { authorization: 'Bearer rest-secret' }
      })
    );
    const connected = await fixture.controller.handle(
      fixture.request({
        path: '/v1/todoist/connection',
        headers: { authorization: 'Bearer life2-tenant' }
      })
    );
    const otherTenant = await fixture.controller.handle(
      fixture.request({
        path: '/v1/todoist/connection',
        headers: { authorization: 'Bearer life2-other' }
      })
    );

    expect(automation.statusCode).toBe(403);
    expect(JSON.parse(connected.body).data).toEqual({
      status: 'connected',
      canManageConnection: false
    });
    expect(JSON.parse(otherTenant.body).data).toEqual({
      status: 'connected',
      canManageConnection: false
    });
  });

  it('resolves Shopping from each verified tenant connection', async () => {
    const fixture = new RestControllerFixture();
    const response = await fixture.controller.handle(
      fixture.request({
        path: '/v1/items',
        headers: { authorization: 'Bearer life2-other' }
      })
    );
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('tenant-b-item');
    expect(response.body).not.toContain('milk');
    expect(fixture.requestedTenantIds).toEqual(['account-456']);
  });

  it('supports nested task create, edit, complete, delete, and list routes', async () => {
    const fixture = new RestControllerFixture();
    const headers = { authorization: 'Bearer life2-tenant' };

    const created = await fixture.controller.handle(
      fixture.request({
        path: '/v1/task-lists/list-1/tasks',
        method: 'POST',
        headers,
        body: JSON.stringify({ content: 'Tea' })
      })
    );
    const updated = await fixture.controller.handle(
      fixture.request({
        path: '/v1/task-lists/list-1/tasks/task-1',
        method: 'PATCH',
        headers,
        body: JSON.stringify({ content: 'Oat milk' })
      })
    );
    await fixture.controller.handle(
      fixture.request({
        path: '/v1/task-lists/list-1/tasks/task-1/complete',
        method: 'POST',
        headers
      })
    );
    await fixture.controller.handle(
      fixture.request({
        path: '/v1/task-lists/list-1/tasks/task-2',
        method: 'DELETE',
        headers
      })
    );
    const listed = await fixture.controller.handle(
      fixture.request({ path: '/v1/task-lists/list-1/tasks', method: 'GET', headers })
    );

    expect(created.statusCode).toBe(201);
    expect(JSON.parse(updated.body).data).toMatchObject({ content: 'Oat milk', position: 1 });
    expect(fixture.taskListRepository.completedIds).toContain('task-1');
    expect(fixture.taskListRepository.deletedIds).toEqual(['task-2']);
    expect(JSON.parse(listed.body).meta.count).toBe(3);
  });

  it('reorders only with a strict taskIds body', async () => {
    const fixture = new RestControllerFixture();
    const response = await fixture.controller.handle(
      fixture.request({
        path: '/v1/task-lists/list-1/tasks/order',
        method: 'PUT',
        headers: { authorization: 'Bearer life2-tenant' },
        body: JSON.stringify({ taskIds: ['task-2', 'task-1'] })
      })
    );

    expect(response.statusCode).toBe(200);
    expect(fixture.taskListRepository.reordered).toEqual([
      { id: 'task-2', position: 1 },
      { id: 'task-1', position: 2 }
    ]);
  });

  it('completes active tasks and archives a list only with destructive confirmation', async () => {
    const fixture = new RestControllerFixture();
    const headers = { authorization: 'Bearer life2-tenant' };

    const rejected = await fixture.controller.handle(
      fixture.request({ path: '/v1/task-lists/list-1', method: 'DELETE', headers })
    );
    const deleted = await fixture.controller.handle(
      fixture.request({
        path: '/v1/task-lists/list-1',
        method: 'DELETE',
        headers: { ...headers, 'x-confirm-destructive-action': 'true' }
      })
    );

    expect(rejected.statusCode).toBe(400);
    expect(deleted.statusCode).toBe(200);
    expect(JSON.parse(deleted.body).data).toEqual({ deleted: true, completedCount: 2 });
    expect(fixture.taskListRepository.archivedIds).toEqual(['list-1']);
  });

  it('serves authenticated readiness', async () => {
    const fixture = new RestControllerFixture();

    const response = await fixture.controller.handle(
      fixture.request({
        path: '/health/ready',
        headers: { authorization: 'Bearer rest-secret' }
      })
    );

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('"ready"');
  });

  it.each([
    { path: '/v1/items', method: 'GET', query: { status: 'invalid' } },
    { path: '/v1/items', method: 'POST', body: '{not-json' },
    { path: '/v1/unknown', method: 'GET' }
  ])('returns a safe client error for malformed or unknown requests', async (input) => {
    const fixture = new RestControllerFixture();

    const response = await fixture.controller.handle(
      fixture.request({
        ...input,
        headers: { authorization: 'Bearer rest-secret' }
      })
    );

    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.body).not.toContain('stack');
  });
});

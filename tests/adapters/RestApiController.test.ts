import { describe, expect, it } from 'vitest';

import { RestApiController, type RestRequest } from '../../src/adapters/rest/RestApiController.js';
import { RestBearerAuthenticator } from '../../src/adapters/rest/RestBearerAuthenticator.js';
import { ShoppingListService } from '../../src/application/ShoppingListService.js';
import { ShoppingListItem } from '../../src/domain/ShoppingListItem.js';
import { InMemoryShoppingListRepository } from '../support/InMemoryShoppingListRepository.js';

class RestControllerFixture {
  readonly repository = new InMemoryShoppingListRepository([
    new ShoppingListItem('1', 'milk', false),
    new ShoppingListItem('2', 'bread', true)
  ]);
  readonly controller = new RestApiController(
    new ShoppingListService(this.repository),
    new RestBearerAuthenticator('rest-secret')
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
  it('serves unauthenticated liveness without checking Todoist', async () => {
    const fixture = new RestControllerFixture();

    const response = await fixture.controller.handle(fixture.request({}));

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('"status":"ok"');
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

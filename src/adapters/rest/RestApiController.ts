import type { ShoppingListService } from '../../application/ShoppingListService.js';
import type { ShoppingListPrintService } from '../../application/ShoppingListPrintService.js';
import type { TaskListService } from '../../application/TaskListService.js';
import type { ItemStatus } from '../../application/ports/ShoppingListRepository.js';
import { ApplicationError, RouteNotFoundError, ValidationError } from '../../domain/errors.js';
import type { RestAuthenticator } from './RestBearerAuthenticator.js';
import packageJson from '../../../package.json' with { type: 'json' };

export interface RestRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly query: Readonly<Record<string, string | undefined>>;
  readonly requestId: string;
  readonly body?: string;
}

export interface RestResponse {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly isBase64Encoded?: boolean;
}

export class RestApiController {
  constructor(
    private readonly service: ShoppingListService,
    private readonly authenticator: RestAuthenticator,
    private readonly printService: ShoppingListPrintService,
    private readonly taskListService: TaskListService
  ) {}

  async handle(request: RestRequest): Promise<RestResponse> {
    try {
      if (request.method === 'GET' && request.path === '/health') {
        return this.success(200, { status: 'ok' }, request.requestId);
      }
      if (request.method === 'GET' && request.path === '/version') {
        return this.success(
          200,
          {
            schemaVersion: 1,
            component: 'lists-service',
            version: packageJson.version,
            revision:
              process.env['LIFE2_RELEASE_REVISION'] ??
              process.env['RELEASE_GIT_COMMIT'] ??
              'development'
          },
          request.requestId
        );
      }
      if (!this.authenticator.isAuthenticated(request.headers['authorization'])) {
        return this.error(
          401,
          'AUTHENTICATION_REQUIRED',
          'A valid bearer token is required.',
          request.requestId
        );
      }
      return await this.routeAuthenticated(request);
    } catch (error: unknown) {
      if (error instanceof ApplicationError) {
        return this.error(error.httpStatus, error.code, error.message, request.requestId);
      }
      return this.error(
        500,
        'INTERNAL_ERROR',
        'The request could not be completed.',
        request.requestId
      );
    }
  }

  private async routeAuthenticated(request: RestRequest): Promise<RestResponse> {
    if (request.method === 'GET' && request.path === '/health/ready') {
      const isReady = await this.service.isReady();
      return this.success(
        isReady ? 200 : 503,
        { status: isReady ? 'ready' : 'not_ready' },
        request.requestId
      );
    }
    if (request.path === '/v1/items.pdf' && request.method === 'GET') {
      const document = await this.printService.generate();
      return {
        statusCode: 200,
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': `attachment; filename="${document.filename}"`,
          'cache-control': 'no-store'
        },
        body: document.bytes.toString('base64'),
        isBase64Encoded: true
      };
    }
    if (request.path === '/v1/items' && request.method === 'GET') {
      const status = this.parseStatus(request.query['status']);
      const items = await this.service.list(status);
      return this.success(200, items, request.requestId, { count: items.length });
    }
    if (request.path === '/v1/items' && request.method === 'POST') {
      const content = this.parseAddBody(request.body);
      const result = await this.service.add(content);
      return this.success(result.alreadyExists ? 200 : 201, result.item, request.requestId, {
        alreadyExists: result.alreadyExists
      });
    }
    if (
      request.path === '/v1/items' &&
      request.method === 'DELETE' &&
      request.query['status'] === 'completed'
    ) {
      const isConfirmed =
        request.headers['x-confirm-destructive-action']?.toLocaleLowerCase('en-GB') === 'true';
      const deletedCount = await this.service.clearCompleted(isConfirmed);
      return this.success(200, { deletedCount }, request.requestId);
    }
    if (request.path === '/v1/task-lists' || request.path.startsWith('/v1/task-lists/')) {
      return this.routeTaskLists(request);
    }

    const itemRoute = /^\/v1\/items\/([^/]+?)(?:\/(complete|reopen))?$/u.exec(request.path);
    if (itemRoute !== null) {
      const itemId = decodeURIComponent(itemRoute[1] as string);
      const action = itemRoute[2];
      if (request.method === 'DELETE' && action === undefined) {
        await this.service.deleteById(itemId);
        return this.success(200, { deleted: true }, request.requestId);
      }
      if (request.method === 'POST' && action === 'complete') {
        await this.service.completeById(itemId);
        return this.success(200, { completed: true }, request.requestId);
      }
      if (request.method === 'POST' && action === 'reopen') {
        await this.service.reopenById(itemId);
        return this.success(200, { reopened: true }, request.requestId);
      }
    }
    throw new RouteNotFoundError();
  }

  private async routeTaskLists(request: RestRequest): Promise<RestResponse> {
    if (request.path === '/v1/task-lists' && request.method === 'GET') {
      const lists = await this.taskListService.listTaskLists();
      return this.success(200, lists, request.requestId, { count: lists.length });
    }
    if (request.path === '/v1/task-lists' && request.method === 'POST') {
      const list = await this.taskListService.createTaskList(
        this.parseSingleStringBody(request.body, 'name')
      );
      return this.success(201, list, request.requestId);
    }

    const listRoute = /^\/v1\/task-lists\/([^/]+)$/u.exec(request.path);
    if (listRoute !== null && request.method === 'DELETE') {
      const listId = decodeURIComponent(listRoute[1] as string);
      const isConfirmed =
        request.headers['x-confirm-destructive-action']?.toLocaleLowerCase('en-GB') === 'true';
      const result = await this.taskListService.deleteTaskList(listId, isConfirmed);
      return this.success(
        200,
        { deleted: true, completedCount: result.completedCount },
        request.requestId
      );
    }

    const tasksRoute = /^\/v1\/task-lists\/([^/]+)\/tasks$/u.exec(request.path);
    if (tasksRoute !== null) {
      const listId = decodeURIComponent(tasksRoute[1] as string);
      if (request.method === 'GET') {
        const tasks = await this.taskListService.listTasks(
          listId,
          this.parseStatus(request.query['status'])
        );
        return this.success(200, tasks, request.requestId, { count: tasks.length });
      }
      if (request.method === 'POST') {
        const task = await this.taskListService.createTask(
          listId,
          this.parseSingleStringBody(request.body, 'content')
        );
        return this.success(201, task, request.requestId);
      }
    }

    const orderRoute = /^\/v1\/task-lists\/([^/]+)\/tasks\/order$/u.exec(request.path);
    if (orderRoute !== null && request.method === 'PUT') {
      const listId = decodeURIComponent(orderRoute[1] as string);
      await this.taskListService.reorderTasks(listId, this.parseTaskOrderBody(request.body));
      return this.success(200, { reordered: true }, request.requestId);
    }

    const taskRoute = /^\/v1\/task-lists\/([^/]+)\/tasks\/([^/]+?)(?:\/(complete))?$/u.exec(
      request.path
    );
    if (taskRoute !== null) {
      const listId = decodeURIComponent(taskRoute[1] as string);
      const taskId = decodeURIComponent(taskRoute[2] as string);
      const action = taskRoute[3];
      if (request.method === 'PATCH' && action === undefined) {
        const task = await this.taskListService.updateTask(
          listId,
          taskId,
          this.parseSingleStringBody(request.body, 'content')
        );
        return this.success(200, task, request.requestId);
      }
      if (request.method === 'DELETE' && action === undefined) {
        await this.taskListService.deleteTask(listId, taskId);
        return this.success(200, { deleted: true }, request.requestId);
      }
      if (request.method === 'POST' && action === 'complete') {
        await this.taskListService.completeTask(listId, taskId);
        return this.success(200, { completed: true }, request.requestId);
      }
    }
    throw new RouteNotFoundError();
  }

  private parseStatus(value: string | undefined): ItemStatus {
    const status = value ?? 'active';
    if (status !== 'active' && status !== 'completed' && status !== 'all') {
      throw new ValidationError('status must be active, completed, or all.');
    }
    return status;
  }

  private parseAddBody(body: string | undefined): string {
    return this.parseSingleStringBody(body, 'content');
  }

  private parseSingleStringBody(body: string | undefined, field: 'content' | 'name'): string {
    if (body === undefined) {
      throw new ValidationError('A JSON request body is required.');
    }
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      throw new ValidationError('The request body must be valid JSON.');
    }
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      throw new ValidationError('The request body must be a JSON object.');
    }
    const values = payload as Record<string, unknown>;
    if (Object.keys(values).length !== 1 || typeof values[field] !== 'string') {
      throw new ValidationError(`The request body must contain only a string ${field} field.`);
    }
    return values[field];
  }

  private parseTaskOrderBody(body: string | undefined): string[] {
    if (body === undefined) throw new ValidationError('A JSON request body is required.');
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      throw new ValidationError('The request body must be valid JSON.');
    }
    if (
      typeof payload !== 'object' ||
      payload === null ||
      Array.isArray(payload) ||
      Object.keys(payload).length !== 1 ||
      !('taskIds' in payload) ||
      !Array.isArray(payload.taskIds) ||
      !payload.taskIds.every((taskId) => typeof taskId === 'string')
    ) {
      throw new ValidationError('The request body must contain only a string taskIds array.');
    }
    return payload.taskIds;
  }

  private success(
    statusCode: number,
    data: unknown,
    requestId: string,
    additionalMeta: Readonly<Record<string, unknown>> = {}
  ): RestResponse {
    return this.response(statusCode, {
      data,
      meta: { requestId, ...additionalMeta }
    });
  }

  private error(
    statusCode: number,
    code: string,
    message: string,
    requestId: string
  ): RestResponse {
    return this.response(statusCode, {
      error: { code, message },
      meta: { requestId }
    });
  }

  private response(statusCode: number, payload: unknown): RestResponse {
    return {
      statusCode,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store'
      },
      body: JSON.stringify(payload)
    };
  }
}

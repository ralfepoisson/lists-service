import type { TaskListService } from '../../application/TaskListService.js';
import type {
  LoopService,
  CreateLoopInput,
  UpdateLoopInput
} from '../../application/LoopService.js';
import type { Loop, RelatedRecord } from '../../domain/Loop.js';
import type { TagEntityKind } from '../../application/ports/TagRepository.js';
import type { TagService } from '../../application/TagService.js';
import type { ItemStatus } from '../../application/ports/ShoppingListRepository.js';
import type { TenantTaskListServiceProvider } from '../../application/ports/TenantTaskListServiceProvider.js';
import {
  ApplicationError,
  AuthorizationForbiddenError,
  RouteNotFoundError,
  ValidationError
} from '../../domain/errors.js';
import type { RestAuthenticator, RestPrincipal } from './RestBearerAuthenticator.js';
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

export type HeartbeatCheck = () => Promise<boolean>;

export class RestApiController {
  constructor(
    private readonly authenticator: RestAuthenticator,
    private readonly taskListServices: TenantTaskListServiceProvider,
    private readonly loopService: LoopService,
    private readonly tagService: TagService,
    private readonly heartbeatCheck: HeartbeatCheck
  ) {}

  async handle(request: RestRequest): Promise<RestResponse> {
    try {
      if (request.method === 'GET' && request.path === '/health') {
        return this.success(200, { status: 'ok' }, request.requestId);
      }
      if (request.method === 'GET' && request.path === '/health/heartbeat') {
        const healthy = await this.heartbeatCheck();
        return this.success(
          healthy ? 200 : 503,
          { status: healthy ? 'healthy' : 'unhealthy', component: 'lists-service' },
          request.requestId
        );
      }
      if (request.method === 'GET' && request.path === '/version') {
        return this.response(200, {
          schemaVersion: 1,
          component: 'lists-service',
          version: packageJson.version,
          revision:
            process.env['LIFE2_RELEASE_REVISION'] ??
            process.env['RELEASE_GIT_COMMIT'] ??
            'development'
        });
      }
      const principal = this.authenticator.authenticate(request.headers['authorization']);
      if (principal === undefined) {
        return this.error(
          401,
          'AUTHENTICATION_REQUIRED',
          'A valid bearer token is required.',
          request.requestId
        );
      }
      return await this.routeAuthenticated(request, principal);
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

  private async routeAuthenticated(
    request: RestRequest,
    principal: RestPrincipal
  ): Promise<RestResponse> {
    if (principal.authMethod === 'life2' && principal.applicationId === 'life2-email-agents') {
      const hasDispatchScope = (principal.scope ?? '')
        .split(/\s+/u)
        .includes('life2:task-dispatch');
      const allowedRead =
        request.method === 'GET' &&
        (request.path === '/v1/task-lists' ||
          /^\/v1\/task-lists\/[^/]+\/tasks$/u.test(request.path));
      const allowedWrite =
        request.method === 'POST' &&
        /^\/v1\/task-lists\/[^/]+\/tasks(?:\/[^/]+\/(?:comments|complete))?$/u.test(request.path);
      if (!hasDispatchScope || (!allowedRead && !allowedWrite)) {
        throw new AuthorizationForbiddenError(
          'Email agents may only use fixed task-dispatch operations.'
        );
      }
    }
    if (request.method === 'GET' && request.path === '/health/ready') {
      const tenant = this.requireTenantPrincipal(principal);
      const { shoppingList } = await this.taskListServices.shoppingForTenant(tenant.accountId);
      const isReady = await shoppingList.isReady();
      return this.success(
        isReady ? 200 : 503,
        { status: isReady ? 'ready' : 'not_ready' },
        request.requestId
      );
    }
    if (request.path === '/v1/todoist/connection' && request.method === 'GET') {
      const life2Principal = this.requireLife2Principal(principal);
      return this.success(
        200,
        await this.taskListServices.connectionStatus(life2Principal.accountId),
        request.requestId
      );
    }
    if (
      request.path === '/v1/tags' ||
      request.path.startsWith('/v1/tags/') ||
      request.path.endsWith('/tags')
    ) {
      const tenant = this.requireLife2Principal(principal);
      return this.routeTags(request, tenant.accountId);
    }
    if (request.path === '/v1/todoist/connection/authorizations' && request.method === 'POST') {
      this.requireLife2Principal(principal);
      throw new AuthorizationForbiddenError(
        'Todoist connections are provisioned through the server-side tenant connection catalogue.'
      );
    }
    if (request.path === '/v1/todoist/connection' && request.method === 'DELETE') {
      this.requireLife2Principal(principal);
      throw new AuthorizationForbiddenError(
        'Todoist connections are managed through the server-side tenant connection catalogue.'
      );
    }
    if (request.path === '/v1/loops' || request.path.startsWith('/v1/loops/')) {
      const life2Principal = this.requireLife2Principal(principal);
      return this.routeLoops(
        request,
        life2Principal.accountId,
        life2Principal.sub,
        life2Principal.email
      );
    }
    if (request.path === '/api/v1/search' && request.method === 'POST') {
      const life2Principal = this.requireLife2Principal(principal);
      const search = this.parseSearchBody(request.body);
      const taskListService = await this.taskListServices.forTenant(life2Principal.accountId);
      return this.response(
        200,
        { items: await taskListService.search(search.query, search.limit) },
        {
          'cache-control': 'private, no-store'
        }
      );
    }
    if (request.path === '/v1/items.pdf' && request.method === 'GET') {
      const tenant = this.requireTenantPrincipal(principal);
      const { printService } = await this.taskListServices.shoppingForTenant(tenant.accountId);
      const document = await printService.generate();
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
      const tenant = this.requireTenantPrincipal(principal);
      const { shoppingList } = await this.taskListServices.shoppingForTenant(tenant.accountId);
      const status = this.parseStatus(request.query['status']);
      const items = await shoppingList.list(status);
      return this.success(200, items, request.requestId, { count: items.length });
    }
    if (request.path === '/v1/items' && request.method === 'POST') {
      const tenant = this.requireTenantPrincipal(principal);
      const { shoppingList } = await this.taskListServices.shoppingForTenant(tenant.accountId);
      const content = this.parseAddBody(request.body);
      const result = await shoppingList.add(content);
      return this.success(result.alreadyExists ? 200 : 201, result.item, request.requestId, {
        alreadyExists: result.alreadyExists
      });
    }
    if (
      request.path === '/v1/items' &&
      request.method === 'DELETE' &&
      request.query['status'] === 'completed'
    ) {
      const tenant = this.requireTenantPrincipal(principal);
      const { shoppingList } = await this.taskListServices.shoppingForTenant(tenant.accountId);
      const isConfirmed =
        request.headers['x-confirm-destructive-action']?.toLocaleLowerCase('en-GB') === 'true';
      const deletedCount = await shoppingList.clearCompleted(isConfirmed);
      return this.success(200, { deletedCount }, request.requestId);
    }
    if (request.path === '/v1/task-lists' || request.path.startsWith('/v1/task-lists/')) {
      const life2Principal = this.requireLife2Principal(principal);
      return this.routeTaskLists(
        request,
        await this.taskListServices.forTenant(life2Principal.accountId)
      );
    }

    const itemRoute = /^\/v1\/items\/([^/]+?)(?:\/(complete|reopen))?$/u.exec(request.path);
    if (itemRoute !== null) {
      const tenant = this.requireTenantPrincipal(principal);
      const { shoppingList } = await this.taskListServices.shoppingForTenant(tenant.accountId);
      const itemId = decodeURIComponent(itemRoute[1] as string);
      const action = itemRoute[2];
      if (request.method === 'DELETE' && action === undefined) {
        await shoppingList.deleteById(itemId);
        return this.success(200, { deleted: true }, request.requestId);
      }
      if (request.method === 'PATCH' && action === undefined) {
        const item = await shoppingList.updateById(itemId, this.parseAddBody(request.body));
        return this.success(200, item, request.requestId);
      }
      if (request.method === 'POST' && action === 'complete') {
        await shoppingList.completeById(itemId);
        return this.success(200, { completed: true }, request.requestId);
      }
      if (request.method === 'POST' && action === 'reopen') {
        await shoppingList.reopenById(itemId);
        return this.success(200, { reopened: true }, request.requestId);
      }
    }
    throw new RouteNotFoundError();
  }

  private async routeTaskLists(
    request: RestRequest,
    taskListService: TaskListService
  ): Promise<RestResponse> {
    if (request.path === '/v1/task-lists' && request.method === 'GET') {
      const lists = await taskListService.listTaskLists();
      return this.success(200, lists, request.requestId, { count: lists.length });
    }
    if (request.path === '/v1/task-lists' && request.method === 'POST') {
      const list = await taskListService.createTaskList(
        this.parseSingleStringBody(request.body, 'name')
      );
      return this.success(201, list, request.requestId);
    }

    const listRoute = /^\/v1\/task-lists\/([^/]+)$/u.exec(request.path);
    if (listRoute !== null && request.method === 'DELETE') {
      const listId = decodeURIComponent(listRoute[1] as string);
      const isConfirmed =
        request.headers['x-confirm-destructive-action']?.toLocaleLowerCase('en-GB') === 'true';
      const result = await taskListService.deleteTaskList(listId, isConfirmed);
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
        const tasks = await taskListService.listTasks(
          listId,
          this.parseStatus(request.query['status'])
        );
        return this.success(200, tasks, request.requestId, { count: tasks.length });
      }
      if (request.method === 'POST') {
        const task = await taskListService.createTask(
          listId,
          this.parseSingleStringBody(request.body, 'content'),
          request.headers['idempotency-key']
        );
        return this.success(201, task, request.requestId);
      }
    }

    const commentRoute = /^\/v1\/task-lists\/([^/]+)\/tasks\/([^/]+)\/comments$/u.exec(
      request.path
    );
    if (commentRoute !== null && request.method === 'POST') {
      const comment = await taskListService.createComment(
        decodeURIComponent(commentRoute[1] as string),
        decodeURIComponent(commentRoute[2] as string),
        this.parseSingleStringBody(request.body, 'content'),
        request.headers['idempotency-key']
      );
      return this.success(201, comment, request.requestId);
    }

    const orderRoute = /^\/v1\/task-lists\/([^/]+)\/tasks\/order$/u.exec(request.path);
    if (orderRoute !== null && request.method === 'PUT') {
      const listId = decodeURIComponent(orderRoute[1] as string);
      await taskListService.reorderTasks(listId, this.parseTaskOrderBody(request.body));
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
        const task = await taskListService.updateTask(
          listId,
          taskId,
          this.parseSingleStringBody(request.body, 'content')
        );
        return this.success(200, task, request.requestId);
      }
      if (request.method === 'DELETE' && action === undefined) {
        await taskListService.deleteTask(listId, taskId);
        return this.success(200, { deleted: true }, request.requestId);
      }
      if (request.method === 'POST' && action === 'complete') {
        await taskListService.completeTask(listId, taskId);
        return this.success(200, { completed: true }, request.requestId);
      }
    }
    throw new RouteNotFoundError();
  }

  private async routeTags(request: RestRequest, accountId: string): Promise<RestResponse> {
    if (request.path === '/v1/tags' && request.method === 'GET') {
      const query = request.query['query'] ?? '';
      const limit = this.parsePageNumber(request.query['limit'], 50, 100);
      const offset = this.parsePageNumber(request.query['offset'], 0, 100_000);
      return this.success(
        200,
        await this.tagService.list(accountId, query, limit, offset),
        request.requestId,
        { count: limit }
      );
    }
    if (request.path === '/v1/tags' && request.method === 'POST') {
      const values = this.parseObjectBody(request.body);
      this.onlyFields(values, ['name']);
      if (typeof values['name'] !== 'string') throw new ValidationError('name must be a string.');
      return this.success(
        201,
        await this.tagService.create(accountId, values['name']),
        request.requestId
      );
    }
    const explore = /^\/v1\/tags\/([^/]+)\/(loops|tasks|items)$/u.exec(request.path);
    if (explore !== null && request.method === 'GET') {
      const tagId = decodeURIComponent(explore[1] as string);
      const kind = ({ loops: 'loop', tasks: 'task', items: 'item' } as const)[
        explore[2] as 'loops' | 'tasks' | 'items'
      ];
      const limit = this.parsePageNumber(request.query['limit'], 50, 100);
      const offset = this.parsePageNumber(request.query['offset'], 0, 100_000);
      const status = kind === 'loop' ? this.parseLoopStatus(request.query['status']) : 'all';
      const references = await this.tagService.explore(
        accountId,
        tagId,
        kind,
        limit,
        offset,
        status
      );
      const results: Record<string, unknown>[] = [];
      const taskLists =
        kind === 'task' ? await this.taskListServices.forTenant(accountId) : undefined;
      const tasksByList = new Map<string, Awaited<ReturnType<TaskListService['listTasks']>>>();
      const shopping =
        kind === 'item' ? await this.taskListServices.shoppingForTenant(accountId) : undefined;
      const shoppingItems = shopping ? await shopping.shoppingList.list('all') : undefined;
      const loops = kind === 'loop' ? await this.loopService.list(accountId, status) : undefined;
      for (const reference of references) {
        if (reference.kind === 'loop') {
          const loop = loops?.find((item) => item.id === reference.id);
          if (loop)
            results.push({ kind: 'loop', id: loop.id, label: loop.title, status: loop.status });
        } else if (reference.kind === 'task' && reference.listId !== undefined) {
          let tasks = tasksByList.get(reference.listId);
          if (!tasks && taskLists) {
            tasks = await taskLists.listTasks(reference.listId, 'all');
            tasksByList.set(reference.listId, tasks);
          }
          const task = tasks?.find((item) => item.id === reference.id);
          if (task)
            results.push({
              kind: 'task',
              id: task.id,
              listId: reference.listId,
              label: task.content,
              isCompleted: task.isCompleted
            });
        } else if (reference.kind === 'item') {
          const item = shoppingItems?.find((candidate) => candidate.id === reference.id);
          if (item)
            results.push({
              kind: 'item',
              id: item.id,
              label: item.content,
              isCompleted: item.isCompleted
            });
        }
      }
      return this.success(200, results, request.requestId, {
        count: results.length,
        limit,
        offset,
        hasMore: references.length === limit
      });
    }
    const entityRoute =
      /^\/v1\/(loops\/([^/]+)|task-lists\/([^/]+)\/tasks\/([^/]+)|items\/([^/]+))\/tags$/u.exec(
        request.path
      );
    if (entityRoute !== null) {
      const kind: TagEntityKind =
        entityRoute[2] !== undefined ? 'loop' : entityRoute[5] !== undefined ? 'item' : 'task';
      const entityId = decodeURIComponent(
        (entityRoute[2] ?? entityRoute[4] ?? entityRoute[5]) as string
      );
      const listId = entityRoute[3] === undefined ? undefined : decodeURIComponent(entityRoute[3]);
      return this.routeEntityTags(request, accountId, kind, entityId, listId);
    }
    throw new RouteNotFoundError();
  }

  private async routeEntityTags(
    request: RestRequest,
    accountId: string,
    kind: TagEntityKind,
    entityId: string,
    listId?: string
  ): Promise<RestResponse> {
    if (request.method === 'POST' || request.method === 'DELETE') {
      await this.assertTaggableEntity(accountId, kind, entityId, listId);
    }
    if (request.method === 'POST') {
      const values = this.parseObjectBody(request.body);
      this.onlyFields(values, ['tagId']);
      if (typeof values['tagId'] !== 'string') throw new ValidationError('tagId must be a string.');
      return this.success(
        200,
        await this.tagService.assign(accountId, values['tagId'], kind, entityId, listId),
        request.requestId
      );
    }
    if (request.method === 'DELETE') {
      const tagId = request.query['tagId'];
      if (!tagId) throw new ValidationError('tagId query parameter is required.');
      return this.success(
        200,
        await this.tagService.remove(accountId, tagId, kind, entityId, listId),
        request.requestId
      );
    }
    if (request.method === 'GET') {
      await this.assertTaggableEntity(accountId, kind, entityId, listId);
      return this.success(
        200,
        await this.tagService.forEntity(accountId, kind, entityId, listId),
        request.requestId
      );
    }
    throw new RouteNotFoundError();
  }

  private async assertTaggableEntity(
    accountId: string,
    kind: TagEntityKind,
    entityId: string,
    listId?: string
  ): Promise<void> {
    if (kind === 'loop') {
      await this.loopService.get(accountId, entityId);
      return;
    }
    if (kind === 'task') {
      if (!listId) throw new ValidationError('listId is required for a Todoist task.');
      const service = await this.taskListServices.forTenant(accountId);
      if (!(await service.listTasks(listId, 'all')).some((task) => task.id === entityId)) {
        throw new ValidationError('The task does not belong to the supplied list and tenant.');
      }
      return;
    }
    const { shoppingList } = await this.taskListServices.shoppingForTenant(accountId);
    if (!(await shoppingList.list('all')).some((item) => item.id === entityId)) {
      throw new ValidationError('The item does not belong to the authenticated tenant.');
    }
  }

  private parsePageNumber(value: string | undefined, fallback: number, maximum: number): number {
    if (value === undefined) return fallback;
    if (!/^\d+$/u.test(value))
      throw new ValidationError('Pagination values must be whole numbers.');
    const number = Number(value);
    if (number > maximum) throw new ValidationError(`Pagination value must not exceed ${maximum}.`);
    return number;
  }

  private async routeLoops(
    request: RestRequest,
    accountId: string,
    sub: string,
    email: string
  ): Promise<RestResponse> {
    if (request.path === '/v1/loops' && request.method === 'GET') {
      const status = this.parseLoopStatus(request.query['status']);
      const loops = await this.loopService.list(accountId, status);
      return this.success(
        200,
        loops.map((loop) => this.publicLoop(loop)),
        request.requestId,
        {
          count: loops.length
        }
      );
    }
    if (request.path === '/v1/loops' && request.method === 'POST') {
      return this.success(
        201,
        this.publicLoop(
          await this.loopService.create(accountId, sub, this.parseCreateLoopBody(request.body))
        ),
        request.requestId
      );
    }

    const loopRoute = /^\/v1\/loops\/([^/]+?)(?:\/(close|comments))?$/u.exec(request.path);
    if (loopRoute === null) throw new RouteNotFoundError();
    const loopId = decodeURIComponent(loopRoute[1] as string);
    const action = loopRoute[2];
    if (request.method === 'GET' && action === 'comments') {
      return this.success(
        200,
        await this.loopService.listComments(accountId, loopId),
        request.requestId
      );
    }
    if (request.method === 'POST' && action === 'comments') {
      return this.success(
        201,
        await this.loopService.addComment(
          accountId,
          sub,
          loopId,
          this.parseSingleStringBody(request.body, 'content'),
          email
        ),
        request.requestId
      );
    }
    if (request.method === 'GET' && action === undefined) {
      return this.success(
        200,
        this.publicLoop(await this.loopService.get(accountId, loopId)),
        request.requestId
      );
    }
    if (request.method === 'PATCH' && action === undefined) {
      return this.success(
        200,
        this.publicLoop(
          await this.loopService.update(
            accountId,
            sub,
            loopId,
            this.parseUpdateLoopBody(request.body)
          )
        ),
        request.requestId
      );
    }
    if (request.method === 'POST' && action === 'close') {
      return this.success(
        200,
        this.publicLoop(
          await this.loopService.close(
            accountId,
            sub,
            loopId,
            this.parseCloseLoopBody(request.body)
          )
        ),
        request.requestId
      );
    }
    throw new RouteNotFoundError();
  }

  private requireLife2Principal(
    principal: RestPrincipal
  ): Extract<RestPrincipal, { authMethod: 'life2' }> {
    if (principal.authMethod !== 'life2') throw new AuthorizationForbiddenError();
    return principal;
  }

  private publicLoop(loop: Loop): Record<string, unknown> {
    return {
      id: loop.id,
      title: loop.title,
      description: loop.description,
      priority: loop.priority,
      outcome: loop.outcome,
      dueDate: loop.dueDate,
      status: loop.status,
      relatedRecords: loop.relatedRecords,
      createdAt: loop.createdAt.toISOString(),
      updatedAt: loop.updatedAt.toISOString(),
      closedAt: loop.closedAt?.toISOString()
    };
  }

  private requireTenantPrincipal(principal: RestPrincipal): RestPrincipal {
    if (!principal.accountId) throw new AuthorizationForbiddenError();
    return principal;
  }

  private parseStatus(value: string | undefined): ItemStatus {
    const status = value ?? 'active';
    if (status !== 'active' && status !== 'completed' && status !== 'all') {
      throw new ValidationError('status must be active, completed, or all.');
    }
    return status;
  }

  private parseLoopStatus(value: string | undefined): 'open' | 'closed' | 'all' {
    const status = value ?? 'open';
    if (status !== 'open' && status !== 'closed' && status !== 'all') {
      throw new ValidationError('status must be open, closed, or all.');
    }
    return status;
  }

  private parseCreateLoopBody(body: string | undefined): CreateLoopInput {
    const values = this.parseObjectBody(body);
    this.onlyFields(values, [
      'title',
      'description',
      'priority',
      'outcome',
      'dueDate',
      'relatedRecords'
    ]);
    if (typeof values['title'] !== 'string' || typeof values['outcome'] !== 'string') {
      throw new ValidationError('Loop creation requires string title and outcome fields.');
    }
    const dueDate = this.optionalString(values['dueDate'], 'dueDate');
    const description = this.optionalString(values['description'], 'description');
    const priority = this.optionalString(values['priority'], 'priority');
    const relatedRecords = this.optionalRelatedRecords(values['relatedRecords']);
    return {
      title: values['title'],
      outcome: values['outcome'],
      ...(description === undefined ? {} : { description }),
      ...(priority === undefined ? {} : { priority: priority as 'high' | 'medium' | 'low' }),
      ...(dueDate === undefined ? {} : { dueDate }),
      ...(relatedRecords === undefined ? {} : { relatedRecords })
    };
  }

  private parseUpdateLoopBody(body: string | undefined): UpdateLoopInput {
    const values = this.parseObjectBody(body);
    this.onlyFields(values, [
      'title',
      'description',
      'priority',
      'outcome',
      'dueDate',
      'relatedRecords'
    ]);
    if (Object.keys(values).length === 0) {
      throw new ValidationError('At least one loop field must be provided.');
    }
    if (values['title'] !== undefined && typeof values['title'] !== 'string') {
      throw new ValidationError('title must be a string.');
    }
    if (values['outcome'] !== undefined && typeof values['outcome'] !== 'string') {
      throw new ValidationError('outcome must be a string.');
    }
    if (
      values['description'] !== undefined &&
      values['description'] !== null &&
      typeof values['description'] !== 'string'
    ) {
      throw new ValidationError('description must be a string or null.');
    }
    if (values['priority'] !== undefined && typeof values['priority'] !== 'string') {
      throw new ValidationError('priority must be a string.');
    }
    if (
      values['dueDate'] !== undefined &&
      values['dueDate'] !== null &&
      typeof values['dueDate'] !== 'string'
    ) {
      throw new ValidationError('dueDate must be a string or null.');
    }
    return {
      ...(values['title'] === undefined ? {} : { title: values['title'] }),
      ...(values['outcome'] === undefined ? {} : { outcome: values['outcome'] }),
      ...(values['description'] === undefined ? {} : { description: values['description'] }),
      ...(values['priority'] === undefined
        ? {}
        : { priority: values['priority'] as 'high' | 'medium' | 'low' }),
      ...(values['dueDate'] === undefined ? {} : { dueDate: values['dueDate'] }),
      ...(values['relatedRecords'] === undefined
        ? {}
        : { relatedRecords: this.requiredRelatedRecords(values['relatedRecords']) })
    } as UpdateLoopInput;
  }

  private parseCloseLoopBody(body: string | undefined): boolean {
    const values = this.parseObjectBody(body);
    this.onlyFields(values, ['confirmed']);
    if (values['confirmed'] !== true) {
      throw new ValidationError('Closing a loop requires confirmed: true.');
    }
    return true;
  }

  private parseObjectBody(body: string | undefined): Record<string, unknown> {
    if (body === undefined) throw new ValidationError('A JSON request body is required.');
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      throw new ValidationError('The request body must be valid JSON.');
    }
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      throw new ValidationError('The request body must be a JSON object.');
    }
    return payload as Record<string, unknown>;
  }

  private onlyFields(values: Record<string, unknown>, allowed: readonly string[]): void {
    if (Object.keys(values).some((field) => !allowed.includes(field))) {
      throw new ValidationError('The request body contains an unsupported field.');
    }
  }

  private optionalString(value: unknown, name: string): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'string') throw new ValidationError(`${name} must be a string.`);
    return value;
  }

  private optionalRelatedRecords(value: unknown): readonly RelatedRecord[] | undefined {
    return value === undefined ? undefined : this.requiredRelatedRecords(value);
  }

  private requiredRelatedRecords(value: unknown): readonly RelatedRecord[] {
    if (!Array.isArray(value)) throw new ValidationError('relatedRecords must be an array.');
    if (
      !value.every(
        (record) =>
          typeof record === 'object' &&
          record !== null &&
          !Array.isArray(record) &&
          Object.keys(record).every((field) => ['kind', 'recordId', 'label'].includes(field)) &&
          typeof (record as Record<string, unknown>)['kind'] === 'string' &&
          typeof (record as Record<string, unknown>)['recordId'] === 'string' &&
          typeof (record as Record<string, unknown>)['label'] === 'string'
      )
    ) {
      throw new ValidationError(
        'Each related record requires only string kind, recordId, and label fields.'
      );
    }
    return value as RelatedRecord[];
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

  private parseSearchBody(body: string | undefined): { query: string; limit: number } {
    if (body === undefined) throw new ValidationError('A JSON request body is required.');
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
    if (
      typeof values['query'] !== 'string' ||
      (values['limit'] !== undefined && typeof values['limit'] !== 'number')
    ) {
      throw new ValidationError('Search query must be a string and limit must be a number.');
    }
    return { query: values['query'], limit: values['limit'] === undefined ? 5 : values['limit'] };
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

  private response(
    statusCode: number,
    payload: unknown,
    additionalHeaders: Readonly<Record<string, string>> = {}
  ): RestResponse {
    return {
      statusCode,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        ...additionalHeaders
      },
      body: JSON.stringify(payload)
    };
  }
}

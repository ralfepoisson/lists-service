import type { ShoppingListService } from '../../application/ShoppingListService.js';
import type { ShoppingListPrintService } from '../../application/ShoppingListPrintService.js';
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
    private readonly printService: ShoppingListPrintService
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

  private parseStatus(value: string | undefined): ItemStatus {
    const status = value ?? 'active';
    if (status !== 'active' && status !== 'completed' && status !== 'all') {
      throw new ValidationError('status must be active, completed, or all.');
    }
    return status;
  }

  private parseAddBody(body: string | undefined): string {
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
    if (Object.keys(values).length !== 1 || typeof values['content'] !== 'string') {
      throw new ValidationError('The request body must contain only a string content field.');
    }
    return values['content'];
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

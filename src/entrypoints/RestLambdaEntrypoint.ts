import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context
} from 'aws-lambda';

import type { RestRequest } from '../adapters/rest/RestApiController.js';
import { RestApplicationComposition } from '../bootstrap/ApplicationComposition.js';

export function safeRestOperation(method: string, path: string): string {
  const templates = [
    [/^\/v1\/items\/[^/]+\/(complete|reopen)$/u, '/v1/items/:itemId/$1'],
    [/^\/v1\/items\/[^/]+$/u, '/v1/items/:itemId'],
    [/^\/v1\/task-lists\/[^/]+\/tasks\/order$/u, '/v1/task-lists/:listId/tasks/order'],
    [
      /^\/v1\/task-lists\/[^/]+\/tasks\/[^/]+\/complete$/u,
      '/v1/task-lists/:listId/tasks/:taskId/complete'
    ],
    [/^\/v1\/task-lists\/[^/]+\/tasks\/[^/]+$/u, '/v1/task-lists/:listId/tasks/:taskId'],
    [/^\/v1\/task-lists\/[^/]+\/tasks$/u, '/v1/task-lists/:listId/tasks'],
    [/^\/v1\/task-lists\/[^/]+$/u, '/v1/task-lists/:listId']
  ] as const;
  const template = templates.reduce(
    (current, [pattern, replacement]) =>
      current === path && pattern.test(path) ? path.replace(pattern, replacement) : current,
    path
  );
  return `${method} ${template}`;
}

export class RestLambdaEntrypoint {
  private readonly composition = RestApplicationComposition.create();

  async handle(
    event: APIGatewayProxyEventV2,
    context: Context
  ): Promise<APIGatewayProxyStructuredResultV2> {
    const startedAt = performance.now();
    const application = await this.composition;
    const request = this.mapRequest(event, context);
    const response = await application.restController.handle(request);
    application.logger.log({
      level: response.statusCode >= 500 ? 'error' : response.statusCode >= 400 ? 'warn' : 'info',
      message: 'REST request completed.',
      requestId: request.requestId,
      channel: 'rest',
      operation: safeRestOperation(request.method, request.path),
      durationMs: Math.round(performance.now() - startedAt),
      status: String(response.statusCode)
    });
    return response;
  }

  private mapRequest(event: APIGatewayProxyEventV2, context: Context): RestRequest {
    const headers = Object.fromEntries(
      Object.entries(event.headers).map(([name, value]) => [name.toLocaleLowerCase('en-GB'), value])
    );
    return {
      method: event.requestContext.http.method,
      path: event.rawPath,
      headers,
      query: event.queryStringParameters ?? {},
      requestId: event.requestContext.requestId || context.awsRequestId,
      ...(event.body === undefined
        ? {}
        : {
            body: event.isBase64Encoded
              ? Buffer.from(event.body, 'base64').toString('utf8')
              : event.body
          })
    };
  }
}

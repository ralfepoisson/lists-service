import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context
} from 'aws-lambda';

import type { RestRequest } from '../adapters/rest/RestApiController.js';
import { RestApplicationComposition } from '../bootstrap/ApplicationComposition.js';

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
      level: response.statusCode >= 500 ? 'error' : 'info',
      message: 'REST request completed.',
      requestId: request.requestId,
      channel: 'rest',
      operation: `${request.method} ${request.path}`,
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

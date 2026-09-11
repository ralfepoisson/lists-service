import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { JsonConsoleLogger } from '../adapters/observability/JsonConsoleLogger.js';
import type { RestRequest } from '../adapters/rest/RestApiController.js';
import type { OperationalLogger } from '../application/ports/OperationalLogger.js';
import { LocalRestApplicationComposition } from '../bootstrap/LocalApplicationComposition.js';
import { localRestCompletionEvent } from './LocalRestLogging.js';

class LocalRestServer {
  private readonly application = LocalRestApplicationComposition.create();

  async start(port: number): Promise<void> {
    const host = process.env['HOST']?.trim() || '127.0.0.1';
    const server = createServer((request, response) => {
      void this.handle(request, response);
    });
    await new Promise<void>((resolve) => {
      server.listen(port, host, resolve);
    });
    const application = await this.application;
    application.logger.log({
      level: 'info',
      message: 'Local REST API started.',
      requestId: 'startup',
      channel: 'system',
      operation: 'server.start',
      status: 'ready'
    });
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const startedAt = performance.now();
    const requestId = randomUUID();
    const method = request.method ?? 'GET';
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    let logger: OperationalLogger = new JsonConsoleLogger('info');
    try {
      const application = await this.application;
      logger = application.logger;
      const body = await this.readBody(request);
      const restRequest: RestRequest = {
        method,
        path: url.pathname,
        headers: Object.fromEntries(
          Object.entries(request.headers).map(([name, value]) => [
            name,
            Array.isArray(value) ? value.join(',') : value
          ])
        ),
        query: Object.fromEntries(url.searchParams.entries()),
        requestId,
        ...(body.length === 0 ? {} : { body })
      };
      const restResponse = await application.restController.handle(restRequest);
      logger.log(
        localRestCompletionEvent({
          method,
          path: url.pathname,
          requestId,
          statusCode: restResponse.statusCode,
          durationMs: performance.now() - startedAt
        })
      );
      response.writeHead(restResponse.statusCode, {
        ...restResponse.headers,
        'x-request-id': requestId
      });
      response.end(
        restResponse.isBase64Encoded ? Buffer.from(restResponse.body, 'base64') : restResponse.body
      );
    } catch {
      logger.log(
        localRestCompletionEvent({
          method,
          path: url.pathname,
          requestId,
          statusCode: 500,
          durationMs: performance.now() - startedAt
        })
      );
      response.writeHead(500, {
        'content-type': 'application/json',
        'x-request-id': requestId
      });
      response.end(JSON.stringify({ error: { code: 'LOCAL_SERVER_ERROR' } }));
    }
  }

  private async readBody(request: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > 1_048_576) {
        throw new Error('Request body exceeds one MiB.');
      }
      chunks.push(buffer);
    }
    return Buffer.concat(chunks).toString('utf8');
  }
}

void new LocalRestServer()
  .start(Number.parseInt(process.env['PORT'] ?? '3000', 10))
  .catch((error: unknown) => {
    process.stderr.write(`Lists Service failed to start: ${String(error)}\n`);
    process.exitCode = 1;
  });

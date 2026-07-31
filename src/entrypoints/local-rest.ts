import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';

import type { RestRequest } from '../adapters/rest/RestApiController.js';
import { LocalRestApplicationComposition } from '../bootstrap/LocalApplicationComposition.js';

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
    process.stdout.write(`Lists Service REST API listening on ${host}:${port}\n`);
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const application = await this.application;
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const body = await this.readBody(request);
      const restRequest: RestRequest = {
        method: request.method ?? 'GET',
        path: url.pathname,
        headers: Object.fromEntries(
          Object.entries(request.headers).map(([name, value]) => [
            name,
            Array.isArray(value) ? value.join(',') : value
          ])
        ),
        query: Object.fromEntries(url.searchParams.entries()),
        requestId: randomUUID(),
        ...(body.length === 0 ? {} : { body })
      };
      const restResponse = await application.restController.handle(restRequest);
      response.writeHead(restResponse.statusCode, restResponse.headers);
      response.end(restResponse.body);
    } catch {
      response.writeHead(500, { 'content-type': 'application/json' });
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

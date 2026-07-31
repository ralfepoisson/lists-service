import type { HttpRequest, HttpTransport } from './ports/HttpTransport.js';

export class FetchHttpTransport implements HttpTransport {
  async send(request: HttpRequest): Promise<Response> {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), request.timeoutMilliseconds);
    try {
      return await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        ...(request.body === undefined ? {} : { body: request.body }),
        signal: abortController.signal
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

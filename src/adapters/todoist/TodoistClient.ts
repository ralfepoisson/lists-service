import { ItemNotFoundError, UpstreamError, type ApplicationError } from '../../domain/errors.js';
import type { HttpRequest, HttpTransport } from './ports/HttpTransport.js';
import type { Sleeper } from './ports/Sleeper.js';

export interface TodoistClientOptions {
  readonly baseUrl: string;
  readonly token: string;
  readonly transport: HttpTransport;
  readonly sleeper: Sleeper;
  readonly maximumAttempts: number;
  readonly timeoutMilliseconds: number;
  readonly random?: () => number;
}

export class TodoistClient {
  private readonly random: () => number;

  constructor(private readonly options: TodoistClientOptions) {
    this.random = options.random ?? Math.random;
  }

  async get(path: string, query: Readonly<Record<string, string>>): Promise<unknown> {
    const queryString = new URLSearchParams(query).toString();
    return this.requestJson('GET', `${path}${queryString.length > 0 ? `?${queryString}` : ''}`);
  }

  async post(path: string, body?: Readonly<Record<string, string>>): Promise<unknown> {
    return this.requestJson(
      'POST',
      path,
      body === undefined ? undefined : JSON.stringify(body),
      false
    );
  }

  async postForm(path: string, body: Readonly<Record<string, string>>): Promise<unknown> {
    return this.requestJson('POST', path, new URLSearchParams(body).toString(), false, true);
  }

  async delete(path: string): Promise<void> {
    await this.requestEmpty('DELETE', path);
  }

  private async requestJson(
    method: 'GET' | 'POST',
    path: string,
    body?: string,
    allowRetry = true,
    isForm = false
  ): Promise<unknown> {
    const response = await this.sendWithPolicy(method, path, body, allowRetry, isForm);
    if (response.status === 204 || response.headers.get('content-length') === '0') {
      return null;
    }
    try {
      return await response.json();
    } catch {
      if (method === 'POST' && body === undefined) {
        return null;
      }
      throw new UpstreamError(
        'UPSTREAM_UNAVAILABLE',
        'Todoist returned a malformed response.',
        response.status
      );
    }
  }

  private async requestEmpty(method: 'DELETE', path: string): Promise<void> {
    await this.sendWithPolicy(method, path, undefined, false);
  }

  private async sendWithPolicy(
    method: 'DELETE' | 'GET' | 'POST',
    path: string,
    body: string | undefined,
    allowRetry: boolean,
    isForm = false
  ): Promise<Response> {
    const attempts = allowRetry ? this.options.maximumAttempts : 1;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      let response: Response;
      try {
        response = await this.options.transport.send(
          this.createRequest(method, path, body, isForm)
        );
      } catch (error: unknown) {
        if (allowRetry && attempt < attempts) {
          await this.options.sleeper.sleep(this.backoffMilliseconds(attempt));
          continue;
        }
        throw new UpstreamError(
          'UPSTREAM_UNAVAILABLE',
          error instanceof Error && error.name === 'AbortError'
            ? 'Todoist request timed out.'
            : 'Todoist is temporarily unavailable.'
        );
      }

      if (response.ok) {
        return response;
      }
      if (allowRetry && this.isTransient(response.status) && attempt < attempts) {
        await this.options.sleeper.sleep(this.retryDelayMilliseconds(response, attempt));
        continue;
      }
      throw this.mapFailure(response.status);
    }
    throw new UpstreamError('UPSTREAM_UNAVAILABLE', 'Todoist is temporarily unavailable.');
  }

  private createRequest(
    method: 'DELETE' | 'GET' | 'POST',
    path: string,
    body: string | undefined,
    isForm = false
  ): HttpRequest {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${this.options.token}`,
      'User-Agent': 'Life2-Lists-Service/0.1'
    };
    if (body !== undefined) {
      headers['Content-Type'] = isForm ? 'application/x-www-form-urlencoded' : 'application/json';
    }
    return {
      url: `${this.options.baseUrl.replace(/\/$/u, '')}${path}`,
      method,
      headers,
      ...(body === undefined ? {} : { body }),
      timeoutMilliseconds: this.options.timeoutMilliseconds
    };
  }

  private isTransient(status: number): boolean {
    return status === 429 || [500, 502, 503, 504].includes(status);
  }

  private retryDelayMilliseconds(response: Response, attempt: number): number {
    const retryAfter = response.headers.get('retry-after');
    if (retryAfter !== null) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds) && seconds >= 0) {
        return seconds * 1000;
      }
      const retryAt = Date.parse(retryAfter);
      if (!Number.isNaN(retryAt)) {
        return Math.max(0, retryAt - Date.now());
      }
    }
    return this.backoffMilliseconds(attempt);
  }

  private backoffMilliseconds(attempt: number): number {
    return 250 * 2 ** (attempt - 1) + Math.floor(this.random() * 100);
  }

  private mapFailure(status: number): ApplicationError {
    if (status === 401 || status === 403) {
      return new UpstreamError(
        'UPSTREAM_AUTHENTICATION_FAILED',
        'Todoist authentication failed.',
        status
      );
    }
    if (status === 429) {
      return new UpstreamError('UPSTREAM_RATE_LIMITED', 'Todoist rate limit exceeded.', status);
    }
    if (status === 404) {
      return new ItemNotFoundError();
    }
    return new UpstreamError('UPSTREAM_UNAVAILABLE', 'Todoist request failed.', status);
  }
}

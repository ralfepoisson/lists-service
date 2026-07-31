export interface HttpRequest {
  readonly url: string;
  readonly method: 'DELETE' | 'GET' | 'POST';
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly timeoutMilliseconds: number;
}

export interface HttpTransport {
  send(request: HttpRequest): Promise<Response>;
}

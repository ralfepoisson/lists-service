export type LogLevel = 'debug' | 'error' | 'info' | 'warn';

export interface OperationalLogEvent {
  readonly level: LogLevel;
  readonly message: string;
  readonly requestId: string;
  readonly channel: 'alexa' | 'rest' | 'system';
  readonly operation?: string;
  readonly intentName?: string;
  readonly durationMs?: number;
  readonly status?: string;
  readonly upstreamStatus?: number;
}

export interface OperationalLogger {
  log(event: OperationalLogEvent): void;
}

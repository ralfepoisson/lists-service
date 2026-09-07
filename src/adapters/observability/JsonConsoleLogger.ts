import type {
  LogLevel,
  OperationalLogEvent,
  OperationalLogger
} from '../../application/ports/OperationalLogger.js';

export class JsonConsoleLogger implements OperationalLogger {
  private static readonly LEVEL_ORDER: Readonly<Record<LogLevel, number>> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40
  };

  constructor(private readonly minimumLevel: LogLevel) {}

  log(event: OperationalLogEvent): void {
    if (
      JsonConsoleLogger.LEVEL_ORDER[event.level] < JsonConsoleLogger.LEVEL_ORDER[this.minimumLevel]
    ) {
      return;
    }
    const safeRequestId = /^[a-z0-9._:-]{1,128}$/iu.test(event.requestId)
      ? event.requestId
      : 'invalid';
    const safeText = (value: string | undefined, fallback: string): string | undefined =>
      value === undefined
        ? undefined
        : /^[a-z0-9 ./_:-]{1,160}$/iu.test(value)
          ? value
          : fallback;
    process.stdout.write(
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        component: 'lists-service',
        level: event.level,
        message: safeText(event.message, 'Operational event.'),
        requestId: safeRequestId,
        channel: event.channel,
        operation: safeText(event.operation, 'unknown'),
        intentName: safeText(event.intentName, 'unknown'),
        durationMs: event.durationMs,
        status: safeText(event.status, 'unknown'),
        upstreamStatus: event.upstreamStatus
      })}\n`
    );
  }
}

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
    process.stdout.write(
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        component: 'lists-service',
        ...event
      })}\n`
    );
  }
}

import type { OperationalLogEvent } from '../application/ports/OperationalLogger.js';
import { safeRestOperation } from './RestLambdaEntrypoint.js';

interface LocalRestCompletion {
  readonly method: string;
  readonly path: string;
  readonly requestId: string;
  readonly statusCode: number;
  readonly durationMs: number;
}

export function localRestCompletionEvent(input: LocalRestCompletion): OperationalLogEvent {
  return {
    level: input.statusCode >= 500 ? 'error' : input.statusCode >= 400 ? 'warn' : 'info',
    message: 'REST request completed.',
    requestId: input.requestId,
    channel: 'rest',
    operation: safeRestOperation(input.method, input.path),
    durationMs: Math.round(input.durationMs),
    status: String(input.statusCode)
  };
}

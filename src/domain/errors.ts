export type ApplicationErrorCode =
  | 'AMBIGUOUS_ITEM'
  | 'AUTHENTICATION_REQUIRED'
  | 'CONFIGURATION_ERROR'
  | 'DESTRUCTIVE_ACTION_NOT_CONFIRMED'
  | 'ITEM_NOT_FOUND'
  | 'TASK_LIST_NOT_FOUND'
  | 'TASK_NOT_FOUND'
  | 'ROUTE_NOT_FOUND'
  | 'UPSTREAM_AUTHENTICATION_FAILED'
  | 'UPSTREAM_RATE_LIMITED'
  | 'UPSTREAM_UNAVAILABLE'
  | 'VALIDATION_ERROR';

export class ApplicationError extends Error {
  constructor(
    readonly code: ApplicationErrorCode,
    message: string,
    readonly httpStatus: number
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends ApplicationError {
  constructor(message: string) {
    super('VALIDATION_ERROR', message, 400);
  }
}

export class ItemNotFoundError extends ApplicationError {
  constructor() {
    super('ITEM_NOT_FOUND', 'The requested shopping-list item was not found.', 404);
  }
}

export class TaskListNotFoundError extends ApplicationError {
  constructor() {
    super('TASK_LIST_NOT_FOUND', 'The requested task list was not found.', 404);
  }
}

export class TaskNotFoundError extends ApplicationError {
  constructor() {
    super('TASK_NOT_FOUND', 'The requested task was not found in that task list.', 404);
  }
}

export class AmbiguousItemError extends ApplicationError {
  constructor(readonly candidateNames: string[]) {
    super('AMBIGUOUS_ITEM', 'Several shopping-list items match. Please be more specific.', 409);
  }
}

export class DestructiveActionNotConfirmedError extends ApplicationError {
  constructor() {
    super(
      'DESTRUCTIVE_ACTION_NOT_CONFIRMED',
      'The destructive action requires explicit confirmation.',
      400
    );
  }
}

export class ConfigurationError extends ApplicationError {
  constructor(message: string) {
    super('CONFIGURATION_ERROR', message, 500);
  }
}

export class RouteNotFoundError extends ApplicationError {
  constructor() {
    super('ROUTE_NOT_FOUND', 'The requested route was not found.', 404);
  }
}

export class UpstreamError extends ApplicationError {
  constructor(
    code: 'UPSTREAM_AUTHENTICATION_FAILED' | 'UPSTREAM_RATE_LIMITED' | 'UPSTREAM_UNAVAILABLE',
    message: string,
    readonly upstreamStatus?: number
  ) {
    super(code, message, code === 'UPSTREAM_RATE_LIMITED' ? 503 : 502);
  }
}

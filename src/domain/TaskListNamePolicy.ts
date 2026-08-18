import { ValidationError } from './errors.js';

export class TaskListNamePolicy {
  constructor(private readonly maximumCodePoints = 128) {}

  validate(name: string): string {
    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      throw new ValidationError('Task-list name must not be empty.');
    }
    if ([...trimmedName].length > this.maximumCodePoints) {
      throw new ValidationError(
        `Task-list name must not exceed ${this.maximumCodePoints} characters.`
      );
    }
    return trimmedName;
  }
}

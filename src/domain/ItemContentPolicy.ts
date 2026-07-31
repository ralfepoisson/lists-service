import { ValidationError } from './errors.js';

export class ItemContentPolicy {
  constructor(private readonly maximumCodePoints = 500) {}

  validate(content: string): string {
    const trimmedContent = content.trim();
    if (trimmedContent.length === 0) {
      throw new ValidationError('Item content must not be empty.');
    }
    if ([...trimmedContent].length > this.maximumCodePoints) {
      throw new ValidationError(
        `Item content must not exceed ${this.maximumCodePoints} characters.`
      );
    }
    return trimmedContent;
  }

  normaliseForComparison(content: string): string {
    return content.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-GB');
  }
}

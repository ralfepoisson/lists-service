import { describe, expect, it } from 'vitest';

import { ValidationError } from '../../src/domain/errors.js';
import { ItemContentPolicy } from '../../src/domain/ItemContentPolicy.js';

describe('ItemContentPolicy', () => {
  const policy = new ItemContentPolicy(500);

  it('trims content while preserving meaningful quantities and internal whitespace', () => {
    expect(policy.validate('  two bottles of sparkling water  ')).toBe(
      'two bottles of sparkling water'
    );
  });

  it('normalises case and repeated whitespace for deterministic comparisons', () => {
    expect(policy.normaliseForComparison('  Cat   FOOD ')).toBe('cat food');
  });

  it('rejects empty content', () => {
    expect(() => policy.validate('   ')).toThrowError(ValidationError);
  });

  it('rejects content over the configured Unicode code-point limit without truncating', () => {
    expect(() => policy.validate('🛒'.repeat(501))).toThrowError(ValidationError);
  });
});

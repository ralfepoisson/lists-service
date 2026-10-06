import { describe, expect, it } from 'vitest';
import { validateAppliedMigration } from '../../src/entrypoints/migrationIntegrity.js';

describe('applied migration identity', () => {
  const legacy = '103da50ed4df5ed0d9162d31f08a04eb1f222f5f66083ce7844aa4d1391316b6';
  it('bridges only the exact previously accepted legacy migration', () => {
    expect(validateAppliedMigration('001_loops.sql', null, legacy)).toBe(legacy);
    expect(() => validateAppliedMigration('001_loops.sql', null, 'a'.repeat(64))).toThrow();
    expect(() => validateAppliedMigration('002_lists_tags.sql', null, legacy)).toThrow();
  });
  it('rejects edited migration bytes before a later upgrade can proceed', () => {
    expect(validateAppliedMigration('001_loops.sql', legacy, legacy)).toBe(legacy);
    expect(() => validateAppliedMigration('001_loops.sql', legacy, 'a'.repeat(64))).toThrow();
  });
});

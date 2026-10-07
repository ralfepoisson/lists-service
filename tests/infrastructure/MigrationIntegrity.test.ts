import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { validateAppliedMigration } from '../../src/entrypoints/migrationIntegrity.js';

describe('applied migration identity', () => {
  const legacy = '103da50ed4df5ed0d9162d31f08a04eb1f222f5f66083ce7844aa4d1391316b6';
  it('bridges only the exact previously accepted legacy migration', () => {
    expect(validateAppliedMigration('001_loops.sql', null, legacy)).toBe(legacy);
    expect(() => validateAppliedMigration('001_loops.sql', null, 'a'.repeat(64))).toThrow();
    expect(() => validateAppliedMigration('002_lists_tags.sql', null, legacy)).toThrow();
    expect(() => validateAppliedMigration('006_unknown.sql', null, legacy)).toThrow();
  });
  it.each([
    ['002_lists_tags.sql', '1e1023cf798f3f32c01ad22ba00d3b0e011bc57b56156daf181b507451d87114'],
    [
      '003_loop_seed_identity.sql',
      '92f3356c799f1c8efa334befe31bb02c76f444f6430bc75940b160423a939725'
    ],
    ['004_loop_comments.sql', '6f4d075456045abee98a421e874414884f2250e7eff5bce7624634d1a9b49277'],
    [
      '005_loop_asset_references.sql',
      '4a06ee07243ec5f402c160e9791c1c4ac27db030f36dc26f35c0cd0469084e20'
    ]
  ])('bridges the exact checksum of legacy %s', async (name, checksum) => {
    const source = await readFile(join('migrations', name));
    expect(createHash('sha256').update(source).digest('hex')).toBe(checksum);
    expect(validateAppliedMigration(name, null, checksum)).toBe(checksum);
    expect(() => validateAppliedMigration(name, null, 'a'.repeat(64))).toThrow();
  });
  it('rejects edited migration bytes before a later upgrade can proceed', () => {
    expect(validateAppliedMigration('001_loops.sql', legacy, legacy)).toBe(legacy);
    expect(() => validateAppliedMigration('001_loops.sql', legacy, 'a'.repeat(64))).toThrow();
  });
});

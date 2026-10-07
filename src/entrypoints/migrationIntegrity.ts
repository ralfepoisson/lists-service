// The pre-checksum runner recorded only names. Bridge its exact immutable SQL bytes.
const acceptedLegacyChecksums = new Map([
  ['001_loops.sql', '103da50ed4df5ed0d9162d31f08a04eb1f222f5f66083ce7844aa4d1391316b6'],
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
]);

export function validateAppliedMigration(
  name: string,
  stored: string | null,
  current: string
): string {
  if (stored === current) return current;
  if (stored === null && current === acceptedLegacyChecksums.get(name)) {
    return current;
  }
  throw new Error('Applied Lists migration checksum differs from the accepted source.');
}

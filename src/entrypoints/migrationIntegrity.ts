// Legacy 0.9.0 was accepted against this immutable migration checksum.
const acceptedLegacyChecksum = '103da50ed4df5ed0d9162d31f08a04eb1f222f5f66083ce7844aa4d1391316b6';

export function validateAppliedMigration(
  name: string,
  stored: string | null,
  current: string
): string {
  if (stored === current) return current;
  if (stored === null && name === '001_loops.sql' && current === acceptedLegacyChecksum) {
    return current;
  }
  throw new Error('Applied Lists migration checksum differs from the accepted source.');
}

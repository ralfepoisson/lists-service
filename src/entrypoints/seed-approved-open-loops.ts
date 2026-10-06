import { PostgresLoopRepository } from '../adapters/postgres/PostgresLoopRepository.js';
import { LoopService } from '../application/LoopService.js';
import { approvedOpenLoopSeeds } from './approvedOpenLoopSeeds.js';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the approved local Loop seed.`);
  return value;
}

async function main(): Promise<void> {
  if (
    process.env['LIFE2_SEED_APPROVED'] !== 'true' ||
    process.env['LIFE2_SEED_ENVIRONMENT'] !== 'local-development'
  ) {
    throw new Error('Refusing Loop seed: explicit local-development approval flags are required.');
  }
  const databaseUrl = required('DATABASE_URL');
  const parsed = new URL(databaseUrl);
  if (
    parsed.hostname !== 'host.lima.internal' ||
    parsed.port !== '5432' ||
    parsed.pathname !== '/lists_service' ||
    decodeURIComponent(parsed.username) !== 'life2_postgres'
  ) {
    throw new Error(
      'Refusing Loop seed: DATABASE_URL is not the enrolled local lists_service database.'
    );
  }
  const accountId = required('LIFE2_SEED_ACCOUNT_ID');
  const subject = required('LIFE2_SEED_SUBJECT');
  const configuredAccountId = required('LIFE2_ALLOWED_ACCOUNT_ID');
  if (accountId !== configuredAccountId)
    throw new Error(
      'Refusing Loop seed: supplied tenant does not match Lists runtime configuration.'
    );
  const repository = new PostgresLoopRepository(databaseUrl);
  try {
    const service = new LoopService(repository);
    const report = [];
    for (const seed of approvedOpenLoopSeeds) {
      const result = await service.createSeeded(accountId, subject, seed);
      report.push({
        title: seed.title,
        id: result.loop.id,
        status: result.loop.status,
        outcome: result.created ? 'created' : 'reused',
        relatedSourceIds: result.loop.relatedRecords.map(
          (record) => `${record.kind}:${record.recordId}`
        )
      });
    }
    process.stdout.write(
      `${JSON.stringify({ environment: 'local-development', requestedCandidates: approvedOpenLoopSeeds.length, report }, null, 2)}\n`
    );
  } finally {
    await repository.close();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `Approved Loop seed failed: ${error instanceof Error ? error.message : 'unknown error'}\n`
  );
  process.exitCode = 1;
});

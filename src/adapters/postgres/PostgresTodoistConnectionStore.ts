import { Pool } from 'pg';
import type {
  ConnectionRecord,
  ConnectionStore
} from '../../application/TodoistConnectionManagement.js';
import { ApplicationError } from '../../domain/errors.js';
export class PostgresTodoistConnectionStore implements ConnectionStore {
  private readonly pool: Pool;
  constructor(databaseUrl: string) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 5000,
      statement_timeout: 5000
    });
  }
  async close(): Promise<void> {
    await this.pool.end();
  }
  async read(accountId: string): Promise<ConnectionRecord | undefined> {
    const result = await this.pool.query<{
      encrypted_token: string | null;
      version: number;
      updated_by: string;
    }>(
      'SELECT encrypted_token, version, updated_by FROM lists_todoist_connections WHERE account_id = $1',
      [accountId]
    );
    const row = result.rows[0];
    return row
      ? { encryptedToken: row.encrypted_token, version: row.version, updatedBy: row.updated_by }
      : undefined;
  }
  async write(
    accountId: string,
    value: Omit<ConnectionRecord, 'version'>,
    expectedVersion: number
  ): Promise<void> {
    if (expectedVersion === 0) {
      const inserted = await this.pool.query(
        'INSERT INTO lists_todoist_connections(account_id,encrypted_token,version,updated_by) VALUES($1,$2,1,$3) ON CONFLICT(account_id) DO NOTHING RETURNING version',
        [accountId, value.encryptedToken, value.updatedBy]
      );
      if (inserted.rowCount === 1) return;
    } else {
      const updated = await this.pool.query(
        'UPDATE lists_todoist_connections SET encrypted_token=$2,version=version+1,updated_by=$3,updated_at=now() WHERE account_id=$1 AND version=$4 RETURNING version',
        [accountId, value.encryptedToken, value.updatedBy, expectedVersion]
      );
      if (updated.rowCount === 1) return;
    }
    throw new ApplicationError(
      'VALIDATION_ERROR',
      'This connection changed. Reload its settings and try again.',
      409
    );
  }
}

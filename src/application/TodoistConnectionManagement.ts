import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import {
  AuthorizationForbiddenError,
  ConfigurationError,
  TodoistNotConnectedError,
  ValidationError
} from '../domain/errors.js';
export interface ConnectionRecord {
  readonly encryptedToken: string | null;
  readonly version: number;
  readonly updatedBy: string;
}
export interface ConnectionStore {
  read(accountId: string): Promise<ConnectionRecord | undefined>;
  write(
    accountId: string,
    value: Omit<ConnectionRecord, 'version'>,
    expectedVersion: number
  ): Promise<void>;
}
/** Account-bound encrypted overrides. A null ciphertext is a durable disconnection tombstone. */
export class TodoistConnectionManagement {
  constructor(
    private readonly store: ConnectionStore,
    private readonly key?: Buffer
  ) {
    if (key && key.length !== 32)
      throw new Error('Todoist connection encryption key must contain 32 bytes.');
  }
  get canManage(): boolean {
    return this.key !== undefined;
  }
  async status(
    accountId: string
  ): Promise<{ version: number; disconnected: boolean; replaced: boolean }> {
    const record = await this.store.read(accountId);
    return {
      version: record?.version ?? 0,
      disconnected: record?.encryptedToken === null,
      replaced: record?.encryptedToken != null
    };
  }
  async token(accountId: string, fallback: () => Promise<string>): Promise<string> {
    const record = await this.store.read(accountId);
    if (!record) return fallback();
    if (record.encryptedToken === null) throw new TodoistNotConnectedError();
    if (!this.key) throw new ConfigurationError('Todoist credential encryption is unavailable.');
    const bytes = Buffer.from(record.encryptedToken, 'base64');
    const cipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(0, 12));
    cipher.setAAD(Buffer.from(accountId));
    cipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8');
  }
  async save(
    accountId: string,
    subject: string,
    token: string,
    expectedVersion: number
  ): Promise<void> {
    if (!/^[\x21-\x7e]{8,4096}$/u.test(token))
      throw new ValidationError(
        'Enter an API token between 8 and 4096 printable characters without spaces.'
      );
    if (!this.key)
      throw new AuthorizationForbiddenError('Todoist credential management is unavailable.');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(accountId));
    const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    await this.store.write(
      accountId,
      {
        encryptedToken: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64'),
        updatedBy: subject
      },
      expectedVersion
    );
  }
  async disconnect(accountId: string, subject: string, expectedVersion: number): Promise<void> {
    await this.store.write(
      accountId,
      { encryptedToken: null, updatedBy: subject },
      expectedVersion
    );
  }
}

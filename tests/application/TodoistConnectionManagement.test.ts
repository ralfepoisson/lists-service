import { describe, expect, it } from 'vitest';
import {
  TodoistConnectionManagement,
  type ConnectionRecord
} from '../../src/application/TodoistConnectionManagement.js';
import { TodoistNotConnectedError } from '../../src/domain/errors.js';
class MemoryStore {
  rows = new Map<string, ConnectionRecord>();
  async read(id: string): Promise<ConnectionRecord | undefined> {
    return this.rows.get(id);
  }
  async write(
    id: string,
    value: Omit<ConnectionRecord, 'version'>,
    version: number
  ): Promise<void> {
    if ((this.rows.get(id)?.version ?? 0) !== version) throw new Error('conflict');
    this.rows.set(id, { ...value, version: version + 1 });
  }
}
describe('TodoistConnectionManagement', () => {
  it('encrypts owner-bound replacements and suppresses catalogue fallback after disconnect', async () => {
    const store = new MemoryStore();
    const manager = new TodoistConnectionManagement(store, Buffer.alloc(32, 7));
    await manager.save('a', 'actor-a', 'disposable-token-a', 0);
    expect(JSON.stringify([...store.rows.values()])).not.toContain('disposable-token-a');
    expect(await manager.token('a', async () => 'catalogue-a')).toBe('disposable-token-a');
    expect(await manager.token('b', async () => 'catalogue-b')).toBe('catalogue-b');
    await manager.disconnect('a', 'actor-a', 1);
    await expect(manager.token('a', async () => 'catalogue-a')).rejects.toBeInstanceOf(
      TodoistNotConnectedError
    );
    expect(await manager.token('b', async () => 'catalogue-b')).toBe('catalogue-b');
    expect(store.rows.get('a')?.encryptedToken).toBeNull();
  });
  it('fails closed after key removal and keeps disconnect tombstones effective', async () => {
    const store = new MemoryStore();
    const writer = new TodoistConnectionManagement(store, Buffer.alloc(32, 9));
    await writer.save('a', 'actor', 'unit-token-a', 0);
    const keyless = new TodoistConnectionManagement(store);
    expect(keyless.canManage).toBe(false);
    await expect(keyless.token('a', async () => 'old-catalogue-token')).rejects.toMatchObject({
      httpStatus: 500
    });
    await writer.disconnect('a', 'actor', 1);
    await expect(keyless.token('a', async () => 'old-catalogue-token')).rejects.toBeInstanceOf(
      TodoistNotConnectedError
    );
    await expect(keyless.save('a', 'actor', 'new-token-a', 2)).rejects.toMatchObject({
      httpStatus: 403
    });
  });
  it('refuses stale writes, invalid credentials and cross-owner ciphertext reuse', async () => {
    const store = new MemoryStore();
    const manager = new TodoistConnectionManagement(store, Buffer.alloc(32, 8));
    await expect(manager.save('a', 'actor', 'bad\nvalue', 0)).rejects.toThrow();
    await manager.save('a', 'actor', 'disposable-token', 0);
    await expect(manager.save('a', 'actor', 'new-token', 0)).rejects.toThrow();
    store.rows.set('b', store.rows.get('a')!);
    await expect(manager.token('b', async () => 'fallback')).rejects.toThrow();
  });
});

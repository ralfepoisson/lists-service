import { afterAll, describe, expect, it } from 'vitest';
import { PostgresTodoistConnectionStore } from '../../src/adapters/postgres/PostgresTodoistConnectionStore.js';
import { TodoistConnectionManagement } from '../../src/application/TodoistConnectionManagement.js';
const url = process.env['LISTS_TEST_DATABASE_URL'];
describe.skipIf(!url)('Todoist configuration on disposable PostgreSQL', () => {
  const store = new PostgresTodoistConnectionStore(url ?? '');
  afterAll(async () => store.close());
  it('persists encrypted replacements, isolates owners, rejects races and keeps disconnect tombstone on restart', async () => {
    const manager = new TodoistConnectionManagement(store, Buffer.alloc(32, 2));
    await manager.save('fixture-a', 'actor-a', 'disposable-test-token', 0);
    const saved = await store.read('fixture-a');
    expect(saved?.encryptedToken).not.toContain('disposable-test-token');
    expect(await store.read('fixture-b')).toBeUndefined();
    await expect(
      manager.save('fixture-a', 'actor-a', 'wrong-retry-token', 0)
    ).rejects.toMatchObject({ httpStatus: 409 });
    const second = new PostgresTodoistConnectionStore(url!);
    try {
      const reader = new TodoistConnectionManagement(second, Buffer.alloc(32, 2));
      expect(await reader.token('fixture-a', async () => 'catalogue')).toBe(
        'disposable-test-token'
      );
      await reader.disconnect('fixture-a', 'actor-a', 1);
      await expect(manager.token('fixture-a', async () => 'catalogue')).rejects.toMatchObject({
        httpStatus: 409
      });
      expect((await store.read('fixture-a'))?.encryptedToken).toBeNull();
      await expect(reader.save('fixture-a', 'actor-a', 'stale-token', 1)).rejects.toMatchObject({
        httpStatus: 409
      });
      await reader.save('fixture-a', 'actor-a', 'replacement-token', 2);
      expect(await manager.token('fixture-a', async () => 'catalogue')).toBe('replacement-token');
    } finally {
      await second.close();
    }
  });
});

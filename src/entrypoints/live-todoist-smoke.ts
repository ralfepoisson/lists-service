import { randomUUID } from 'node:crypto';

import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

import { AwsSecretsManagerSecretProvider } from '../adapters/secrets/AwsSecretsManagerSecretProvider.js';
import { FetchHttpTransport } from '../adapters/todoist/FetchHttpTransport.js';
import { TimerSleeper } from '../adapters/todoist/ports/Sleeper.js';
import { TodoistClient } from '../adapters/todoist/TodoistClient.js';
import { TodoistShoppingListRepository } from '../adapters/todoist/TodoistShoppingListRepository.js';
import { ShoppingListService } from '../application/ShoppingListService.js';
import { ConfigurationError } from '../domain/errors.js';
import type { ShoppingListItem } from '../domain/ShoppingListItem.js';

class LiveTodoistSmokeTest {
  async run(environment: NodeJS.ProcessEnv): Promise<void> {
    if (environment['LIFE2_RUN_LIVE_TODOIST_SMOKE'] !== '1') {
      throw new ConfigurationError(
        'Set LIFE2_RUN_LIVE_TODOIST_SMOKE=1 to authorize the real Todoist smoke test.'
      );
    }
    const tokenSecretArn = this.requireValue(environment, 'TODOIST_TOKEN_SECRET_ARN');
    const projectId = this.requireValue(environment, 'TODOIST_LIVE_TEST_PROJECT_ID');
    const token = await new AwsSecretsManagerSecretProvider(new SecretsManagerClient({})).getSecret(
      tokenSecretArn
    );
    const repository = new TodoistShoppingListRepository(
      new TodoistClient({
        baseUrl: environment['TODOIST_API_BASE_URL'] ?? 'https://api.todoist.com/api/v1',
        token,
        transport: new FetchHttpTransport(),
        sleeper: new TimerSleeper(),
        maximumAttempts: 3,
        timeoutMilliseconds: 10_000
      }),
      projectId,
      1
    );
    const service = new ShoppingListService(repository);
    const uniqueContent = `life2 lists smoke ${randomUUID()}`;
    let createdItem: ShoppingListItem | undefined;
    try {
      const created = await service.add(uniqueContent);
      if (created.alreadyExists) {
        throw new Error('The uniquely named live-smoke item already existed.');
      }
      createdItem = created.item;
      const activeItems = await service.list('active');
      if (!activeItems.some((item) => item.id === createdItem?.id)) {
        throw new Error('The created live-smoke item was not retrieved.');
      }
      await service.completeById(createdItem.id);
      const completedItems = await service.list('completed');
      if (!completedItems.some((item) => item.id === createdItem?.id)) {
        throw new Error('The completed live-smoke item was not retrieved.');
      }
    } finally {
      if (createdItem !== undefined) {
        await service.deleteById(createdItem.id);
      }
    }
    process.stdout.write('Real Todoist create, retrieve, complete, and cleanup smoke passed.\n');
  }

  private requireValue(environment: NodeJS.ProcessEnv, name: string): string {
    const value = environment[name]?.trim();
    if (value === undefined || value.length === 0) {
      throw new ConfigurationError(`${name} must be configured.`);
    }
    return value;
  }
}

await new LiveTodoistSmokeTest().run(process.env);

import { CompositeRestAuthenticator } from '../adapters/rest/CompositeRestAuthenticator.js';
import { Life2JwtRestAuthenticator } from '../adapters/rest/Life2JwtRestAuthenticator.js';
import { RestApiController } from '../adapters/rest/RestApiController.js';
import { RestBearerAuthenticator } from '../adapters/rest/RestBearerAuthenticator.js';
import { FetchHttpTransport } from '../adapters/todoist/FetchHttpTransport.js';
import { TimerSleeper } from '../adapters/todoist/ports/Sleeper.js';
import { TodoistClient } from '../adapters/todoist/TodoistClient.js';
import { TodoistProjectResolver } from '../adapters/todoist/TodoistProjectResolver.js';
import { TodoistShoppingListRepository } from '../adapters/todoist/TodoistShoppingListRepository.js';
import { ShoppingListService } from '../application/ShoppingListService.js';
import type { SecretProvider } from '../application/ports/SecretProvider.js';
import type { AppConfig } from '../config/AppConfig.js';

export class ShoppingListServiceFactory {
  constructor(
    private readonly config: AppConfig,
    private readonly secrets: SecretProvider
  ) {}

  async create(): Promise<ShoppingListService> {
    const todoistToken = await this.secrets.getSecret(this.config.todoistTokenSecretArn);
    const todoistClient = new TodoistClient({
      baseUrl: this.config.todoistApiBaseUrl,
      token: todoistToken,
      transport: new FetchHttpTransport(),
      sleeper: new TimerSleeper(),
      maximumAttempts: 3,
      timeoutMilliseconds: 10_000
    });
    const projectId =
      this.config.todoistProjectId ??
      (await new TodoistProjectResolver(todoistClient).resolveOrCreate(
        this.config.todoistProjectName as string
      ));
    return new ShoppingListService(
      new TodoistShoppingListRepository(todoistClient, projectId, this.config.completedLookbackDays)
    );
  }
}

export class RestControllerFactory {
  constructor(
    private readonly config: AppConfig,
    private readonly secrets: SecretProvider
  ) {}

  async create(): Promise<RestApiController> {
    const [service, restToken, life2SigningKey] = await Promise.all([
      new ShoppingListServiceFactory(this.config, this.secrets).create(),
      this.secrets.getSecret(this.config.restApiTokenSecretArn),
      this.secrets.getSecret(this.config.life2JwtSigningKeySecretArn)
    ]);
    return new RestApiController(
      service,
      new CompositeRestAuthenticator([
        new RestBearerAuthenticator(restToken),
        new Life2JwtRestAuthenticator(life2SigningKey, this.config.life2AllowedAccountId)
      ])
    );
  }
}

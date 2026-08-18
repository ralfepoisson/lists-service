import { CompositeRestAuthenticator } from '../adapters/rest/CompositeRestAuthenticator.js';
import { Life2JwtRestAuthenticator } from '../adapters/rest/Life2JwtRestAuthenticator.js';
import { RestApiController } from '../adapters/rest/RestApiController.js';
import { RestBearerAuthenticator } from '../adapters/rest/RestBearerAuthenticator.js';
import { FetchHttpTransport } from '../adapters/todoist/FetchHttpTransport.js';
import { PdfKitShoppingListRenderer } from '../adapters/pdf/PdfKitShoppingListRenderer.js';
import { TimerSleeper } from '../adapters/todoist/ports/Sleeper.js';
import { TodoistClient } from '../adapters/todoist/TodoistClient.js';
import { TodoistProjectResolver } from '../adapters/todoist/TodoistProjectResolver.js';
import { TodoistShoppingListRepository } from '../adapters/todoist/TodoistShoppingListRepository.js';
import { TodoistTaskListRepository } from '../adapters/todoist/TodoistTaskListRepository.js';
import { TenantTodoistConnectionCatalog } from '../adapters/todoist/TenantTodoistConnectionCatalog.js';
import { ShoppingListService } from '../application/ShoppingListService.js';
import { ShoppingListPrintService } from '../application/ShoppingListPrintService.js';
import { TaskListService } from '../application/TaskListService.js';
import type { SecretProvider } from '../application/ports/SecretProvider.js';
import type {
  TenantTaskListServiceProvider,
  TodoistConnectionStatus
} from '../application/ports/TenantTaskListServiceProvider.js';
import type { AppConfig } from '../config/AppConfig.js';

export class ShoppingListServiceFactory {
  constructor(
    private readonly config: AppConfig,
    private readonly secrets: SecretProvider
  ) {}

  async create(): Promise<ShoppingListService> {
    return this.createService();
  }

  private async createService(): Promise<ShoppingListService> {
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

export class TenantTaskListServiceFactory implements TenantTaskListServiceProvider {
  private readonly catalog: TenantTodoistConnectionCatalog;

  constructor(
    private readonly config: AppConfig,
    private readonly secrets: SecretProvider,
    catalogSecretRef: string
  ) {
    this.catalog = new TenantTodoistConnectionCatalog(secrets, catalogSecretRef);
  }

  async connectionStatus(accountId: string): Promise<TodoistConnectionStatus> {
    return {
      status: (await this.catalog.has(accountId)) ? 'connected' : 'not_connected',
      canManageConnection: false
    };
  }

  async forTenant(accountId: string): Promise<TaskListService> {
    const token = await this.catalog.tokenFor(accountId);
    const client = new TodoistClient({
      baseUrl: this.config.todoistApiBaseUrl,
      token,
      transport: new FetchHttpTransport(),
      sleeper: new TimerSleeper(),
      maximumAttempts: 3,
      timeoutMilliseconds: 10_000
    });
    return new TaskListService(
      new TodoistTaskListRepository(client, this.config.completedLookbackDays)
    );
  }
}

export class RestControllerFactory {
  constructor(
    private readonly config: AppConfig,
    private readonly secrets: SecretProvider
  ) {}

  async create(): Promise<RestApiController> {
    const security = this.config.restSecurityConfiguration();
    const [shoppingListService, restToken, life2SigningKey] = await Promise.all([
      new ShoppingListServiceFactory(this.config, this.secrets).create(),
      this.secrets.getSecret(security.restApiTokenSecretArn),
      this.secrets.getSecret(security.life2JwtSigningKeySecretArn)
    ]);
    return new RestApiController(
      shoppingListService,
      new CompositeRestAuthenticator([
        new RestBearerAuthenticator(restToken),
        new Life2JwtRestAuthenticator(life2SigningKey)
      ]),
      new ShoppingListPrintService(shoppingListService, new PdfKitShoppingListRenderer()),
      new TenantTaskListServiceFactory(
        this.config,
        this.secrets,
        security.todoistTenantCatalogSecretArn
      ),
      security.life2AllowedAccountId
    );
  }
}

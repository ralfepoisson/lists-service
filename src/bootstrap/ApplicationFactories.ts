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
    const client = await this.clientFor(accountId);
    return new TaskListService(
      new TodoistTaskListRepository(client, this.config.completedLookbackDays)
    );
  }

  async shoppingForTenant(accountId: string): Promise<{
    readonly shoppingList: ShoppingListService;
    readonly printService: ShoppingListPrintService;
  }> {
    const connection = await this.catalog.connectionFor(accountId);
    const client = this.clientForToken(connection.token);
    const projectId =
      connection.shoppingProjectId ??
      (await new TodoistProjectResolver(client).resolveOrCreate(
        connection.shoppingProjectName as string
      ));
    const shoppingList = new ShoppingListService(
      new TodoistShoppingListRepository(client, projectId, this.config.completedLookbackDays)
    );
    return {
      shoppingList,
      printService: new ShoppingListPrintService(shoppingList, new PdfKitShoppingListRenderer())
    };
  }

  private async clientFor(accountId: string): Promise<TodoistClient> {
    const token = await this.catalog.tokenFor(accountId);
    return this.clientForToken(token);
  }

  private clientForToken(token: string): TodoistClient {
    return new TodoistClient({
      baseUrl: this.config.todoistApiBaseUrl,
      token,
      transport: new FetchHttpTransport(),
      sleeper: new TimerSleeper(),
      maximumAttempts: 3,
      timeoutMilliseconds: 10_000
    });
  }
}

export class RestControllerFactory {
  constructor(
    private readonly config: AppConfig,
    private readonly secrets: SecretProvider
  ) {}

  async create(): Promise<RestApiController> {
    const security = this.config.restSecurityConfiguration();
    const [restToken, life2SigningKey] = await Promise.all([
      this.secrets.getSecret(security.restApiTokenSecretArn),
      this.secrets.getSecret(security.life2JwtSigningKeySecretArn)
    ]);
    const tenantServices = new TenantTaskListServiceFactory(
      this.config,
      this.secrets,
      security.todoistTenantCatalogSecretArn
    );
    return new RestApiController(
      new CompositeRestAuthenticator([
        new RestBearerAuthenticator(restToken, security.life2AllowedAccountId),
        new Life2JwtRestAuthenticator(life2SigningKey)
      ]),
      tenantServices
    );
  }
}

import { TodoistConnectionManagement } from '../application/TodoistConnectionManagement.js';
import { PostgresTodoistConnectionStore } from '../adapters/postgres/PostgresTodoistConnectionStore.js';
import jwt from 'jsonwebtoken';
import { createSessionGuard } from '../adapters/rest/account-session.cjs';
import { CompositeRestAuthenticator } from '../adapters/rest/CompositeRestAuthenticator.js';
import { Life2JwtRestAuthenticator } from '../adapters/rest/Life2JwtRestAuthenticator.js';
import { RestApiController } from '../adapters/rest/RestApiController.js';
import { RestBearerAuthenticator } from '../adapters/rest/RestBearerAuthenticator.js';
import { FetchHttpTransport } from '../adapters/todoist/FetchHttpTransport.js';
import { PdfKitShoppingListRenderer } from '../adapters/pdf/PdfKitShoppingListRenderer.js';
import { TimerSleeper } from '../adapters/todoist/ports/Sleeper.js';
import { TodoistClient } from '../adapters/todoist/TodoistClient.js';
import { PostgresLoopRepository } from '../adapters/postgres/PostgresLoopRepository.js';
import { PostgresTagRepository } from '../adapters/postgres/PostgresTagRepository.js';
import { TagService } from '../application/TagService.js';
import { LoopService } from '../application/LoopService.js';
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
import { AuthorizationForbiddenError, TodoistNotConnectedError } from '../domain/errors.js';

export class TenantTaskListServiceFactory implements TenantTaskListServiceProvider {
  private readonly catalog: TenantTodoistConnectionCatalog | undefined;

  constructor(
    private readonly config: AppConfig,
    private readonly secrets: SecretProvider,
    catalogSecretRef: string | undefined,
    private readonly management?: TodoistConnectionManagement
  ) {
    this.catalog =
      catalogSecretRef === undefined
        ? undefined
        : new TenantTodoistConnectionCatalog(secrets, catalogSecretRef);
  }

  async connectionStatus(accountId: string): Promise<TodoistConnectionStatus> {
    const registered = await this.requiredCatalog().has(accountId);
    const managed =
      this.management && registered ? await this.management.status(accountId) : undefined;
    return {
      status: registered && !managed?.disconnected ? 'connected' : 'not_connected',
      canManageConnection: registered && (this.management?.canManage ?? false),
      ...(managed
        ? {
            version: managed.version,
            managementMode: 'profile_token' as const,
            ...(!managed.disconnected
              ? {
                  credentialStatus: managed.replaced
                    ? ('saved_unverified' as const)
                    : ('server_configured' as const)
                }
              : {})
          }
        : {})
    };
  }

  async saveConnection(
    accountId: string,
    subject: string,
    token: string,
    version: number
  ): Promise<TodoistConnectionStatus> {
    await this.requireManagement(accountId);
    await this.management!.save(accountId, subject, token, version);
    return this.connectionStatus(accountId);
  }
  async disconnectConnection(accountId: string, subject: string, version: number): Promise<void> {
    await this.requireManagement(accountId);
    await this.management!.disconnect(accountId, subject, version);
  }
  private async requireManagement(accountId: string): Promise<void> {
    if (!this.management?.canManage || !(await this.requiredCatalog().has(accountId)))
      throw new AuthorizationForbiddenError('Todoist management is unavailable for this account.');
  }
  private async currentToken(accountId: string): Promise<string> {
    const fallback = (): Promise<string> => this.requiredCatalog().tokenFor(accountId);
    return this.management ? this.management.token(accountId, fallback) : fallback();
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
    const connection = await this.requiredCatalog().projectFor(accountId);
    const client = this.clientForToken(() => this.currentToken(accountId));
    const replaced = this.management && (await this.management.status(accountId)).replaced;
    const resolver = new TodoistProjectResolver(client);
    const projectId =
      connection.shoppingProjectId ??
      (replaced
        ? await resolver.resolveUnique(connection.shoppingProjectName as string)
        : await resolver.resolveOrCreate(connection.shoppingProjectName as string));
    const shoppingList = new ShoppingListService(
      new TodoistShoppingListRepository(client, projectId, this.config.completedLookbackDays)
    );
    return {
      shoppingList,
      printService: new ShoppingListPrintService(shoppingList, new PdfKitShoppingListRenderer())
    };
  }

  private async clientFor(accountId: string): Promise<TodoistClient> {
    if (!(await this.requiredCatalog().has(accountId))) throw new TodoistNotConnectedError();
    return this.clientForToken(() => this.currentToken(accountId));
  }

  private clientForToken(token: string | (() => Promise<string>)): TodoistClient {
    return new TodoistClient({
      baseUrl: this.config.todoistApiBaseUrl,
      token,
      transport: new FetchHttpTransport(),
      sleeper: new TimerSleeper(),
      maximumAttempts: 3,
      timeoutMilliseconds: 10_000
    });
  }

  private requiredCatalog(): TenantTodoistConnectionCatalog {
    if (this.catalog === undefined) throw new TodoistNotConnectedError();
    return this.catalog;
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
      this.config.todoistTenantCatalogSecretArn,
      await createTodoistManagement(this.config, this.secrets)
    );
    const loopRepository = new PostgresLoopRepository(this.config.requiredDatabaseUrl());
    const tagRepository = new PostgresTagRepository(this.config.requiredDatabaseUrl());
    return new RestApiController(
      new CompositeRestAuthenticator([
        new RestBearerAuthenticator(restToken, security.life2AllowedAccountId),
        new Life2JwtRestAuthenticator(life2SigningKey)
      ]),
      tenantServices,
      new LoopService(loopRepository),
      new TagService(tagRepository),
      async () => {
        try {
          const connection =
            this.config.todoistTenantCatalogSecretArn === undefined
              ? undefined
              : await tenantServices.connectionStatus(security.life2AllowedAccountId);
          // A deliberate disconnect disables optional provider checks, not unrelated Lists data.
          const todoistReady =
            !connection || connection.status === 'not_connected'
              ? true
              : await tenantServices
                  .shoppingForTenant(security.life2AllowedAccountId)
                  .then(({ shoppingList }) => shoppingList.isReady());
          return todoistReady && (await loopRepository.isReady());
        } catch {
          return false;
        }
      },
      async (request) => {
        const guard = createSessionGuard({
          key: Buffer.from(life2SigningKey, 'base64'),
          verifyJwt: jwt.verify
        });
        await guard.authorize({
          authorization: request.headers['authorization'],
          method: request.method,
          path: request.path
        });
      }
    );
  }
}

export async function createTodoistManagement(
  config: AppConfig,
  secrets: SecretProvider
): Promise<TodoistConnectionManagement | undefined> {
  if (!config.databaseUrl && !config.todoistConnectionKeySecretArn) return undefined;
  const key = config.todoistConnectionKeySecretArn
    ? Buffer.from(await secrets.getSecret(config.todoistConnectionKeySecretArn), 'base64')
    : undefined;
  // Always observe tombstones in a database-enabled deployment, even if the key is unavailable.
  return new TodoistConnectionManagement(
    new PostgresTodoistConnectionStore(config.requiredDatabaseUrl()),
    key
  );
}

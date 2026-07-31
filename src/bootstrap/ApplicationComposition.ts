import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import type { Skill } from 'ask-sdk-core';

import { AlexaSkillFactory } from '../adapters/alexa/AlexaSkillFactory.js';
import { JsonConsoleLogger } from '../adapters/observability/JsonConsoleLogger.js';
import { RestApiController } from '../adapters/rest/RestApiController.js';
import { CompositeRestAuthenticator } from '../adapters/rest/CompositeRestAuthenticator.js';
import { Life2JwtRestAuthenticator } from '../adapters/rest/Life2JwtRestAuthenticator.js';
import { RestBearerAuthenticator } from '../adapters/rest/RestBearerAuthenticator.js';
import { AwsSecretsManagerSecretProvider } from '../adapters/secrets/AwsSecretsManagerSecretProvider.js';
import { FetchHttpTransport } from '../adapters/todoist/FetchHttpTransport.js';
import { TimerSleeper } from '../adapters/todoist/ports/Sleeper.js';
import { TodoistClient } from '../adapters/todoist/TodoistClient.js';
import { TodoistProjectResolver } from '../adapters/todoist/TodoistProjectResolver.js';
import { TodoistShoppingListRepository } from '../adapters/todoist/TodoistShoppingListRepository.js';
import { AlexaSpeechPresenter } from '../application/AlexaSpeechPresenter.js';
import { ShoppingListService } from '../application/ShoppingListService.js';
import type { OperationalLogger } from '../application/ports/OperationalLogger.js';
import type { SecretProvider } from '../application/ports/SecretProvider.js';
import { AppConfig } from '../config/AppConfig.js';

class ShoppingListServiceFactory {
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
      (await new TodoistProjectResolver(todoistClient).resolveUnique(
        this.config.todoistProjectName as string
      ));
    return new ShoppingListService(
      new TodoistShoppingListRepository(todoistClient, projectId, this.config.completedLookbackDays)
    );
  }
}

class CompositionDependencies {
  readonly config: AppConfig;
  readonly secrets: SecretProvider;
  readonly logger: OperationalLogger;

  constructor(environment: NodeJS.ProcessEnv) {
    this.config = AppConfig.fromEnvironment(environment);
    this.secrets = new AwsSecretsManagerSecretProvider(new SecretsManagerClient({}));
    this.logger = new JsonConsoleLogger(this.config.logLevel);
  }

  async createService(): Promise<ShoppingListService> {
    return new ShoppingListServiceFactory(this.config, this.secrets).create();
  }
}

export class RestApplicationComposition {
  private constructor(
    readonly restController: RestApiController,
    readonly logger: OperationalLogger
  ) {}

  static async create(
    environment: NodeJS.ProcessEnv = process.env
  ): Promise<RestApplicationComposition> {
    const dependencies = new CompositionDependencies(environment);
    const [service, restToken, life2SigningKey] = await Promise.all([
      dependencies.createService(),
      dependencies.secrets.getSecret(dependencies.config.restApiTokenSecretArn),
      dependencies.secrets.getSecret(dependencies.config.life2JwtSigningKeySecretArn)
    ]);
    return new RestApplicationComposition(
      new RestApiController(
        service,
        new CompositeRestAuthenticator([
          new RestBearerAuthenticator(restToken),
          new Life2JwtRestAuthenticator(life2SigningKey, dependencies.config.life2AllowedAccountId)
        ])
      ),
      dependencies.logger
    );
  }
}

export class AlexaApplicationComposition {
  private constructor(
    readonly alexaSkill: Skill,
    readonly logger: OperationalLogger
  ) {}

  static async create(
    environment: NodeJS.ProcessEnv = process.env
  ): Promise<AlexaApplicationComposition> {
    const dependencies = new CompositionDependencies(environment);
    const service = await dependencies.createService();
    return new AlexaApplicationComposition(
      new AlexaSkillFactory(
        service,
        new AlexaSpeechPresenter(),
        dependencies.config.alexaSkillId
      ).create(),
      dependencies.logger
    );
  }
}

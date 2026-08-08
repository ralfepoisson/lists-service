import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import type { Skill } from 'ask-sdk-core';

import { AlexaSkillFactory } from '../adapters/alexa/AlexaSkillFactory.js';
import { JsonConsoleLogger } from '../adapters/observability/JsonConsoleLogger.js';
import type { RestApiController } from '../adapters/rest/RestApiController.js';
import { AwsSecretsManagerSecretProvider } from '../adapters/secrets/AwsSecretsManagerSecretProvider.js';
import { AlexaSpeechPresenter } from '../application/AlexaSpeechPresenter.js';
import type { ShoppingListService } from '../application/ShoppingListService.js';
import type { OperationalLogger } from '../application/ports/OperationalLogger.js';
import type { SecretProvider } from '../application/ports/SecretProvider.js';
import { AppConfig } from '../config/AppConfig.js';
import { RestControllerFactory, ShoppingListServiceFactory } from './ApplicationFactories.js';

class CompositionDependencies {
  readonly config: AppConfig;
  readonly secrets: SecretProvider;
  readonly logger: OperationalLogger;

  constructor(environment: NodeJS.ProcessEnv, channel: 'rest' | 'alexa') {
    this.config =
      channel === 'rest'
        ? AppConfig.fromRestEnvironment(environment)
        : AppConfig.fromAlexaEnvironment(environment);
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
    const dependencies = new CompositionDependencies(environment, 'rest');
    const restController = await new RestControllerFactory(
      dependencies.config,
      dependencies.secrets
    ).create();
    return new RestApplicationComposition(restController, dependencies.logger);
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
    const dependencies = new CompositionDependencies(environment, 'alexa');
    const service = await dependencies.createService();
    return new AlexaApplicationComposition(
      new AlexaSkillFactory(
        service,
        new AlexaSpeechPresenter(),
        dependencies.config.requiredAlexaSkillId()
      ).create(),
      dependencies.logger
    );
  }
}

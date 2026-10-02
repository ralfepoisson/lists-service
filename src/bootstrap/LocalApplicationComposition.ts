import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

import { JsonConsoleLogger } from '../adapters/observability/JsonConsoleLogger.js';
import type { RestApiController } from '../adapters/rest/RestApiController.js';
import { AwsSecretsManagerSecretProvider } from '../adapters/secrets/AwsSecretsManagerSecretProvider.js';
import { FileSecretProvider } from '../adapters/secrets/FileSecretProvider.js';
import type { OperationalLogger } from '../application/ports/OperationalLogger.js';
import { AppConfig } from '../config/AppConfig.js';
import { RestControllerFactory } from './ApplicationFactories.js';

export class LocalRestApplicationComposition {
  private constructor(
    readonly restController: RestApiController,
    readonly logger: OperationalLogger
  ) {}

  static async create(
    environment: NodeJS.ProcessEnv = process.env
  ): Promise<LocalRestApplicationComposition> {
    const config = AppConfig.fromRestEnvironment(environment);
    const secrets =
      config.secretProvider === 'file'
        ? new FileSecretProvider()
        : new AwsSecretsManagerSecretProvider(new SecretsManagerClient({}));
    return new LocalRestApplicationComposition(
      await new RestControllerFactory(config, secrets).create(),
      new JsonConsoleLogger(config.logLevel)
    );
  }
}

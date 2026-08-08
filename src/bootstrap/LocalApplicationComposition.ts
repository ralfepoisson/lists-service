import { JsonConsoleLogger } from '../adapters/observability/JsonConsoleLogger.js';
import type { RestApiController } from '../adapters/rest/RestApiController.js';
import { FileSecretProvider } from '../adapters/secrets/FileSecretProvider.js';
import type { OperationalLogger } from '../application/ports/OperationalLogger.js';
import { AppConfig } from '../config/AppConfig.js';
import { ConfigurationError } from '../domain/errors.js';
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
    if (config.secretProvider !== 'file') {
      throw new ConfigurationError('The local REST runtime requires SECRET_PROVIDER=file.');
    }
    const secrets = new FileSecretProvider();
    return new LocalRestApplicationComposition(
      await new RestControllerFactory(config, secrets).create(),
      new JsonConsoleLogger(config.logLevel)
    );
  }
}

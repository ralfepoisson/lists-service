import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

import { AwsSecretsManagerSecretProvider } from '../adapters/secrets/AwsSecretsManagerSecretProvider.js';
import { FetchHttpTransport } from '../adapters/todoist/FetchHttpTransport.js';
import { TimerSleeper } from '../adapters/todoist/ports/Sleeper.js';
import { TodoistClient } from '../adapters/todoist/TodoistClient.js';
import { TodoistProjectResolver } from '../adapters/todoist/TodoistProjectResolver.js';
import { ConfigurationError } from '../domain/errors.js';

class ProjectResolutionCommand {
  async run(environment: NodeJS.ProcessEnv): Promise<void> {
    const secretArn = this.requireValue(environment, 'TODOIST_TOKEN_SECRET_ARN');
    const projectName = this.requireValue(environment, 'TODOIST_PROJECT_NAME');
    const secretProvider = new AwsSecretsManagerSecretProvider(new SecretsManagerClient({}));
    const token = await secretProvider.getSecret(secretArn);
    const client = new TodoistClient({
      baseUrl: environment['TODOIST_API_BASE_URL'] ?? 'https://api.todoist.com/api/v1',
      token,
      transport: new FetchHttpTransport(),
      sleeper: new TimerSleeper(),
      maximumAttempts: 3,
      timeoutMilliseconds: 10_000
    });
    const projectId = await new TodoistProjectResolver(client).resolveUnique(projectName);
    process.stdout.write(`${projectId}\n`);
  }

  private requireValue(environment: NodeJS.ProcessEnv, name: string): string {
    const value = environment[name]?.trim();
    if (value === undefined || value.length === 0) {
      throw new ConfigurationError(`${name} must be configured.`);
    }
    return value;
  }
}

await new ProjectResolutionCommand().run(process.env);

import { ConfigurationError } from '../domain/errors.js';

type Environment = Readonly<Record<string, string | undefined>>;

export class AppConfig {
  private constructor(
    readonly todoistTokenSecretArn: string,
    readonly todoistProjectId: string | undefined,
    readonly todoistProjectName: string | undefined,
    readonly restApiTokenSecretArn: string,
    readonly life2JwtSigningKeySecretArn: string,
    readonly life2AllowedAccountId: string,
    readonly alexaSkillId: string,
    readonly logLevel: 'debug' | 'info' | 'warn' | 'error',
    readonly todoistApiBaseUrl: string,
    readonly completedLookbackDays: number
  ) {}

  static fromEnvironment(environment: Environment): AppConfig {
    const todoistTokenSecretArn = this.requireValue(environment, 'TODOIST_TOKEN_SECRET_ARN');
    const restApiTokenSecretArn = this.requireValue(environment, 'REST_API_TOKEN_SECRET_ARN');
    const life2JwtSigningKeySecretArn = this.requireValue(
      environment,
      'LIFE2_JWT_SIGNING_KEY_SECRET_ARN'
    );
    const life2AllowedAccountId = this.requireValue(environment, 'LIFE2_ALLOWED_ACCOUNT_ID');
    const alexaSkillId = this.requireValue(environment, 'ALEXA_SKILL_ID');
    const todoistProjectId = this.optionalValue(environment, 'TODOIST_PROJECT_ID');
    const todoistProjectName = this.optionalValue(environment, 'TODOIST_PROJECT_NAME');
    if (todoistProjectId === undefined && todoistProjectName === undefined) {
      throw new ConfigurationError(
        'Either TODOIST_PROJECT_ID or TODOIST_PROJECT_NAME must be configured.'
      );
    }
    const logLevel = this.parseLogLevel(environment['LOG_LEVEL']);
    const completedLookbackDays = this.parseLookbackDays(environment['COMPLETED_LOOKBACK_DAYS']);
    const todoistApiBaseUrl =
      this.optionalValue(environment, 'TODOIST_API_BASE_URL') ?? 'https://api.todoist.com/api/v1';

    return new AppConfig(
      todoistTokenSecretArn,
      todoistProjectId,
      todoistProjectName,
      restApiTokenSecretArn,
      life2JwtSigningKeySecretArn,
      life2AllowedAccountId,
      alexaSkillId,
      logLevel,
      todoistApiBaseUrl,
      completedLookbackDays
    );
  }

  private static requireValue(environment: Environment, name: string): string {
    const value = this.optionalValue(environment, name);
    if (value === undefined) {
      throw new ConfigurationError(`${name} must be configured.`);
    }
    return value;
  }

  private static optionalValue(environment: Environment, name: string): string | undefined {
    const value = environment[name]?.trim();
    return value === undefined || value.length === 0 ? undefined : value;
  }

  private static parseLogLevel(value: string | undefined): 'debug' | 'info' | 'warn' | 'error' {
    const logLevel = value ?? 'info';
    if (!['debug', 'info', 'warn', 'error'].includes(logLevel)) {
      throw new ConfigurationError('LOG_LEVEL must be debug, info, warn, or error.');
    }
    return logLevel as 'debug' | 'info' | 'warn' | 'error';
  }

  private static parseLookbackDays(value: string | undefined): number {
    const days = value === undefined ? 90 : Number.parseInt(value, 10);
    if (!Number.isInteger(days) || days < 1 || days > 90) {
      throw new ConfigurationError('COMPLETED_LOOKBACK_DAYS must be an integer from 1 through 90.');
    }
    return days;
  }
}

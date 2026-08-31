import { ConfigurationError } from '../domain/errors.js';

type Environment = Readonly<Record<string, string | undefined>>;

export class AppConfig {
  private constructor(
    readonly restApiTokenSecretArn: string | undefined,
    readonly life2JwtSigningKeySecretArn: string | undefined,
    readonly life2AllowedAccountId: string | undefined,
    readonly todoistTenantCatalogSecretArn: string | undefined,
    readonly alexaSkillId: string | undefined,
    readonly logLevel: 'debug' | 'info' | 'warn' | 'error',
    readonly todoistApiBaseUrl: string,
    readonly completedLookbackDays: number,
    readonly secretProvider: 'aws' | 'file'
  ) {}

  static fromRestEnvironment(environment: Environment): AppConfig {
    return this.fromEnvironment(environment, 'rest');
  }

  static fromAlexaEnvironment(environment: Environment): AppConfig {
    return this.fromEnvironment(environment, 'alexa');
  }

  restSecurityConfiguration(): {
    restApiTokenSecretArn: string;
    life2JwtSigningKeySecretArn: string;
    life2AllowedAccountId: string;
    todoistTenantCatalogSecretArn: string;
  } {
    const tenant = this.tenantConnectionConfiguration();
    return {
      restApiTokenSecretArn: AppConfig.requireConfigured(
        this.restApiTokenSecretArn,
        'REST_API_TOKEN_SECRET_ARN'
      ),
      life2JwtSigningKeySecretArn: AppConfig.requireConfigured(
        this.life2JwtSigningKeySecretArn,
        'LIFE2_JWT_SIGNING_KEY_SECRET_ARN'
      ),
      ...tenant
    };
  }

  tenantConnectionConfiguration(): {
    life2AllowedAccountId: string;
    todoistTenantCatalogSecretArn: string;
  } {
    return {
      life2AllowedAccountId: AppConfig.requireConfigured(
        this.life2AllowedAccountId,
        'LIFE2_ALLOWED_ACCOUNT_ID'
      ),
      todoistTenantCatalogSecretArn: AppConfig.requireConfigured(
        this.todoistTenantCatalogSecretArn,
        'TODOIST_TENANT_CATALOG_SECRET_ARN'
      )
    };
  }

  requiredAlexaSkillId(): string {
    return AppConfig.requireConfigured(this.alexaSkillId, 'ALEXA_SKILL_ID');
  }

  private static fromEnvironment(environment: Environment, channel: 'rest' | 'alexa'): AppConfig {
    const restApiTokenSecretArn =
      channel === 'rest' ? this.requireValue(environment, 'REST_API_TOKEN_SECRET_ARN') : undefined;
    const life2JwtSigningKeySecretArn =
      channel === 'rest'
        ? this.requireValue(environment, 'LIFE2_JWT_SIGNING_KEY_SECRET_ARN')
        : undefined;
    const life2AllowedAccountId = this.requireValue(environment, 'LIFE2_ALLOWED_ACCOUNT_ID');
    const todoistTenantCatalogSecretArn = this.requireValue(
      environment,
      'TODOIST_TENANT_CATALOG_SECRET_ARN'
    );
    const alexaSkillId =
      channel === 'alexa' ? this.requireValue(environment, 'ALEXA_SKILL_ID') : undefined;
    const logLevel = this.parseLogLevel(environment['LOG_LEVEL']);
    const completedLookbackDays = this.parseLookbackDays(environment['COMPLETED_LOOKBACK_DAYS']);
    const todoistApiBaseUrl =
      this.optionalValue(environment, 'TODOIST_API_BASE_URL') ?? 'https://api.todoist.com/api/v1';
    const secretProvider = this.parseSecretProvider(environment['SECRET_PROVIDER']);

    return new AppConfig(
      restApiTokenSecretArn,
      life2JwtSigningKeySecretArn,
      life2AllowedAccountId,
      todoistTenantCatalogSecretArn,
      alexaSkillId,
      logLevel,
      todoistApiBaseUrl,
      completedLookbackDays,
      secretProvider
    );
  }

  private static requireConfigured(value: string | undefined, name: string): string {
    if (value === undefined) {
      throw new ConfigurationError(`${name} is not configured for this runtime.`);
    }
    return value;
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

  private static parseSecretProvider(value: string | undefined): 'aws' | 'file' {
    const provider = value ?? 'aws';
    if (provider !== 'aws' && provider !== 'file') {
      throw new ConfigurationError('SECRET_PROVIDER must be aws or file.');
    }
    return provider;
  }
}

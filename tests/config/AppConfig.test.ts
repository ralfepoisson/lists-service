import { describe, expect, it } from 'vitest';

import { AppConfig } from '../../src/config/AppConfig.js';
import { ConfigurationError } from '../../src/domain/errors.js';

describe('AppConfig', () => {
  const completeEnvironment = {
    REST_API_TOKEN_SECRET_ARN: 'arn:aws:secretsmanager:eu-west-1:123456789012:secret:rest',
    LIFE2_JWT_SIGNING_KEY_SECRET_ARN:
      'arn:aws:secretsmanager:eu-west-1:123456789012:secret:life2-jwt',
    LIFE2_ALLOWED_ACCOUNT_ID: 'account-123',
    TODOIST_TENANT_CATALOG_SECRET_ARN:
      'arn:aws:secretsmanager:eu-west-1:123456789012:secret:todoist-catalog',
    ALEXA_SKILL_ID: 'amzn1.ask.skill.test',
    LOG_LEVEL: 'info'
  };

  it('loads valid cold-start configuration', () => {
    const config = AppConfig.fromRestEnvironment(completeEnvironment);

    expect(config.completedLookbackDays).toBe(90);
    expect(config.life2AllowedAccountId).toBe('account-123');
    expect(config.todoistTenantCatalogSecretArn).toContain('todoist-catalog');
    expect(config.secretProvider).toBe('aws');
  });

  it('does not require an invented Alexa skill id for the REST runtime', () => {
    const config = AppConfig.fromRestEnvironment({
      ...completeEnvironment,
      ALEXA_SKILL_ID: undefined
    });

    expect(config.alexaSkillId).toBeUndefined();
  });

  it('loads the Alexa runtime as a tenant-bound service principal without REST credentials', () => {
    const config = AppConfig.fromAlexaEnvironment({
      ALEXA_SKILL_ID: completeEnvironment.ALEXA_SKILL_ID,
      LIFE2_ALLOWED_ACCOUNT_ID: completeEnvironment.LIFE2_ALLOWED_ACCOUNT_ID,
      TODOIST_TENANT_CATALOG_SECRET_ARN: completeEnvironment.TODOIST_TENANT_CATALOG_SECRET_ARN,
      LOG_LEVEL: completeEnvironment.LOG_LEVEL
    });

    expect(config.alexaSkillId).toBe(completeEnvironment.ALEXA_SKILL_ID);
    expect(config.restApiTokenSecretArn).toBeUndefined();
    expect(config.life2JwtSigningKeySecretArn).toBeUndefined();
    expect(config.life2AllowedAccountId).toBe('account-123');
    expect(config.todoistTenantCatalogSecretArn).toContain('todoist-catalog');
  });

  it('rejects a completed history window over the provider maximum', () => {
    expect(() =>
      AppConfig.fromRestEnvironment({ ...completeEnvironment, COMPLETED_LOOKBACK_DAYS: '91' })
    ).toThrowError(ConfigurationError);
  });

  it('rejects an unsupported log level', () => {
    expect(() =>
      AppConfig.fromRestEnvironment({ ...completeEnvironment, LOG_LEVEL: 'verbose' })
    ).toThrowError(ConfigurationError);
  });

  it('selects file-backed secrets for the local Compose runtime', () => {
    const config = AppConfig.fromRestEnvironment({
      ...completeEnvironment,
      SECRET_PROVIDER: 'file'
    });

    expect(config.secretProvider).toBe('file');
  });

  it('rejects an unsupported secret provider', () => {
    expect(() =>
      AppConfig.fromRestEnvironment({ ...completeEnvironment, SECRET_PROVIDER: 'memory' })
    ).toThrowError(ConfigurationError);
  });

  it.each([
    'LIFE2_JWT_SIGNING_KEY_SECRET_ARN',
    'LIFE2_ALLOWED_ACCOUNT_ID',
    'TODOIST_TENANT_CATALOG_SECRET_ARN'
  ])('fails when %s is missing', (name) => {
    expect(() =>
      AppConfig.fromRestEnvironment({ ...completeEnvironment, [name]: undefined })
    ).toThrowError(ConfigurationError);
  });
});

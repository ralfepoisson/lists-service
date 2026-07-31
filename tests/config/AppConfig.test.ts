import { describe, expect, it } from 'vitest';

import { AppConfig } from '../../src/config/AppConfig.js';
import { ConfigurationError } from '../../src/domain/errors.js';

describe('AppConfig', () => {
  const completeEnvironment = {
    TODOIST_TOKEN_SECRET_ARN: 'arn:aws:secretsmanager:eu-west-1:123456789012:secret:todoist',
    TODOIST_PROJECT_ID: 'project-id',
    REST_API_TOKEN_SECRET_ARN: 'arn:aws:secretsmanager:eu-west-1:123456789012:secret:rest',
    LIFE2_JWT_SIGNING_KEY_SECRET_ARN:
      'arn:aws:secretsmanager:eu-west-1:123456789012:secret:life2-jwt',
    LIFE2_ALLOWED_ACCOUNT_ID: 'account-123',
    ALEXA_SKILL_ID: 'amzn1.ask.skill.test',
    LOG_LEVEL: 'info'
  };

  it('loads valid cold-start configuration', () => {
    const config = AppConfig.fromEnvironment(completeEnvironment);

    expect(config.todoistProjectId).toBe('project-id');
    expect(config.completedLookbackDays).toBe(90);
    expect(config.life2AllowedAccountId).toBe('account-123');
  });

  it('accepts a project name when an id is not configured', () => {
    const environment = { ...completeEnvironment, TODOIST_PROJECT_ID: undefined };
    const config = AppConfig.fromEnvironment({
      ...environment,
      TODOIST_PROJECT_NAME: 'Shopping'
    });

    expect(config.todoistProjectName).toBe('Shopping');
  });

  it('fails when neither project id nor project name is configured', () => {
    const environment = { ...completeEnvironment, TODOIST_PROJECT_ID: undefined };

    expect(() => AppConfig.fromEnvironment(environment)).toThrowError(ConfigurationError);
  });

  it('rejects a completed history window over the provider maximum', () => {
    expect(() =>
      AppConfig.fromEnvironment({ ...completeEnvironment, COMPLETED_LOOKBACK_DAYS: '91' })
    ).toThrowError(ConfigurationError);
  });

  it('rejects an unsupported log level', () => {
    expect(() =>
      AppConfig.fromEnvironment({ ...completeEnvironment, LOG_LEVEL: 'verbose' })
    ).toThrowError(ConfigurationError);
  });

  it.each(['LIFE2_JWT_SIGNING_KEY_SECRET_ARN', 'LIFE2_ALLOWED_ACCOUNT_ID'])(
    'fails when %s is missing',
    (name) => {
      expect(() =>
        AppConfig.fromEnvironment({ ...completeEnvironment, [name]: undefined })
      ).toThrowError(ConfigurationError);
    }
  );
});

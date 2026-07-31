import { describe, expect, it } from 'vitest';

import { RestBearerAuthenticator } from '../../src/adapters/rest/RestBearerAuthenticator.js';

describe('RestBearerAuthenticator', () => {
  const authenticator = new RestBearerAuthenticator('correct-secret-token');

  it('accepts the configured bearer token', () => {
    expect(authenticator.isAuthenticated('Bearer correct-secret-token')).toBe(true);
  });

  it.each([undefined, '', 'Bearer wrong-token', 'Basic correct-secret-token'])(
    'rejects missing or invalid authorization %s',
    (authorization) => {
      expect(authenticator.isAuthenticated(authorization)).toBe(false);
    }
  );
});

import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';

import { Life2JwtRestAuthenticator } from '../../src/adapters/rest/Life2JwtRestAuthenticator.js';

describe('Life2JwtRestAuthenticator', () => {
  const signingKey = 'a-test-only-life2-signing-key-with-enough-entropy';
  const encodedSigningKey = Buffer.from(signingKey, 'utf8').toString('base64');
  const authenticator = new Life2JwtRestAuthenticator(encodedSigningKey, 'account-123');

  function token(
    claims: Readonly<Record<string, unknown>> = {},
    options: jwt.SignOptions = {}
  ): string {
    return jwt.sign(
      {
        sub: 'user-123',
        email: 'user@example.com',
        accountId: 'account-123',
        ...claims
      },
      signingKey,
      {
        algorithm: 'HS256',
        issuer: 'life2.ralfe.me',
        audience: 'account',
        expiresIn: 300,
        ...options
      }
    );
  }

  it('accepts a valid Life2 bearer token for the configured account', () => {
    expect(authenticator.isAuthenticated(`Bearer ${token()}`)).toBe(true);
  });

  it.each([
    ['missing bearer', undefined],
    ['wrong account', `Bearer ${token({ accountId: 'account-456' })}`],
    ['missing subject', `Bearer ${token({ sub: undefined })}`],
    ['missing email', `Bearer ${token({ email: undefined })}`],
    [
      'missing expiry',
      `Bearer ${jwt.sign(
        { sub: 'user-123', email: 'user@example.com', accountId: 'account-123' },
        signingKey,
        { algorithm: 'HS256', issuer: 'life2.ralfe.me', audience: 'account' }
      )}`
    ],
    ['wrong issuer', `Bearer ${token({}, { issuer: 'other.example' })}`],
    ['wrong audience', `Bearer ${token({}, { audience: 'other' })}`],
    ['expired', `Bearer ${token({}, { expiresIn: -1 })}`],
    [
      'forged signature',
      `Bearer ${jwt.sign(
        { sub: 'user-123', email: 'user@example.com', accountId: 'account-123' },
        'different-test-key-with-enough-entropy',
        { algorithm: 'HS256', issuer: 'life2.ralfe.me', audience: 'account', expiresIn: 300 }
      )}`
    ]
  ])('rejects a token with %s', (_reason, authorization) => {
    expect(authenticator.isAuthenticated(authorization)).toBe(false);
  });
});

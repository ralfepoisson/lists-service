import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';

import { Life2JwtRestAuthenticator } from '../../src/adapters/rest/Life2JwtRestAuthenticator.js';

describe('Life2JwtRestAuthenticator', () => {
  const signingKey = 'a-test-only-life2-signing-key-with-enough-entropy';
  const encodedSigningKey = Buffer.from(signingKey, 'utf8').toString('base64');
  const authenticator = new Life2JwtRestAuthenticator(encodedSigningKey);

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

  it('returns the verified tenant and actor for any valid Life2 account token', () => {
    expect(authenticator.authenticate(`Bearer ${token()}`)).toEqual({
      authMethod: 'life2',
      accountId: 'account-123',
      sub: 'user-123',
      email: 'user@example.com'
    });
    expect(authenticator.authenticate(`Bearer ${token({ accountId: 'account-456' })}`)).toEqual(
      expect.objectContaining({ accountId: 'account-456' })
    );
  });

  it.each([
    ['missing bearer', undefined],
    ['missing account', `Bearer ${token({ accountId: undefined })}`],
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
    expect(authenticator.authenticate(authorization)).toBeUndefined();
  });
});

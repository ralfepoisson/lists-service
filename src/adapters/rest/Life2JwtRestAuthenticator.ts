import jwt, { type JwtPayload } from 'jsonwebtoken';

import type { RestAuthenticator } from './RestBearerAuthenticator.js';

export class Life2JwtRestAuthenticator implements RestAuthenticator {
  private readonly signingKey: Buffer;

  constructor(
    encodedSigningKey: string,
    private readonly allowedAccountId: string
  ) {
    this.signingKey = Buffer.from(encodedSigningKey, 'base64');
    if (this.signingKey.length < 32) {
      throw new Error('The Life2 JWT signing key must decode to at least 32 bytes.');
    }
  }

  isAuthenticated(authorizationHeader: string | undefined): boolean {
    if (authorizationHeader === undefined || !authorizationHeader.startsWith('Bearer ')) {
      return false;
    }
    try {
      const claims = jwt.verify(authorizationHeader.slice('Bearer '.length), this.signingKey, {
        algorithms: ['HS256'],
        issuer: 'life2.ralfe.me',
        audience: 'account'
      });
      return this.isAllowedPrincipal(claims);
    } catch {
      return false;
    }
  }

  private isAllowedPrincipal(claims: string | JwtPayload): claims is JwtPayload {
    return (
      typeof claims !== 'string' &&
      typeof claims['sub'] === 'string' &&
      claims['sub'].length > 0 &&
      typeof claims['email'] === 'string' &&
      claims['email'].length > 0 &&
      typeof claims['exp'] === 'number' &&
      claims['accountId'] === this.allowedAccountId
    );
  }
}

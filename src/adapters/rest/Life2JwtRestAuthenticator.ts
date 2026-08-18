import jwt, { type JwtPayload } from 'jsonwebtoken';

import type { RestAuthenticator, RestPrincipal } from './RestBearerAuthenticator.js';

export class Life2JwtRestAuthenticator implements RestAuthenticator {
  private readonly signingKey: Buffer;

  constructor(encodedSigningKey: string) {
    this.signingKey = Buffer.from(encodedSigningKey, 'base64');
    if (this.signingKey.length < 32) {
      throw new Error('The Life2 JWT signing key must decode to at least 32 bytes.');
    }
  }

  authenticate(authorizationHeader: string | undefined): RestPrincipal | undefined {
    if (authorizationHeader === undefined || !authorizationHeader.startsWith('Bearer ')) {
      return undefined;
    }
    try {
      const claims = jwt.verify(authorizationHeader.slice('Bearer '.length), this.signingKey, {
        algorithms: ['HS256'],
        issuer: 'life2.ralfe.me',
        audience: 'account'
      });
      return this.principal(claims);
    } catch {
      return undefined;
    }
  }

  private principal(claims: string | JwtPayload): RestPrincipal | undefined {
    if (
      typeof claims !== 'string' &&
      typeof claims['sub'] === 'string' &&
      claims['sub'].length > 0 &&
      typeof claims['email'] === 'string' &&
      claims['email'].length > 0 &&
      typeof claims['exp'] === 'number' &&
      typeof claims['accountId'] === 'string' &&
      claims['accountId'].length > 0
    ) {
      return {
        authMethod: 'life2',
        accountId: claims['accountId'],
        sub: claims['sub'],
        email: claims['email']
      };
    }
    return undefined;
  }
}

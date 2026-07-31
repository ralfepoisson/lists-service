import { timingSafeEqual } from 'node:crypto';

export interface RestAuthenticator {
  isAuthenticated(authorizationHeader: string | undefined): boolean;
}

export class RestBearerAuthenticator implements RestAuthenticator {
  private readonly expectedToken: Buffer;

  constructor(token: string) {
    this.expectedToken = Buffer.from(token, 'utf8');
  }

  isAuthenticated(authorizationHeader: string | undefined): boolean {
    if (authorizationHeader === undefined || !authorizationHeader.startsWith('Bearer ')) {
      return false;
    }
    const providedToken = Buffer.from(authorizationHeader.slice('Bearer '.length), 'utf8');
    return (
      providedToken.length === this.expectedToken.length &&
      timingSafeEqual(providedToken, this.expectedToken)
    );
  }
}

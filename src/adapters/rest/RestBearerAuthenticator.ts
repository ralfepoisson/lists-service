import { timingSafeEqual } from 'node:crypto';

export type RestPrincipal =
  | { readonly authMethod: 'automation'; readonly accountId: string }
  | {
      readonly authMethod: 'life2';
      readonly accountId: string;
      readonly sub: string;
      readonly email: string;
    };

export interface RestAuthenticator {
  authenticate(authorizationHeader: string | undefined): RestPrincipal | undefined;
}

export class RestBearerAuthenticator implements RestAuthenticator {
  private readonly expectedToken: Buffer;

  constructor(
    token: string,
    private readonly accountId: string
  ) {
    this.expectedToken = Buffer.from(token, 'utf8');
  }

  authenticate(authorizationHeader: string | undefined): RestPrincipal | undefined {
    if (authorizationHeader === undefined || !authorizationHeader.startsWith('Bearer ')) {
      return undefined;
    }
    const providedToken = Buffer.from(authorizationHeader.slice('Bearer '.length), 'utf8');
    return providedToken.length === this.expectedToken.length &&
      timingSafeEqual(providedToken, this.expectedToken)
      ? { authMethod: 'automation', accountId: this.accountId }
      : undefined;
  }
}

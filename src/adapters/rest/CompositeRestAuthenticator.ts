import type { RestAuthenticator, RestPrincipal } from './RestBearerAuthenticator.js';

export class CompositeRestAuthenticator implements RestAuthenticator {
  constructor(private readonly strategies: readonly RestAuthenticator[]) {
    if (strategies.length === 0) {
      throw new Error('At least one REST authentication strategy is required.');
    }
  }

  authenticate(authorizationHeader: string | undefined): RestPrincipal | undefined {
    for (const strategy of this.strategies) {
      const principal = strategy.authenticate(authorizationHeader);
      if (principal !== undefined) return principal;
    }
    return undefined;
  }
}

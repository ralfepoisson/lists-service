import type { RestAuthenticator } from './RestBearerAuthenticator.js';

export class CompositeRestAuthenticator implements RestAuthenticator {
  constructor(private readonly strategies: readonly RestAuthenticator[]) {
    if (strategies.length === 0) {
      throw new Error('At least one REST authentication strategy is required.');
    }
  }

  isAuthenticated(authorizationHeader: string | undefined): boolean {
    return this.strategies.some((strategy) => strategy.isAuthenticated(authorizationHeader));
  }
}

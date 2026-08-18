import { describe, expect, it } from 'vitest';

import { CompositeRestAuthenticator } from '../../src/adapters/rest/CompositeRestAuthenticator.js';
import type {
  RestAuthenticator,
  RestPrincipal
} from '../../src/adapters/rest/RestBearerAuthenticator.js';

class StubAuthenticator implements RestAuthenticator {
  constructor(private readonly result: RestPrincipal | undefined) {}

  authenticate(): RestPrincipal | undefined {
    return this.result;
  }
}

describe('CompositeRestAuthenticator', () => {
  it('accepts a credential accepted by any configured strategy', () => {
    const authenticator = new CompositeRestAuthenticator([
      new StubAuthenticator(undefined),
      new StubAuthenticator({ authMethod: 'life2', accountId: 'a', sub: 'u', email: 'e' })
    ]);

    expect(authenticator.authenticate('Bearer credential')).toEqual(
      expect.objectContaining({ authMethod: 'life2', accountId: 'a' })
    );
  });

  it('rejects a credential rejected by every configured strategy', () => {
    const authenticator = new CompositeRestAuthenticator([
      new StubAuthenticator(undefined),
      new StubAuthenticator(undefined)
    ]);

    expect(authenticator.authenticate('Bearer credential')).toBeUndefined();
  });
});

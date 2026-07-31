import { describe, expect, it } from 'vitest';

import { CompositeRestAuthenticator } from '../../src/adapters/rest/CompositeRestAuthenticator.js';
import type { RestAuthenticator } from '../../src/adapters/rest/RestBearerAuthenticator.js';

class StubAuthenticator implements RestAuthenticator {
  constructor(private readonly result: boolean) {}

  isAuthenticated(): boolean {
    return this.result;
  }
}

describe('CompositeRestAuthenticator', () => {
  it('accepts a credential accepted by any configured strategy', () => {
    const authenticator = new CompositeRestAuthenticator([
      new StubAuthenticator(false),
      new StubAuthenticator(true)
    ]);

    expect(authenticator.isAuthenticated('Bearer credential')).toBe(true);
  });

  it('rejects a credential rejected by every configured strategy', () => {
    const authenticator = new CompositeRestAuthenticator([
      new StubAuthenticator(false),
      new StubAuthenticator(false)
    ]);

    expect(authenticator.isAuthenticated('Bearer credential')).toBe(false);
  });
});

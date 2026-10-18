import jwt from 'jsonwebtoken';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { createSessionGuard } from '../../src/adapters/rest/account-session.cjs';

const key = 'unit-session-verifier-key-at-least-32-bytes';
const claims = { sub: 'subject', accountId: 'account', membershipVersion: 2 };
const session = {
  ...claims,
  subject: claims.sub,
  accountRole: 'ADMIN',
  platformRole: 'USER',
  masterDataEntityId: null
};
const token = (extra: Record<string, unknown> = {}): string =>
  jwt.sign({ ...claims, ...extra }, key, {
    issuer: 'life2.ralfe.me',
    audience: 'account',
    expiresIn: '5m'
  });
const request = (
  authorization = `Bearer ${token()}`
): { authorization: string; method: string; path: string } => ({
  authorization,
  method: 'GET',
  path: '/v1/loops'
});
function setup(
  body: unknown = session,
  status = 200
): {
  guard: ReturnType<typeof createSessionGuard>;
  fetchImpl: Mock<(url: string) => Promise<Response>>;
} {
  const fetchImpl = vi.fn(async (url: string): Promise<Response> => {
    void url;
    return new Response(JSON.stringify(body), { status });
  });
  const options = { key, verifyJwt: jwt.verify, fetchImpl, timeoutMilliseconds: 50 };
  return { guard: createSessionGuard(options), fetchImpl };
}

describe('current account session guard', () => {
  it('keeps readiness and explicit public routes independent of private identity', async () => {
    const { guard, fetchImpl } = setup();
    for (const path of [
      '/version',
      '/health',
      '/healthz',
      '/ready',
      '/readyz',
      '/health/live',
      '/health/ready',
      '/health/heartbeat'
    ]) {
      expect(await guard.authorize({ method: 'GET', path, authorization: undefined })).toBeNull();
    }
    expect(
      await guard.authorize({ method: 'OPTIONS', path: '/v1/loops', authorization: undefined })
    ).toBeNull();
    const options = {
      key,
      verifyJwt: jwt.verify,
      publicRoutes: [['POST', '/public']] as Array<[string, string]>
    };
    expect(createSessionGuard(options).publicRequest({ method: 'POST', path: '/public' })).toBe(
      true
    );
    expect(guard.publicRequest({ method: 'POST', path: '/version' })).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('validates its offline verifier and configured Auth origin before requests', () => {
    for (const authOrigin of [
      'not-url',
      'file:///tmp/auth',
      'https://name:password@auth.test',
      'https://auth.test/path',
      'https://auth.test?query=1',
      'https://auth.test#hash'
    ]) {
      expect(() => createSessionGuard({ key, verifyJwt: jwt.verify, authOrigin })).toThrow();
    }
    expect(() => createSessionGuard({ key: 'short', verifyJwt: jwt.verify })).toThrow();
  });

  it('requires a valid signed finite-expiry tenant and membership claim before Auth', async () => {
    const { guard, fetchImpl } = setup();
    for (const authorization of [
      '',
      'Basic token',
      'Bearer invalid',
      `Bearer ${token({ sub: '' })}`,
      `Bearer ${token({ accountId: '' })}`,
      `Bearer ${token({ membershipVersion: -1 })}`,
      `Bearer ${token({ membershipVersion: 1.5 })}`
    ]) {
      await expect(guard.authorize(request(authorization))).rejects.toMatchObject({ status: 401 });
    }
    const noExpiry = jwt.sign(claims, key, { issuer: 'life2.ralfe.me', audience: 'account' });
    await expect(guard.authorize(request(`Bearer ${noExpiry}`))).rejects.toMatchObject({
      status: 401
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('forwards only verified bearer identity and resolves membership on every request', async () => {
    const { guard, fetchImpl } = setup();
    expect(await guard.authorize(request())).toEqual(session);
    expect(await guard.authorize(request())).toEqual(session);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://auth.life-sqrd.com/api/session/resolve');
  });

  it('rejects revoked identities and exposes upstream outages explicitly', async () => {
    await expect(setup({}, 401).guard.authorize(request())).rejects.toMatchObject({
      status: 401,
      code: 'SESSION_INVALID'
    });
    await expect(setup({}, 503).guard.authorize(request())).rejects.toMatchObject({ status: 503 });
    const options = {
      key,
      verifyJwt: jwt.verify,
      fetchImpl: vi.fn().mockRejectedValue(new Error('unit network failure'))
    };
    await expect(createSessionGuard(options).authorize(request())).rejects.toMatchObject({
      status: 503
    });
  });

  it('rejects invalid response shapes, authority changes and downgraded roles', async () => {
    for (const body of [
      null,
      [],
      {},
      { ...session, subject: '' },
      { ...session, accountRole: 'OWNER' },
      { ...session, platformRole: 'OWNER' },
      { ...session, membershipVersion: -1 },
      { ...session, masterDataEntityId: '' }
    ]) {
      await expect(setup(body).guard.authorize(request())).rejects.toMatchObject({ status: 502 });
    }
    for (const body of [
      { ...session, subject: 'other' },
      { ...session, accountId: 'other' },
      { ...session, membershipVersion: 3 }
    ]) {
      await expect(setup(body).guard.authorize(request())).rejects.toMatchObject({
        status: 401,
        code: 'SESSION_INVALID'
      });
    }
    for (const accountRole of ['ADULT', 'CHILD']) {
      await expect(
        setup({ ...session, accountRole }).guard.authorize(request())
      ).rejects.toMatchObject({ status: 403 });
    }
    expect(
      await setup({ ...session, masterDataEntityId: 'person' }).guard.authorize(request())
    ).toMatchObject({ masterDataEntityId: 'person' });
  });

  it('bounds declared and streaming responses and rejects missing or invalid JSON bodies', async () => {
    for (const makeResponse of [
      (): Response => new Response('{}', { headers: { 'content-length': '40000' } }),
      (): Response => new Response('x'.repeat(40000)),
      (): Response => new Response(null),
      (): Response => new Response('invalid-json')
    ]) {
      const options = { key, verifyJwt: jwt.verify, fetchImpl: vi.fn(async () => makeResponse()) };
      await expect(createSessionGuard(options).authorize(request())).rejects.toMatchObject({
        status: 502
      });
    }
  });

  it('accepts legacy membership version zero only when current Auth agrees', async () => {
    const legacyToken = jwt.sign({ sub: claims.sub, accountId: claims.accountId }, key, {
      issuer: 'life2.ralfe.me',
      audience: 'account',
      expiresIn: '5m'
    });
    expect(
      await setup({ ...session, membershipVersion: 0 }).guard.authorize(
        request(`Bearer ${legacyToken}`)
      )
    ).toMatchObject({ membershipVersion: 0 });
    await expect(setup().guard.authorize(request(`Bearer ${legacyToken}`))).rejects.toMatchObject({
      status: 401
    });
  });
});

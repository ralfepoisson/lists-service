import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { readFile, lstat } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import { log } from 'node:console';

// This acceptance helper is fixed to the local development proxy and local key.
// It creates an isolated tenant fixture, verifies real persistence, then closes it.
const origin = 'http://life2.localhost:46139/api/lists';
const keyPath = new URL('../../.life2-local/secrets/life2-jwt-key-base64', import.meta.url);
const keyMetadata = await lstat(keyPath);
assert(
  keyMetadata.isFile() && (keyMetadata.mode & 0o077) === 0,
  'Local key must be a protected regular file.'
);
const key = Buffer.from((await readFile(keyPath, 'utf8')).trim(), 'base64');
assert(key.length >= 32, 'Local signing key is unavailable.');
const accountId = randomUUID();
const sub = randomUUID();
const email = 'loop-comments-acceptance@example.invalid';

function tokenFor(tenant, subject) {
  const encodedHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString(
    'base64url'
  );
  const now = Math.floor(Date.now() / 1000);
  const encodedClaims = Buffer.from(
    JSON.stringify({
      iss: 'life2.ralfe.me',
      aud: 'account',
      exp: now + 300,
      iat: now,
      accountId: tenant,
      sub: subject,
      email,
      applicationId: 'life2-local-acceptance'
    })
  ).toString('base64url');
  const payload = `${encodedHeader}.${encodedClaims}`;
  return `${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}`;
}

const token = tokenFor(accountId, sub);
async function request(method, path, body, expectedStatus, authorization = token) {
  const response = await globalThis.fetch(`${origin}${path}`, {
    method,
    headers: { authorization: `Bearer ${authorization}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: globalThis.AbortSignal.timeout(15_000)
  });
  assert.equal(response.status, expectedStatus, `${method} ${path} status`);
  return response.json();
}

const preflight = await request('GET', `/v1/loops/${randomUUID()}/comments`, undefined, 404);
assert.equal(preflight.error.code, 'LOOP_NOT_FOUND', 'Current comments API must be serving.');
const created = await request(
  'POST',
  '/v1/loops',
  {
    title: 'Loop comments local acceptance',
    outcome: 'A profile comment is persisted and read back with verified attribution.'
  },
  201
);
const loopId = created.data.id;
assert.equal(typeof loopId, 'string');
const path = `/v1/loops/${encodeURIComponent(loopId)}/comments`;
const result = await request(
  'POST',
  path,
  { content: '  Verified local comment round trip.  ' },
  201
);
assert.equal(result.data.content, 'Verified local comment round trip.');
assert.equal(result.data.authorSub, sub);
assert.equal(result.data.authorEmail, email);
assert.equal(result.data.loopId, loopId);
assert(Number.isFinite(Date.parse(result.data.createdAt)));
const readback = await request('GET', path, undefined, 200);
assert.deepEqual(readback.data, [result.data]);
await request('POST', path, { content: 'Forged attribution', authorSub: 'other' }, 400);
const foreign = tokenFor(randomUUID(), randomUUID());
await request('GET', path, undefined, 404, foreign);
await request('POST', path, { content: 'Foreign write' }, 404, foreign);
await request('POST', `/v1/loops/${encodeURIComponent(loopId)}/close`, { confirmed: true }, 200);
await request('POST', path, { content: 'Late comment' }, 409);
assert.deepEqual((await request('GET', path, undefined, 200)).data, [result.data]);
log(
  `PASS real local Loop comments: persisted readback, verified author, forged author400, foreign read/write404, closed write409, closed read200; isolated fixture ${loopId} closed.`
);

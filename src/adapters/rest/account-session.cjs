"use strict";
// Canonical standalone runtime guard. Synced copies carry an SHA256 receipt.
const http = require("node:http");
const PUBLIC_GET = new Set([
  "/version",
  "/health",
  "/healthz",
  "/ready",
  "/readyz",
  "/health/live",
  "/health/ready",
  "/health/heartbeat",
]);
const fail = (status, message, code) =>
  Object.assign(new Error(message), {
    status,
    statusCode: status,
    ...(code ? { code } : {}),
  });
function trustedOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("LIFE2_AUTH_BASE_URL must be an absolute service origin");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(
      "LIFE2_AUTH_BASE_URL must be an HTTP(S) origin without path or credentials",
    );
  return url.origin;
}
function validateSession(value, claims) {
  const version =
    claims.membershipVersion === undefined ? 0 : claims.membershipVersion;
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof value.subject !== "string" ||
    !value.subject ||
    typeof value.accountId !== "string" ||
    !value.accountId ||
    !["ADMIN", "ADULT", "CHILD"].includes(value.accountRole) ||
    !["ADMIN", "USER"].includes(value.platformRole) ||
    !Number.isSafeInteger(value.membershipVersion) ||
    value.membershipVersion < 0 ||
    !(
      value.masterDataEntityId === null ||
      (typeof value.masterDataEntityId === "string" &&
        value.masterDataEntityId.trim())
    )
  )
    throw fail(502, "Account session response is invalid");
  if (
    value.subject !== claims.sub ||
    value.accountId !== claims.accountId ||
    value.membershipVersion !== version
  )
    throw fail(401, "Session is no longer valid", "SESSION_INVALID");
  return value;
}
function createSessionGuard({
  key,
  issuer = "life2.ralfe.me",
  audience = "account",
  verifyJwt,
  authOrigin = process.env.LIFE2_AUTH_BASE_URL || "https://auth.life-sqrd.com",
  fetchImpl = globalThis.fetch,
  timeoutMilliseconds = 3000,
  allowStarPersonPicker = false,
  publicRoutes = [],
} = {}) {
  if (!key || key.length < 32 || typeof verifyJwt !== "function")
    throw new Error(
      "Runtime session guard requires the configured offline JWT verifier",
    );
  const origin = trustedOrigin(authOrigin),
    extraPublic = new Set(
      publicRoutes.map(([method, path]) => `${method} ${path}`),
    );
  const publicRequest = ({ method, path }) =>
    method === "OPTIONS" ||
    (method === "GET" && PUBLIC_GET.has(path)) ||
    extraPublic.has(`${method} ${path}`);
  async function authorize({ authorization, method, path }) {
    if (publicRequest({ method, path })) return null;
    let claims;
    try {
      const match = /^Bearer ([^\s]+)$/i.exec(authorization || "");
      if (!match) throw new Error("missing");
      claims = verifyJwt(match[1], key, {
        algorithms: ["HS256"],
        issuer,
        audience,
        clockTolerance: 5,
      });
      if (
        typeof claims?.exp !== "number" || !Number.isFinite(claims.exp) ||
        typeof claims?.sub !== "string" ||
        !claims.sub ||
        typeof claims.accountId !== "string" ||
        !claims.accountId ||
        !(
          claims.membershipVersion === undefined ||
          (Number.isSafeInteger(claims.membershipVersion) &&
            claims.membershipVersion >= 0)
        )
      )
        throw new Error("claims");
    } catch {
      throw fail(401, "Unauthorized");
    }
    let response, body;
    try {
      response = await fetchImpl(`${origin}/api/session/resolve`, {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMilliseconds),
        headers: { Accept: "application/json", Authorization: authorization },
      });
      if (response.status === 401)
        throw fail(401, "Session is no longer valid", "SESSION_INVALID");
      if (response.status !== 200)
        throw fail(503, "Account session service is unavailable");
      if (Number(response.headers.get("content-length")) > 32768)
        throw fail(502, "Account session response is invalid");
      const reader = response.body?.getReader();
      if (!reader) throw fail(502, "Account session response is invalid");
      let length = 0;
      const chunks = [];
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > 32768) {
            await reader.cancel();
            throw fail(502, "Account session response is invalid");
          }
          chunks.push(Buffer.from(value));
        }
      } finally {
        reader.releaseLock();
      }
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch (error) {
      if ([401, 502, 503].includes(error.status)) throw error;
      throw fail(
        response?.status === 200 ? 502 : 503,
        response?.status === 200
          ? "Account session response is invalid"
          : "Account session service is unavailable",
      );
    }
    const session = validateSession(body, claims);
    const picker =
      allowStarPersonPicker &&
      method === "GET" &&
      path === "/genealogy/candidates" &&
      claims.scope === "life2:star-chart-person-entities" &&
      claims.applicationId === "life2-auth-star-chart-person-entities" &&
      session.scope === claims.scope &&
      session.applicationId === claims.applicationId;
    if (session.accountRole !== "ADMIN" && !picker)
      throw fail(403, "Account administrator access is required");
    return session;
  }
  return { authorize, publicRequest };
}
function guardHttpHandler(handler, options) {
  const guard = createSessionGuard(options);
  const secured = async (request, response) => {
    try {
      await guard.authorize({
        authorization: request.headers.authorization,
        method: request.method,
        path: new URL(request.url, "http://localhost").pathname,
      });
      return handler(request, response);
    } catch (error) {
      response.writeHead(error.status || 503, {
        "Content-Type": "application/json",
        "Cache-Control": "private, no-store",
      });
      response.end(
        JSON.stringify({
          message: error.message,
          ...(error.code ? { code: error.code } : {}),
        }),
      );
    }
  };
  secured.listen = (...args) => http.createServer(secured).listen(...args);
  return secured;
}
module.exports = {
  createSessionGuard,
  guardHttpHandler,
  trustedOrigin,
  validateSession,
};

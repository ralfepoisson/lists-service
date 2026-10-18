export interface SessionRequest {
  authorization: string | undefined;
  method: string;
  path: string;
}
export interface SessionOptions {
  key: Buffer | string;
  verifyJwt: typeof import("jsonwebtoken").verify;
  issuer?: string;
  audience?: string;
  authOrigin?: string;
  allowStarPersonPicker?: boolean;
  publicRoutes?: Array<[string, string]>;
}
export function createSessionGuard(options: SessionOptions): {
  authorize(request: SessionRequest): Promise<Record<string, unknown> | null>;
  publicRequest(request: { method: string; path: string }): boolean;
};

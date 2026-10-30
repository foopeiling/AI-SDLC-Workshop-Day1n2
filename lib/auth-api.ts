import { createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { rateLimitDB } from './db';
import { getWebAuthnConfig } from './webauthn-config';

const AUTH_RATE_WINDOW_MS = 15 * 60 * 1000;

const actionLimits = {
  'register-options': 10,
  'register-verify': 10,
  'login-options': 20,
  'login-verify': 10,
  'passkey-register-options': 10,
  'passkey-register-verify': 10,
  logout: 30,
  me: 60,
} as const;

export type AuthAction = keyof typeof actionLimits;

export function getClientAddress(headers: Headers, trustedProxy: boolean): string {
  if (!trustedProxy) return 'untrusted-proxy';

  const directAddress = headers.get('x-real-ip')?.trim();
  if (directAddress) return directAddress;

  const forwardedAddress = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwardedAddress || 'unknown';
}

export function isSameOrigin(originValue: string | null, expectedOrigin: string): boolean {
  if (!originValue) return false;

  try {
    return new URL(originValue).origin === new URL(expectedOrigin).origin;
  } catch {
    return false;
  }
}

export function consumeAuthRateLimit(request: NextRequest, action: AuthAction) {
  const trustedProxy = process.env.TRUSTED_PROXY === 'true';
  const clientAddress = getClientAddress(
    request.headers,
    trustedProxy,
  );

  if (
    process.env.NODE_ENV === 'production' &&
    (!trustedProxy || clientAddress === 'unknown')
  ) {
    return { allowed: false, retryAfterSeconds: 0, identityConfigured: false };
  }

  const key = createHash('sha256').update(`${action}:${clientAddress}`).digest('hex');

  return {
    ...rateLimitDB.consume(key, actionLimits[action], AUTH_RATE_WINDOW_MS),
    identityConfigured: true,
  };
}

export function authorizeAuthRequest(
  request: NextRequest,
  action: AuthAction,
): NextResponse | null {
  if (!isSameOrigin(request.headers.get('origin'), getWebAuthnConfig().origin)) {
    return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 });
  }

  const rateLimit = consumeAuthRateLimit(request, action);
  if (!rateLimit.identityConfigured) {
    return NextResponse.json(
      { error: 'Authentication is unavailable until trusted proxy identity is configured.' },
      { status: 503 },
    );
  }

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      {
        status: 429,
        headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) },
      },
    );
  }

  return null;
}
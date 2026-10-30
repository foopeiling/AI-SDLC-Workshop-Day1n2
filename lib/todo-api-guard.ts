import { createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { getClientAddress, isSameOrigin } from './auth-api';
import { rateLimitDB } from './db';
import { getWebAuthnConfig } from './webauthn-config';

const TODO_RATE_LIMIT = 120;
const TODO_RATE_WINDOW_MS = 15 * 60 * 1000;

export function authorizeTodoRequest(
  request: NextRequest,
  action: string,
  isMutation = false,
): NextResponse | null {
  if (
    isMutation &&
    !isSameOrigin(request.headers.get('origin'), getWebAuthnConfig().origin)
  ) {
    return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 });
  }

  const trustedProxy = process.env.TRUSTED_PROXY === 'true';
  const clientAddress = getClientAddress(request.headers, trustedProxy);
  if (process.env.NODE_ENV === 'production' && (!trustedProxy || clientAddress === 'unknown')) {
    return NextResponse.json(
      { error: 'API access is unavailable until trusted proxy identity is configured.' },
      { status: 503 },
    );
  }

  const key = createHash('sha256').update(`${action}:${clientAddress}`).digest('hex');
  const rateLimit = rateLimitDB.consume(key, TODO_RATE_LIMIT, TODO_RATE_WINDOW_MS);
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
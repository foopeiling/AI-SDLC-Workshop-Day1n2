import { NextResponse, type NextRequest } from 'next/server';
import { consumeAuthRateLimit } from '@/lib/auth-api';
import { getSession } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const rateLimit = consumeAuthRateLimit(request, 'me');
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

  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  return NextResponse.json({ user: session });
}
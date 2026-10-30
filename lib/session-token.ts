import { SignJWT, jwtVerify } from 'jose';

export const SESSION_COOKIE_NAME = 'todo_session';

export interface SessionIdentity {
  userId: number;
  username: string;
}

function getSessionSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;

  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error('SESSION_SECRET must contain at least 32 bytes');
  }

  return new TextEncoder().encode(secret);
}

export function validateSessionSecret(): void {
  getSessionSecret();
}

export async function createSessionToken(identity: SessionIdentity): Promise<string> {
  return new SignJWT({ userId: identity.userId, username: identity.username })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(getSessionSecret());
}

export async function verifySessionToken(token: string): Promise<SessionIdentity | null> {
  try {
    const { payload } = await jwtVerify(token, getSessionSecret(), {
      algorithms: ['HS256'],
    });

    if (
      typeof payload.userId !== 'number' ||
      !Number.isSafeInteger(payload.userId) ||
      payload.userId < 1 ||
      typeof payload.username !== 'string' ||
      payload.username.length === 0
    ) {
      return null;
    }

    return { userId: payload.userId, username: payload.username };
  } catch {
    return null;
  }
}
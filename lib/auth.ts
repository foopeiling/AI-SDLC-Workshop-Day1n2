import { cookies } from 'next/headers';
import type { User } from '@/lib/db';
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  verifySessionToken,
} from '@/lib/session-token';

const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export async function createSession(user: User): Promise<void> {
  const token = await createSessionToken({ userId: user.id, username: user.username });
  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  return token ? verifySessionToken(token) : null;
}

export async function deleteSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
}
import { SignJWT } from 'jose';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createSessionToken,
  validateSessionSecret,
  verifySessionToken,
} from '../../lib/session-token';

const sessionSecret = 'test-session-secret-with-at-least-32-bytes';

describe('session token', () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = sessionSecret;
  });

  it('round-trips the authenticated user identity', async () => {
    const token = await createSessionToken({ userId: 7, username: 'alice' });

    await expect(verifySessionToken(token)).resolves.toEqual({
      userId: 7,
      username: 'alice',
    });
  });

  it('rejects tampered tokens', async () => {
    const token = await createSessionToken({ userId: 7, username: 'alice' });

    await expect(verifySessionToken(`${token.slice(0, -1)}x`)).resolves.toBeNull();
  });

  it('rejects expired tokens', async () => {
    const token = await new SignJWT({ userId: 7, username: 'alice' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 60)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 30)
      .sign(new TextEncoder().encode(sessionSecret));

    await expect(verifySessionToken(token)).resolves.toBeNull();
  });

  it('requires a sufficiently strong session secret before account persistence', () => {
    delete process.env.SESSION_SECRET;

    expect(() => validateSessionSecret()).toThrow('SESSION_SECRET must contain at least 32 bytes');
  });
});
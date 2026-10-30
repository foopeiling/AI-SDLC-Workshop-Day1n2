import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  authorizeAuthRequest,
  getClientAddress,
  isSameOrigin,
} from '../../lib/auth-api';

describe('auth API request guards', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test');
    process.env.TRUSTED_PROXY = 'true';
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses the trusted real-ip header before forwarded-for', () => {
    const headers = new Headers({
      'x-real-ip': '192.0.2.10',
      'x-forwarded-for': '192.0.2.20, 192.0.2.30',
    });

    expect(getClientAddress(headers, true)).toBe('192.0.2.10');
    expect(getClientAddress(headers, false)).toBe('untrusted-proxy');
  });

  it('falls back to the first forwarded address and then an unknown bucket', () => {
    expect(
      getClientAddress(new Headers({ 'x-forwarded-for': '192.0.2.20, 192.0.2.30' }), true),
    ).toBe('192.0.2.20');
    expect(getClientAddress(new Headers(), true)).toBe('unknown');
  });

  it('allows only exact same-origin requests', () => {
    expect(isSameOrigin('https://todo.example.com', 'https://todo.example.com')).toBe(true);
    expect(isSameOrigin('https://attacker.example', 'https://todo.example.com')).toBe(false);
    expect(isSameOrigin(null, 'https://todo.example.com')).toBe(false);
  });

  it('rejects cross-origin requests and accepts the configured origin', () => {
    process.env.RP_NAME = 'Todo App';
    process.env.RP_ID = 'localhost';
    process.env.RP_ORIGIN = 'http://localhost:3000';

    const crossOriginRequest = new NextRequest('http://localhost:3000/api/auth/logout', {
      method: 'POST',
      headers: {
        origin: 'http://attacker.example',
        'x-real-ip': `192.0.2.${Math.floor(Math.random() * 200) + 1}`,
      },
    });
    const sameOriginRequest = new NextRequest('http://localhost:3000/api/auth/logout', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        'x-real-ip': `192.0.2.${Math.floor(Math.random() * 200) + 1}`,
      },
    });

    expect(authorizeAuthRequest(crossOriginRequest, 'logout')?.status).toBe(403);
    expect(authorizeAuthRequest(sameOriginRequest, 'logout')).toBeNull();
  });

  it('returns 429 after the configured per-action limit', () => {
    process.env.RP_NAME = 'Todo App';
    process.env.RP_ID = 'localhost';
    process.env.RP_ORIGIN = 'http://localhost:3000';
    const ip = `192.0.2.${Math.floor(Math.random() * 200) + 1}`;

    const responses = Array.from({ length: 11 }, () => {
      const request = new NextRequest('http://localhost:3000/api/auth/register-options', {
        method: 'POST',
        headers: { origin: 'http://localhost:3000', 'x-real-ip': ip },
      });
      return authorizeAuthRequest(request, 'register-options');
    });

    expect(responses.at(-1)?.status).toBe(429);
  });

  it('does not consume rate-limit quota for a rejected cross-origin request', () => {
    process.env.RP_NAME = 'Todo App';
    process.env.RP_ID = 'localhost';
    process.env.RP_ORIGIN = 'http://localhost:3000';
    const ip = `192.0.2.${Math.floor(Math.random() * 200) + 1}`;
    const createRequest = (origin: string) =>
      new NextRequest('http://localhost:3000/api/auth/register-options', {
        method: 'POST',
        headers: { origin, 'x-real-ip': ip },
      });

    expect(authorizeAuthRequest(createRequest('http://attacker.example'), 'register-options')?.status).toBe(
      403,
    );
    const allowedRequests = Array.from({ length: 10 }, () =>
      authorizeAuthRequest(createRequest('http://localhost:3000'), 'register-options'),
    );

    expect(allowedRequests.every((response) => response === null)).toBe(true);
    expect(authorizeAuthRequest(createRequest('http://localhost:3000'), 'register-options')?.status).toBe(
      429,
    );
  });

  it('fails closed in production when a trusted client address is unavailable', () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.RP_NAME = 'Todo App';
    process.env.RP_ID = 'todo.example.com';
    process.env.RP_ORIGIN = 'https://todo.example.com';
    process.env.TRUSTED_PROXY = 'false';
    const request = new NextRequest('https://todo.example.com/api/auth/login-options', {
      method: 'POST',
      headers: { origin: 'https://todo.example.com', 'x-real-ip': '198.51.100.8' },
    });

    expect(authorizeAuthRequest(request, 'login-options')?.status).toBe(503);

    process.env.TRUSTED_PROXY = 'true';
    const requestWithoutForwardedAddress = new NextRequest(
      'https://todo.example.com/api/auth/login-options',
      { method: 'POST', headers: { origin: 'https://todo.example.com' } },
    );
    expect(authorizeAuthRequest(requestWithoutForwardedAddress, 'login-options')?.status).toBe(503);
  });
});
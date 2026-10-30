import { describe, expect, it } from 'vitest';
import { getWebAuthnConfig, isCounterUpdateAllowed } from '../../lib/webauthn-config';

describe('WebAuthn configuration', () => {
  it('accepts a localhost development origin', () => {
    expect(
      getWebAuthnConfig({
        RP_NAME: 'Todo App',
        RP_ID: 'localhost',
        RP_ORIGIN: 'http://localhost:3000',
        NODE_ENV: 'development',
      }),
    ).toEqual({ rpName: 'Todo App', rpId: 'localhost', origin: 'http://localhost:3000' });
  });

  it('rejects a production origin that does not match the RP ID', () => {
    expect(() =>
      getWebAuthnConfig({
        RP_NAME: 'Todo App',
        RP_ID: 'example.com',
        RP_ORIGIN: 'https://attacker.example',
        NODE_ENV: 'production',
      }),
    ).toThrow('RP_ORIGIN hostname must match RP_ID');
  });

  it('requires HTTPS outside localhost in production', () => {
    expect(() =>
      getWebAuthnConfig({
        RP_NAME: 'Todo App',
        RP_ID: 'example.com',
        RP_ORIGIN: 'http://example.com',
        NODE_ENV: 'production',
      }),
    ).toThrow('RP_ORIGIN must use HTTPS in production');
  });
});

describe('authenticator counter validation', () => {
  it('accepts monotonic counters and repeated zero counters', () => {
    expect(isCounterUpdateAllowed(4, 5)).toBe(true);
    expect(isCounterUpdateAllowed(0, 0)).toBe(true);
  });

  it('rejects stale counters except when both values are zero', () => {
    expect(isCounterUpdateAllowed(5, 5)).toBe(false);
    expect(isCounterUpdateAllowed(5, 4)).toBe(false);
    expect(isCounterUpdateAllowed(5, 0)).toBe(false);
  });

  it('treats missing counter values as zero', () => {
    expect(isCounterUpdateAllowed(undefined, undefined)).toBe(true);
    expect(isCounterUpdateAllowed(0, undefined)).toBe(true);
  });
});
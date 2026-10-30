import { describe, expect, it } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import {
  clearChallengeCookie,
  getChallengeId,
  setChallengeCookie,
} from '../../lib/auth-challenges';

describe('WebAuthn challenge cookies', () => {
  it('uses separate HttpOnly cookies for each ceremony', () => {
    const response = NextResponse.json({});

    setChallengeCookie(response, 'registration-id', 'registration');
    setChallengeCookie(response, 'login-id', 'login');

    expect(response.cookies.get('auth_registration_challenge')?.value).toBe('registration-id');
    expect(response.cookies.get('auth_login_challenge')?.value).toBe('login-id');
    expect(response.cookies.get('auth_registration_challenge')?.httpOnly).toBe(true);
    expect(response.cookies.get('auth_login_challenge')?.sameSite).toBe('lax');
  });

  it('reads and clears the matching ceremony cookie', () => {
    const request = new NextRequest('http://localhost/api/auth/login-verify', {
      headers: { cookie: 'auth_login_challenge=login-id' },
    });
    const response = NextResponse.json({});

    expect(getChallengeId(request, 'login')).toBe('login-id');
    clearChallengeCookie(response, 'login');
    expect(response.cookies.get('auth_login_challenge')?.maxAge).toBe(0);
  });
});
import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { challengeDB, type ChallengeCeremony } from './db';

export const CHALLENGE_TTL_SECONDS = 5 * 60;
const CHALLENGE_TTL_MS = CHALLENGE_TTL_SECONDS * 1000;

const challengeCookieNames: Record<ChallengeCeremony, string> = {
  registration: 'auth_registration_challenge',
  login: 'auth_login_challenge',
  'passkey-registration': 'auth_passkey_challenge',
};

export function saveChallenge(
  username: string,
  ceremony: ChallengeCeremony,
  challenge: string,
): string {
  const id = randomUUID();
  challengeDB.create({
    id,
    username,
    ceremony,
    challenge,
    expiresAt: Date.now() + CHALLENGE_TTL_MS,
  });
  return id;
}

export function setChallengeCookie(
  response: NextResponse,
  id: string,
  ceremony: ChallengeCeremony,
): void {
  response.cookies.set(challengeCookieNames[ceremony], id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/api/auth',
    maxAge: CHALLENGE_TTL_SECONDS,
  });
}

export function getChallengeId(
  request: NextRequest,
  ceremony: ChallengeCeremony,
): string | null {
  return request.cookies.get(challengeCookieNames[ceremony])?.value ?? null;
}

export function consumeChallenge(
  request: NextRequest,
  username: string,
  ceremony: ChallengeCeremony,
): string | null {
  const id = getChallengeId(request, ceremony);
  return id ? challengeDB.consume(id, username, ceremony) : null;
}

export function clearChallengeCookie(
  response: NextResponse,
  ceremony: ChallengeCeremony,
): void {
  response.cookies.set(challengeCookieNames[ceremony], '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/api/auth',
    maxAge: 0,
  });
}

export function challengeResponse(
  body: unknown,
  status: number,
  ceremony: ChallengeCeremony,
): NextResponse {
  const response = NextResponse.json(body, { status });
  clearChallengeCookie(response, ceremony);
  return response;
}
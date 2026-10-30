import { generateRegistrationOptions } from '@simplewebauthn/server';
import { NextResponse, type NextRequest } from 'next/server';
import { authorizeAuthRequest } from '@/lib/auth-api';
import { saveChallenge, setChallengeCookie } from '@/lib/auth-challenges';
import { getSession } from '@/lib/auth';
import { authenticatorDB } from '@/lib/db';
import { getWebAuthnConfig } from '@/lib/webauthn-config';

export async function POST(request: NextRequest) {
  const guard = authorizeAuthRequest(request, 'passkey-register-options');
  if (guard) return guard;

  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  try {
    const config = getWebAuthnConfig();
    const existingAuthenticators = authenticatorDB.findByUserId(session.userId);
    const options = await generateRegistrationOptions({
      rpName: config.rpName,
      rpID: config.rpId,
      userID: Buffer.from(String(session.userId)),
      userName: session.username,
      userDisplayName: session.username,
      excludeCredentials: existingAuthenticators.map((authenticator) => ({
        id: authenticator.credential_id,
      })),
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });
    const challengeId = saveChallenge(
      session.username,
      'passkey-registration',
      options.challenge,
    );
    const response = NextResponse.json(options);
    setChallengeCookie(response, challengeId, 'passkey-registration');
    return response;
  } catch {
    return NextResponse.json({ error: 'Passkey enrollment is temporarily unavailable.' }, { status: 500 });
  }
}
import { generateRegistrationOptions } from '@simplewebauthn/server';
import { NextResponse, type NextRequest } from 'next/server';
import { authorizeAuthRequest } from '@/lib/auth-api';
import { saveChallenge, setChallengeCookie } from '@/lib/auth-challenges';
import { userDB } from '@/lib/db';
import { readJsonBody, usernameSchema } from '@/lib/auth-validation';
import { getWebAuthnConfig } from '@/lib/webauthn-config';
import { z } from 'zod';

const requestSchema = z.object({ username: usernameSchema });

export async function POST(request: NextRequest) {
  const guard = authorizeAuthRequest(request, 'register-options');
  if (guard) return guard;

  const parsed = requestSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Enter a valid username.' }, { status: 400 });
  }

  if (userDB.findByUsername(parsed.data.username)) {
    return NextResponse.json({ error: 'Username already taken.' }, { status: 409 });
  }

  try {
    const config = getWebAuthnConfig();
    const options = await generateRegistrationOptions({
      rpName: config.rpName,
      rpID: config.rpId,
      userName: parsed.data.username,
      userDisplayName: parsed.data.username,
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });
    const challengeId = saveChallenge(
      parsed.data.username,
      'registration',
      options.challenge,
    );
    const response = NextResponse.json(options);
    setChallengeCookie(response, challengeId, 'registration');
    return response;
  } catch {
    return NextResponse.json({ error: 'Registration is temporarily unavailable.' }, { status: 500 });
  }
}
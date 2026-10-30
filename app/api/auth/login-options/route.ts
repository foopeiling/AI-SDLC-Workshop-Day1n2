import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { NextResponse, type NextRequest } from 'next/server';
import { authorizeAuthRequest } from '@/lib/auth-api';
import { saveChallenge, setChallengeCookie } from '@/lib/auth-challenges';
import { authenticatorDB, userDB } from '@/lib/db';
import { readJsonBody, usernameSchema } from '@/lib/auth-validation';
import { getWebAuthnConfig } from '@/lib/webauthn-config';
import { z } from 'zod';

const requestSchema = z.object({ username: usernameSchema });

export async function POST(request: NextRequest) {
  const guard = authorizeAuthRequest(request, 'login-options');
  if (guard) return guard;

  const parsed = requestSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Enter a valid username.' }, { status: 400 });
  }

  const user = userDB.findByUsername(parsed.data.username);
  const authenticators = user ? authenticatorDB.findByUserId(user.id) : [];
  if (!user || authenticators.length === 0) {
    return NextResponse.json({ error: 'Unable to start login.' }, { status: 401 });
  }

  try {
    const config = getWebAuthnConfig();
    const options = await generateAuthenticationOptions({
      rpID: config.rpId,
      allowCredentials: authenticators.map((authenticator) => ({
        id: authenticator.credential_id,
      })),
      userVerification: 'preferred',
    });
    const challengeId = saveChallenge(parsed.data.username, 'login', options.challenge);
    const response = NextResponse.json(options);
    setChallengeCookie(response, challengeId, 'login');
    return response;
  } catch {
    return NextResponse.json({ error: 'Login is temporarily unavailable.' }, { status: 500 });
  }
}
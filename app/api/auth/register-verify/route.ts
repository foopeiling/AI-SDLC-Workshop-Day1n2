import {
  verifyRegistrationResponse,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { authorizeAuthRequest } from '@/lib/auth-api';
import { challengeResponse, consumeChallenge } from '@/lib/auth-challenges';
import { createSession } from '@/lib/auth';
import { authenticatorDB, db, userDB, type User } from '@/lib/db';
import { readJsonBody, registrationResponseSchema, usernameSchema } from '@/lib/auth-validation';
import { getWebAuthnConfig } from '@/lib/webauthn-config';
import { validateSessionSecret } from '@/lib/session-token';

const requestSchema = z.object({ username: usernameSchema, response: registrationResponseSchema });

export async function POST(request: NextRequest) {
  const guard = authorizeAuthRequest(request, 'register-verify');
  if (guard) return guard;

  const parsed = requestSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid registration response.' }, { status: 400 });
  }

  const challenge = consumeChallenge(request, parsed.data.username, 'registration');
  if (!challenge) {
    return challengeResponse({ error: 'Registration challenge expired. Please try again.' }, 401, 'registration');
  }

  if (userDB.findByUsername(parsed.data.username)) {
    return challengeResponse({ error: 'Username already taken.' }, 409, 'registration');
  }

  let config;
  try {
    config = getWebAuthnConfig();
    validateSessionSecret();
  } catch {
    return challengeResponse({ error: 'Registration is temporarily unavailable.' }, 503, 'registration');
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: parsed.data.response as RegistrationResponseJSON,
      expectedChallenge: challenge,
      expectedOrigin: config.origin,
      expectedRPID: config.rpId,
    });
  } catch {
    return challengeResponse({ error: 'Registration could not be verified.' }, 401, 'registration');
  }

  if (!verification.verified || !verification.registrationInfo) {
    return challengeResponse({ error: 'Registration could not be verified.' }, 401, 'registration');
  }

  const credential = verification.registrationInfo.credential;
  let user: User;
  try {
    const createAccount = db.transaction(() => {
      const user = userDB.create(parsed.data.username);
      authenticatorDB.create({
        userId: user.id,
        credentialId: isoBase64URL.fromBuffer(isoBase64URL.toBuffer(credential.id)),
        credentialPublicKey: Buffer.from(credential.publicKey),
        counter: credential.counter ?? 0,
      });
      return user;
    });
    user = createAccount.immediate();
  } catch {
    const alreadyExists = userDB.findByUsername(parsed.data.username) !== null;
    return challengeResponse(
      { error: alreadyExists ? 'Username already taken.' : 'Registration could not be completed.' },
      alreadyExists ? 409 : 500,
      'registration',
    );
  }

  try {
    await createSession(user);
  } catch {
    return challengeResponse(
      { error: 'Your account was created, but the session could not be started. Please sign in.' },
      500,
      'registration',
    );
  }

  return challengeResponse({ success: true }, 200, 'registration');
}
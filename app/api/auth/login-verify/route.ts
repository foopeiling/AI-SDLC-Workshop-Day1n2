import {
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { authorizeAuthRequest } from '@/lib/auth-api';
import { challengeResponse, consumeChallenge } from '@/lib/auth-challenges';
import { createSession } from '@/lib/auth';
import { authenticatorDB, userDB } from '@/lib/db';
import { authenticationResponseSchema, readJsonBody, usernameSchema } from '@/lib/auth-validation';
import { getWebAuthnConfig, isCounterUpdateAllowed } from '@/lib/webauthn-config';

const requestSchema = z.object({ username: usernameSchema, response: authenticationResponseSchema });

export async function POST(request: NextRequest) {
  const guard = authorizeAuthRequest(request, 'login-verify');
  if (guard) return guard;

  const parsed = requestSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid authentication response.' }, { status: 400 });
  }

  const challenge = consumeChallenge(request, parsed.data.username, 'login');
  if (!challenge) {
    return challengeResponse({ error: 'Login challenge expired. Please try again.' }, 401, 'login');
  }

  const authenticator = authenticatorDB.findByCredentialId(parsed.data.response.id);
  const user = userDB.findByUsername(parsed.data.username);
  if (!authenticator || !user || authenticator.user_id !== user.id) {
    return challengeResponse({ error: 'Authentication failed.' }, 401, 'login');
  }

  try {
    const config = getWebAuthnConfig();
    const verification = await verifyAuthenticationResponse({
      response: parsed.data.response as AuthenticationResponseJSON,
      expectedChallenge: challenge,
      expectedOrigin: config.origin,
      expectedRPID: config.rpId,
      credential: {
        id: isoBase64URL.fromBuffer(isoBase64URL.toBuffer(authenticator.credential_id)),
        publicKey: new Uint8Array(authenticator.credential_public_key),
        counter: authenticator.counter ?? 0,
      },
    });

    if (
      !verification.verified ||
      !isCounterUpdateAllowed(authenticator.counter ?? 0, verification.authenticationInfo.newCounter ?? 0)
    ) {
      return challengeResponse({ error: 'Authentication failed.' }, 401, 'login');
    }

    const counterUpdated = authenticatorDB.updateCounter(
      authenticator.id,
      authenticator.counter ?? 0,
      verification.authenticationInfo.newCounter ?? 0,
    );
    if (!counterUpdated) {
      return challengeResponse({ error: 'Authentication failed.' }, 401, 'login');
    }
    await createSession(user);
    return challengeResponse({ success: true }, 200, 'login');
  } catch {
    return challengeResponse({ error: 'Authentication failed.' }, 401, 'login');
  }
}
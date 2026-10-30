import {
  verifyRegistrationResponse,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { authorizeAuthRequest } from '@/lib/auth-api';
import { challengeResponse, consumeChallenge } from '@/lib/auth-challenges';
import { getSession } from '@/lib/auth';
import { authenticatorDB, db } from '@/lib/db';
import { readJsonBody, registrationResponseSchema } from '@/lib/auth-validation';
import { getWebAuthnConfig } from '@/lib/webauthn-config';

const requestSchema = z.object({ response: registrationResponseSchema });

export async function POST(request: NextRequest) {
  const guard = authorizeAuthRequest(request, 'passkey-register-verify');
  if (guard) return guard;

  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const parsed = requestSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid registration response.' }, { status: 400 });
  }

  const challenge = consumeChallenge(request, session.username, 'passkey-registration');
  if (!challenge) {
    return challengeResponse(
      { error: 'Passkey challenge expired. Please try again.' },
      401,
      'passkey-registration',
    );
  }

  try {
    const config = getWebAuthnConfig();
    const verification = await verifyRegistrationResponse({
      response: parsed.data.response as RegistrationResponseJSON,
      expectedChallenge: challenge,
      expectedOrigin: config.origin,
      expectedRPID: config.rpId,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return challengeResponse({ error: 'Passkey could not be verified.' }, 401, 'passkey-registration');
    }

    const credential = verification.registrationInfo.credential;
    const addAuthenticator = db.transaction(() => {
      if (authenticatorDB.findByCredentialId(credential.id)) {
        throw new Error('Credential is already registered');
      }
      authenticatorDB.create({
        userId: session.userId,
        credentialId: isoBase64URL.fromBuffer(isoBase64URL.toBuffer(credential.id)),
        credentialPublicKey: Buffer.from(credential.publicKey),
        counter: credential.counter ?? 0,
      });
    });
    addAuthenticator.immediate();

    return challengeResponse({ success: true }, 200, 'passkey-registration');
  } catch {
    return challengeResponse({ error: 'Passkey could not be added.' }, 409, 'passkey-registration');
  }
}
'use client';

import { startRegistration } from '@simplewebauthn/browser';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/server';
import { KeyRound, LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

async function getApiError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? 'The request could not be completed.';
  } catch {
    return 'The request could not be completed.';
  }
}

export function AccountActions() {
  const [message, setMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const router = useRouter();

  async function addPasskey() {
    setIsBusy(true);
    setMessage(null);

    try {
      if (!window.PublicKeyCredential) throw new Error('This browser does not support passkeys.');

      const optionsResponse = await fetch('/api/auth/passkeys/register-options', { method: 'POST' });
      if (!optionsResponse.ok) throw new Error(await getApiError(optionsResponse));
      const options = (await optionsResponse.json()) as PublicKeyCredentialCreationOptionsJSON;
      const credential = await startRegistration({ optionsJSON: options });
      const verifyResponse = await fetch('/api/auth/passkeys/register-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: credential }),
      });
      if (!verifyResponse.ok) throw new Error(await getApiError(verifyResponse));

      setMessage('Passkey added.');
    } catch (caughtError) {
      if (caughtError instanceof DOMException && caughtError.name === 'NotAllowedError') {
        setMessage('Passkey enrollment was cancelled.');
      } else {
        setMessage(caughtError instanceof Error ? caughtError.message : 'Could not add passkey.');
      }
    } finally {
      setIsBusy(false);
    }
  }

  async function logout() {
    setIsBusy(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      router.replace('/login');
      router.refresh();
    }
  }

  return (
    <div>
      <div className="app-actions">
        <button className="secondary-action" type="button" onClick={addPasskey} disabled={isBusy}>
          <KeyRound size={17} aria-hidden="true" /> Add passkey
        </button>
        <button className="secondary-action" type="button" onClick={logout} disabled={isBusy}>
          <LogOut size={17} aria-hidden="true" /> Sign out
        </button>
      </div>
      {message && <p className="auth-status" role="status">{message}</p>}
    </div>
  );
}
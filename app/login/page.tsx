'use client';

import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/server';
import { Fingerprint, KeyRound } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Mode = 'login' | 'register';

async function getApiError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? 'The request could not be completed.';
  } catch {
    return 'The request could not be completed.';
  }
}

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const router = useRouter();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!window.PublicKeyCredential) {
      setError('This browser does not support passkeys. Try a current version of Chrome, Edge, Safari, or Firefox.');
      return;
    }

    setIsBusy(true);
    const isRegistration = mode === 'register';
    const optionsPath = isRegistration ? 'register-options' : 'login-options';
    const verifyPath = isRegistration ? 'register-verify' : 'login-verify';

    try {
      const optionsResponse = await fetch(`/api/auth/${optionsPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });

      if (!optionsResponse.ok) throw new Error(await getApiError(optionsResponse));

      const options = await optionsResponse.json();
      const credential = isRegistration
        ? await startRegistration({
            optionsJSON: options as PublicKeyCredentialCreationOptionsJSON,
          })
        : await startAuthentication({
            optionsJSON: options as PublicKeyCredentialRequestOptionsJSON,
          });
      const verifyResponse = await fetch(`/api/auth/${verifyPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, response: credential }),
      });

      if (!verifyResponse.ok) throw new Error(await getApiError(verifyResponse));

      router.replace('/');
      router.refresh();
    } catch (caughtError) {
      if (caughtError instanceof DOMException && caughtError.name === 'NotAllowedError') {
        setError('The passkey prompt was cancelled. You can try again.');
      } else {
        setError(caughtError instanceof Error ? caughtError.message : 'Passkey authentication failed.');
      }
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <main className="auth-layout">
      <section className="auth-brand" aria-label="Todo App">
        <div className="wordmark">
          <span className="wordmark-mark" aria-hidden="true"><KeyRound size={19} /></span>
          <span>Todo</span>
        </div>
        <div className="brand-copy">
          <h1>Make space for the work that matters.</h1>
          <p>One clear place for the things you want to move forward.</p>
        </div>
        <div className="brand-foot">Private by design. Sign in with a passkey.</div>
      </section>

      <section className="auth-panel-wrap">
        <div className="auth-panel">
          <h2>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h2>
          <p className="auth-panel-intro">Use a passkey on this device to continue.</p>

          <div className="auth-tabs" role="tablist" aria-label="Account access">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'login'}
              onClick={() => { setMode('login'); setError(null); }}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'register'}
              onClick={() => { setMode('register'); setError(null); }}
            >
              Register
            </button>
          </div>

          <form onSubmit={handleSubmit}>
            <label className="field-label" htmlFor="username">Username</label>
            <input
              className="text-input"
              id="username"
              name="username"
              autoComplete="username webauthn"
              maxLength={64}
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
            <button className="primary-action" type="submit" disabled={isBusy || !username.trim()}>
              <Fingerprint size={19} aria-hidden="true" />
              {isBusy ? 'Waiting for passkey…' : mode === 'login' ? 'Continue with passkey' : 'Create with passkey'}
            </button>
          </form>

          {error && <p className="auth-error" role="alert">{error}</p>}
        </div>
      </section>
    </main>
  );
}
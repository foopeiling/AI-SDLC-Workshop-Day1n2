export interface WebAuthnConfig {
  rpName: string;
  rpId: string;
  origin: string;
}

export type Environment = Record<string, string | undefined>;

export function getWebAuthnConfig(environment: Environment = process.env): WebAuthnConfig {
  const rpName = environment.RP_NAME?.trim();
  const rpId = environment.RP_ID?.trim().toLowerCase();
  const originValue = environment.RP_ORIGIN?.trim();

  if (!rpName || !rpId || !originValue) {
    throw new Error('RP_NAME, RP_ID, and RP_ORIGIN must be configured');
  }

  let origin: URL;
  try {
    origin = new URL(originValue);
  } catch {
    throw new Error('RP_ORIGIN must be a valid absolute URL');
  }

  const isLocalhost = origin.hostname === 'localhost' || origin.hostname === '127.0.0.1';
  if (environment.NODE_ENV === 'production' && !isLocalhost && origin.protocol !== 'https:') {
    throw new Error('RP_ORIGIN must use HTTPS in production');
  }

  if (
    origin.hostname !== rpId &&
    !origin.hostname.endsWith(`.${rpId}`)
  ) {
    throw new Error('RP_ORIGIN hostname must match RP_ID');
  }

  return { rpName, rpId, origin: origin.origin };
}

export function isCounterUpdateAllowed(
  storedCounter: number | undefined,
  newCounter: number | undefined,
): boolean {
  const previous = storedCounter ?? 0;
  const next = newCounter ?? 0;

  return (previous === 0 && next === 0) || next > previous;
}
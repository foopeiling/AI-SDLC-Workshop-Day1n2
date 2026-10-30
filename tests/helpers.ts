import { expect, type Page } from '@playwright/test';

export async function addVirtualAuthenticator(
  page: Page,
  transport: 'internal' | 'usb' = 'internal',
) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport,
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return { cdp, authenticatorId };
}

export async function registerUser(page: Page, username: string): Promise<void> {
  await page.goto('/login');
  await page.getByRole('tab', { name: 'Register' }).click();
  await page.getByLabel('Username').fill(username);
  await page.getByRole('button', { name: 'Create with passkey' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { name: `Welcome, ${username}.` })).toBeVisible();
}
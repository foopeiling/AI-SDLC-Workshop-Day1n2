import { expect, test } from '@playwright/test';
import { addVirtualAuthenticator, registerUser } from '../helpers';

test('registers, persists, logs in, and logs out', async ({ page }) => {
  await addVirtualAuthenticator(page);
  const username = `journey-${Date.now()}`;

  await registerUser(page, username);
  await page.reload();
  await expect(page.getByRole('heading', { name: `Welcome, ${username}.` })).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByRole('button', { name: 'Continue with passkey' }).click();
  await expect(page).toHaveURL('/');

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL('/login');
  await page.goto('/');
  await expect(page).toHaveURL('/login');
});

test('protects the calendar and reports no current session', async ({ page }) => {
  const response = await page.request.get('/api/auth/me');
  expect(response.status()).toBe(401);

  await page.goto('/calendar');
  await expect(page).toHaveURL('/login');
});

test('allows an authenticated user to add and use a second passkey', async ({ page }) => {
  const firstAuthenticator = await addVirtualAuthenticator(page);
  const username = `devices-${Date.now()}`;
  await registerUser(page, username);

  const secondAuthenticator = await addVirtualAuthenticator(page, 'usb');
  await page.getByRole('button', { name: 'Add passkey' }).click();
  await expect(page.getByRole('status')).toHaveText('Passkey added.');

  await firstAuthenticator.cdp.send('WebAuthn.removeVirtualAuthenticator', {
    authenticatorId: firstAuthenticator.authenticatorId,
  });
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByRole('button', { name: 'Continue with passkey' }).click();
  await expect(page).toHaveURL('/');

  await secondAuthenticator.cdp.detach();
});
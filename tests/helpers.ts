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
  const registered = page.waitForResponse((response) =>
    response.request().method() === 'POST' && response.url().endsWith('/api/auth/register-verify'));
  await page.getByRole('button', { name: 'Create with passkey' }).click();
  expect((await registered).status()).toBe(200);
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { name: `Welcome, ${username}.` })).toBeVisible();
}

export async function createTodo(page: Page, title: string): Promise<void> {
  await page.getByLabel('Todo title', { exact: true }).fill(title);
  const saved = page.waitForResponse((response) =>
    response.request().method() === 'POST' && response.url().endsWith('/api/todos'));
  await page.getByRole('button', { name: 'Add todo', exact: true }).click();
  expect((await saved).status()).toBe(201);
  await expect(page.getByTestId('todo-row').filter({ hasText: title })).toBeVisible();
}

export async function addSubtask(
  page: Page,
  todoTitle: string,
  title: string,
  submit: 'enter' | 'button' = 'button',
): Promise<void> {
  const row = page.getByTestId('todo-row').filter({ hasText: todoTitle });
  const toggle = row.getByRole('button', { name: 'Subtasks' });
  if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
  const input = row.getByRole('textbox', { name: `New subtask for ${todoTitle}` });
  await expect(input).toBeEnabled();
  await input.fill(title);
  const saved = page.waitForResponse((response) =>
    response.request().method() === 'POST' && /\/api\/todos\/\d+\/subtasks$/.test(response.url()));
  if (submit === 'enter') await input.press('Enter');
  else await row.getByRole('button', { name: 'Add', exact: true }).click();
  expect((await saved).status()).toBe(201);
  await expect(input).toHaveValue('');
}
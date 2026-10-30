import { expect, test } from '@playwright/test';
import { addVirtualAuthenticator, registerUser } from '../helpers';

function singaporeInputAfterMinutes(minutesFromNow: number): string {
  const date = new Date(Date.now() + minutesFromNow * 60_000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

test('offers all reminder offsets and renders their abbreviations', async ({ page }) => {
  await addVirtualAuthenticator(page);
  await registerUser(page, `reminder-options-${Date.now()}`);
  await page.setViewportSize({ width: 800, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const reminder = page.locator('#create-reminder');
  await expect(reminder).toBeDisabled();
  await expect(reminder.locator('option')).toHaveCount(8);

  const options = [
    ['15', '15m'],
    ['30', '30m'],
    ['60', '1h'],
    ['120', '2h'],
    ['1440', '1d'],
    ['2880', '2d'],
    ['10080', '1w'],
  ];

  for (const [minutes, label] of options) {
    const title = `Reminder ${label}`;
    await page.getByLabel('Todo title').fill(title);
    await page.getByLabel('Due date and time').fill(singaporeInputAfterMinutes(30));
    await expect(reminder).toBeEnabled();
    await reminder.selectOption(minutes);
    await page.getByRole('button', { name: 'Add todo' }).click();

    const todoRow = page.getByTestId('todo-row').filter({ hasText: title });
    await expect(todoRow.locator('.reminder-badge')).toHaveText(label);
  }
});

test('checks due reminders and re-arms when the due date changes', async ({ page }) => {
  await addVirtualAuthenticator(page);
  await registerUser(page, `reminder-api-${Date.now()}`);

  const title = 'API reminder task';
  await page.getByLabel('Todo title').fill(title);
  await page.getByLabel('Due date and time').fill(singaporeInputAfterMinutes(10));
  await page.getByLabel('Reminder').selectOption('10080');
  const createResponsePromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' && response.url().endsWith('/api/todos'),
  );
  await page.getByRole('button', { name: 'Add todo' }).click();
  const created = await (await createResponsePromise).json() as { id: number; due_date: string };
  await expect(page.getByTestId('todo-row').filter({ hasText: title })).toBeVisible();

  const initialCheck = await page.request.get('/api/notifications/check');
  expect(initialCheck.status()).toBe(200);
  expect((await initialCheck.json()).data.map((todo: { id: number }) => todo.id)).toContain(created.id);

  const stamped = await page.evaluate(async ({ id, timestamp, dueDate }) => {
    const response = await fetch(`/api/todos/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        last_notification_sent: timestamp,
        expected_due_date: dueDate,
        expected_reminder_minutes: 10080,
      }),
    });
    return { status: response.status, todo: await response.json() };
  }, { id: created.id, timestamp: new Date().toISOString(), dueDate: created.due_date });
  expect(stamped.status).toBe(200);
  expect(stamped.todo.last_notification_sent).not.toBeNull();

  const afterStamp = await page.request.get('/api/notifications/check');
  expect((await afterStamp.json()).data.map((todo: { id: number }) => todo.id)).not.toContain(created.id);

  const nextDueDate = singaporeInputAfterMinutes(20);
  const updated = await page.evaluate(async ({ id, dueDate }) => {
    const response = await fetch(`/api/todos/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ due_date: dueDate }),
    });
    return { status: response.status, todo: await response.json() };
  }, { id: created.id, dueDate: nextDueDate });
  expect(updated.status).toBe(200);
  expect(updated.todo.last_notification_sent).toBeNull();

  const afterEdit = await page.request.get('/api/notifications/check');
  expect((await afterEdit.json()).data.map((todo: { id: number }) => todo.id)).toContain(created.id);
});

test('requests notification permission only after the user opts in', async ({ page }) => {
  await page.addInitScript(() => {
    let permission: NotificationPermission = 'default';
    Object.defineProperty(Notification, 'permission', {
      configurable: true,
      get: () => permission,
    });
    Object.defineProperty(Notification, 'requestPermission', {
      configurable: true,
      value: async () => {
        permission = 'granted';
        return permission;
      },
    });
  });
  await addVirtualAuthenticator(page);
  await registerUser(page, `notification-permission-${Date.now()}`);

  const enableButton = page.getByRole('button', { name: 'Enable Notifications' });
  await expect(enableButton).toBeEnabled();
  await enableButton.click();
  const enabledButton = page.getByRole('button', { name: 'Notifications On' });
  await expect(enabledButton).toBeVisible();
  await expect(enabledButton).toBeDisabled();
});
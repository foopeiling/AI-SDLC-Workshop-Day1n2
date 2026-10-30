import { expect, test, type Page } from '@playwright/test';
import { addVirtualAuthenticator, registerUser } from '../helpers';

type TodoPayload = {
  id: number;
  title: string;
  completed: boolean;
  due_date: string | null;
  is_recurring: boolean;
  recurrence_pattern: string | null;
  reminder_minutes: number | null;
  tags: Array<{ id: number; name: string }>;
  next_instance?: TodoPayload;
};

async function createRecurring(
  page: Page,
  title: string,
  dueDate: string,
  pattern: 'daily' | 'weekly' | 'monthly' | 'yearly',
  reminder?: string,
): Promise<TodoPayload> {
  await page.getByLabel('Todo title').fill(title);
  await page.getByLabel('Due date and time').fill(dueDate);
  if (reminder) await page.getByLabel('Reminder').selectOption(reminder);
  await page.getByLabel('Repeat', { exact: true }).check();
  await page.getByRole('combobox', { name: 'Repeat pattern', exact: true }).selectOption(pattern);

  const created = page.waitForResponse((response) =>
    response.request().method() === 'POST' && response.url().endsWith('/api/todos'),
  );
  await page.getByRole('button', { name: 'Add todo' }).click();
  const todo = await (await created).json() as TodoPayload;
  await expect(page.getByTestId('todo-row').filter({ hasText: title })).toBeVisible();
  return todo;
}

async function complete(page: Page, title: string): Promise<TodoPayload> {
  const updated = page.waitForResponse((response) =>
    response.request().method() === 'PUT' && /\/api\/todos\/\d+$/.test(response.url()),
  );
  await page.getByRole('checkbox', { name: `Mark "${title}" as complete` }).first().click();
  return await (await updated).json() as TodoPayload;
}

test('shows the recurrence badge for a daily recurring todo', async ({ page }) => {
  await addVirtualAuthenticator(page);
  await registerUser(page, `rec-badge-${Date.now()}`);

  await createRecurring(page, 'Daily habit', '2099-03-10T09:00', 'daily');

  const row = page.getByTestId('todo-row').filter({ hasText: 'Daily habit' });
  await expect(row.getByTestId('recurrence-badge')).toHaveText(/daily/i);
});

test('completing a weekly todo adds the next instance seven days later', async ({ page }) => {
  await addVirtualAuthenticator(page);
  await registerUser(page, `rec-weekly-${Date.now()}`);
  await createRecurring(page, 'Weekly report', '2099-03-10T09:00', 'weekly');

  const result = await complete(page, 'Weekly report');

  expect(result.completed).toBe(true);
  expect(result.next_instance).toMatchObject({
    title: 'Weekly report',
    completed: false,
    recurrence_pattern: 'weekly',
    due_date: '2099-03-17T09:00:00+08:00',
  });
  await expect(page.getByRole('heading', { name: 'Pending (1)' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Completed (1)' })).toBeVisible();
  await expect(page.getByTestId('todo-row').filter({ hasText: 'Weekly report' })).toHaveCount(2);
});

test('clamps a monthly Jan 31 todo to Feb 28 in a non-leap year', async ({ page }) => {
  await addVirtualAuthenticator(page);
  await registerUser(page, `rec-month-${Date.now()}`);
  await createRecurring(page, 'Pay rent', '2099-01-31T09:00', 'monthly');

  expect((await complete(page, 'Pay rent')).next_instance?.due_date).toBe('2099-02-28T09:00:00+08:00');
});

test('clamps a yearly Feb 29 todo to Feb 28 the following year', async ({ page }) => {
  await addVirtualAuthenticator(page);
  await registerUser(page, `rec-year-${Date.now()}`);
  await createRecurring(page, 'Leap review', '2096-02-29T09:00', 'yearly');

  expect((await complete(page, 'Leap review')).next_instance?.due_date).toBe('2097-02-28T09:00:00+08:00');
});

test('the next instance keeps the reminder', async ({ page }) => {
  await addVirtualAuthenticator(page);
  await registerUser(page, `rec-inherit-${Date.now()}`);
  await createRecurring(page, 'Inherit settings', '2099-03-10T09:00', 'weekly', '60');

  const result = await complete(page, 'Inherit settings');

  expect(result.next_instance?.reminder_minutes).toBe(60);
  const rows = page.getByTestId('todo-row').filter({ hasText: 'Inherit settings' });
  await expect(rows).toHaveCount(2);
  await expect(rows.locator('.reminder-badge')).toHaveText(['1h', '1h']);
});

test('blocks a recurring todo without a due date', async ({ page }) => {
  await addVirtualAuthenticator(page);
  await registerUser(page, `rec-nodue-${Date.now()}`);

  await expect(page.getByLabel('Repeat', { exact: true })).toBeDisabled();
  await expect(page.getByText('Set a due date to enable repeat').first()).toBeVisible();

  const response = await page.evaluate(async () => {
    const result = await fetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'No anchor', is_recurring: true, recurrence_pattern: 'daily' }),
    });
    return { status: result.status, body: await result.json() };
  });
  expect(response.status).toBe(400);
  expect(response.body.error).toBe('Recurring todos require a due date');
});

test('unchecking Repeat removes the badge and stops spawning new instances', async ({ page }) => {
  await addVirtualAuthenticator(page);
  await registerUser(page, `rec-stop-${Date.now()}`);
  await createRecurring(page, 'Stop me', '2099-03-10T09:00', 'daily');

  const row = page.getByTestId('todo-row').filter({ hasText: 'Stop me' });
  await row.getByRole('button', { name: 'Edit Stop me' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit todo' });
  await dialog.getByLabel('Repeat', { exact: true }).uncheck();
  await dialog.getByRole('button', { name: 'Save changes' }).click();

  await expect(page.getByRole('dialog', { name: 'Edit todo' })).toHaveCount(0);
  await expect(page.getByTestId('recurrence-badge')).toHaveCount(0);

  const result = await complete(page, 'Stop me');
  expect(result.next_instance).toBeUndefined();
  await expect(page.getByTestId('todo-row').filter({ hasText: 'Stop me' })).toHaveCount(1);
});

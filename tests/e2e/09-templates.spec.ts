import { expect, test } from '@playwright/test';
import { addVirtualAuthenticator, registerUser } from '../helpers';

function singaporeDateTimeLocal(date: Date): string {
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

test('saves a template, uses it from quick and manager paths, then deletes only the template', async ({ page }) => {
  await addVirtualAuthenticator(page);
  const username = `templates-${Date.now()}`;
  await registerUser(page, username);

  await page.getByRole('button', { name: 'Manage tags' }).click();
  await page.getByLabel('Tag name').fill('Work');
  await page.getByRole('button', { name: 'Create tag' }).click();
  await page.getByRole('button', { name: 'Close manage tags' }).click();

  const originalDueDate = singaporeDateTimeLocal(new Date(Date.now() + 90 * 60_000));
  await page.getByLabel('Todo title').fill('Client onboarding');
  await page.locator('.todo-create-form').getByLabel('Priority').selectOption('high');
  await page.getByLabel('Due date and time').fill(originalDueDate);
  await page.getByLabel('Reminder').selectOption('15');
  await page.getByLabel('Repeat').check();
  await page.getByLabel('Repeat pattern').selectOption('weekly');
  await page.getByRole('button', { name: 'Select tag Work' }).click();

  await page.getByLabel('New checklist item').fill('Gather requirements');
  await page.getByRole('button', { name: 'Add checklist item' }).click();
  await page.getByLabel('New checklist item').fill('Create project');
  await page.getByRole('button', { name: 'Add checklist item' }).click();

  await page.getByRole('button', { name: 'Save as template' }).click();
  const saveDialog = page.getByRole('dialog', { name: 'Save as template' });
  await saveDialog.getByLabel('Template name').fill('Client kickoff');
  await saveDialog.getByLabel('Template description').fill('Reusable client setup checklist');
  await saveDialog.getByLabel('Template category').fill('Work');
  await saveDialog.getByLabel('Due date offset in minutes').fill('60');
  await saveDialog.getByRole('button', { name: 'Save template' }).click();
  await expect(page.getByRole('status')).toHaveText('Template saved.');

  const quickUse = page.getByLabel('Use template');
  await expect(quickUse.locator('option')).toContainText(['Client kickoff (Work)']);
  const firstUseStart = Date.now();
  const firstUseResponsePromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' && /\/api\/templates\/\d+\/use$/.test(response.url()),
  );
  await quickUse.selectOption({ label: 'Client kickoff (Work)' });
  const firstUseResponse = await firstUseResponsePromise;
  expect(firstUseResponse.status()).toBe(201);
  const firstCreatedTodo = await firstUseResponse.json();
  expect(Date.parse(firstCreatedTodo.due_date) - firstUseStart).toBeGreaterThanOrEqual(60 * 60_000 - 2_000);
  expect(Date.parse(firstCreatedTodo.due_date) - firstUseStart).toBeLessThan(60 * 60_000 + 10_000);
  expect(firstCreatedTodo.tags).toEqual([]);
  expect(firstCreatedTodo.subtasks.map((subtask: { title: string; completed: boolean }) => ({
    title: subtask.title,
    completed: subtask.completed,
  }))).toEqual([
    { title: 'Gather requirements', completed: false },
    { title: 'Create project', completed: false },
  ]);

  const createdRow = page.getByTestId('todo-row').filter({ hasText: 'Client onboarding' });
  await expect(createdRow).toBeVisible();
  await expect(createdRow.getByText('high')).toBeVisible();
  await expect(createdRow.getByLabel('Repeats weekly')).toBeVisible();
  await expect(createdRow.getByLabel('Reminder 15m before due time')).toBeVisible();
  await expect(createdRow.getByText('0/2 subtasks')).toBeVisible();
  await expect(createdRow.getByRole('button', { name: 'Filter by Work' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Templates' }).click();
  const manager = page.getByRole('dialog', { name: 'Templates' });
  const templateCard = manager.getByTestId('template-card').filter({ hasText: 'Client kickoff' });
  await expect(templateCard.getByRole('button', { name: 'Use template Client kickoff' })).toBeFocused();
  await expect(templateCard).toContainText('Reusable client setup checklist');
  const managerUseResponsePromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' && /\/api\/templates\/\d+\/use$/.test(response.url()),
  );
  await templateCard.getByRole('button', { name: 'Use template Client kickoff' }).click();
  expect((await managerUseResponsePromise).status()).toBe(201);
  await expect(manager).toHaveCount(0);
  await expect(page.getByTestId('todo-row').filter({ hasText: 'Client onboarding' })).toHaveCount(2);

  await page.getByRole('button', { name: 'Templates' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('dialog', { name: 'Templates' })
    .getByRole('button', { name: 'Delete template Client kickoff' }).click();
  await expect(page.getByRole('dialog', { name: 'Templates' }).getByTestId('template-card')).toHaveCount(0);
  await expect(page.getByTestId('todo-row').filter({ hasText: 'Client onboarding' })).toHaveCount(2);
});

test('uses a template without an offset or checklist', async ({ page }) => {
  await addVirtualAuthenticator(page);
  await registerUser(page, `simple-template-${Date.now()}`);

  await page.getByRole('button', { name: 'Templates' }).click();
  const emptyManager = page.getByRole('dialog', { name: 'Templates' });
  await expect(emptyManager.getByRole('heading', { name: 'Templates' })).toBeFocused();
  await expect(emptyManager.getByText('No templates saved.')).toBeVisible();
  await emptyManager.getByRole('button', { name: 'Close templates' }).click();

  await page.getByLabel('Todo title').fill('Read project brief');
  await page.getByRole('button', { name: 'Save as template' }).click();
  const saveDialog = page.getByRole('dialog', { name: 'Save as template' });
  await saveDialog.getByLabel('Template name').fill('Simple task');
  await saveDialog.getByRole('button', { name: 'Save template' }).click();
  await expect(page.getByRole('status')).toHaveText('Template saved.');

  await page.getByLabel('Use template').selectOption({ label: 'Simple task' });
  const todoRow = page.getByTestId('todo-row').filter({ hasText: 'Read project brief' });
  await expect(todoRow).toBeVisible();
  await expect(todoRow.getByText('0/0 subtasks')).toHaveCount(0);
  await expect(todoRow.getByText(/\d{1,2}:\d{2}/)).toHaveCount(0);
});

test('keeps the todo workspace available when templates cannot be loaded', async ({ page }) => {
  await page.route('**/api/templates', (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'Templates unavailable.' }),
  }));
  await addVirtualAuthenticator(page);
  await registerUser(page, `template-outage-${Date.now()}`);

  await expect(page.getByLabel('Todo title')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add todo' })).toBeVisible();
});
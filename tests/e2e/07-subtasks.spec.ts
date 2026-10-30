import { expect, test } from '@playwright/test';
import { addSubtask, addVirtualAuthenticator, createTodo, registerUser } from '../helpers';

test('tracks ordered subtasks, persists progress, and cascades parent deletion', async ({ page }) => {
  await addVirtualAuthenticator(page);
  await registerUser(page, `subtasks-${Date.now()}`);
  const title = 'Prepare presentation';
  await createTodo(page, title);
  const row = page.getByTestId('todo-row').filter({ hasText: title });
  const toggle = row.getByRole('button', { name: 'Subtasks' });
  await expect(row.getByRole('progressbar')).toHaveCount(0);
  await toggle.click();
  const input = row.getByRole('textbox', { name: `New subtask for ${title}` });
  await input.fill('   ');
  await expect(row.getByRole('button', { name: 'Add', exact: true })).toBeDisabled();
  let blankRequests = 0;
  const countRequests = (request: import('@playwright/test').Request) => {
    if (request.method() === 'POST' && request.url().endsWith('/subtasks')) blankRequests++;
  };
  page.on('request', countRequests);
  await input.press('Enter');
  await expect(row.locator('.subtask-row')).toHaveCount(0);
  expect(blankRequests).toBe(0);
  page.off('request', countRequests);

  await addSubtask(page, title, 'Create slides', 'enter');
  await addSubtask(page, title, 'Rehearse speech');
  await expect(row.locator('.subtask-row')).toHaveText(['Create slides', 'Rehearse speech']);
  const progress = row.getByRole('progressbar');
  await expect(progress).toHaveAttribute('aria-valuenow', '0');
  await row.getByRole('checkbox', { name: 'Mark subtask "Create slides" as complete', exact: true }).click();
  await expect(progress).toHaveAttribute('aria-valuenow', '50');
  await expect(row.getByText('1/2 subtasks', { exact: true })).toBeVisible();
  await expect(row.locator('.subtask-progress-fill')).toHaveCSS('background-color', 'rgb(37, 99, 235)');
  await toggle.click();
  await expect(input).toHaveCount(0);
  await expect(progress).toBeVisible();
  await toggle.click();
  await row.getByRole('checkbox', { name: 'Mark subtask "Rehearse speech" as complete', exact: true }).click();
  await expect(progress).toHaveAttribute('aria-valuenow', '100');
  await expect(row.locator('.subtask-progress-fill')).toHaveCSS('background-color', 'rgb(22, 163, 74)');
  await expect(row.getByRole('checkbox', { name: `Mark "${title}" as complete`, exact: true })).not.toBeChecked();
  await expect(row.getByRole('button', { name: `Edit ${title}`, exact: true })).toBeEnabled();

  await page.reload();
  await expect(progress).toHaveAttribute('aria-valuenow', '100');
  await toggle.click();
  await expect(row.getByRole('checkbox', { name: 'Mark subtask "Create slides" as incomplete', exact: true })).toBeChecked();
  await row.getByRole('checkbox', { name: 'Mark subtask "Rehearse speech" as incomplete', exact: true }).click();
  await expect(progress).toHaveAttribute('aria-valuenow', '50');
  await row.getByRole('button', { name: 'Delete subtask Rehearse speech', exact: true }).click();
  await expect(row.getByText('1/1 subtasks', { exact: true })).toBeVisible();
  await expect(progress).toHaveAttribute('aria-valuenow', '100');
  await expect(row.getByRole('button', { name: `Edit ${title}`, exact: true })).toBeEnabled();
  await addSubtask(page, title, 'Pack laptop');

  await row.getByRole('checkbox', { name: `Mark "${title}" as complete`, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Completed (1)' })).toBeVisible();
  await expect(row.getByText('1/2 subtasks', { exact: true })).toBeVisible();
  await expect(row.getByRole('button', { name: `Edit ${title}`, exact: true })).toBeEnabled();
  await toggle.click();
  await expect(row.getByRole('checkbox', { name: 'Mark subtask "Pack laptop" as complete', exact: true })).not.toBeChecked();

  const todos = await (await page.request.get('/api/todos')).json();
  const childId = todos[0].subtasks[0].id;
  const parentId = todos[0].id;
  const deleted = page.waitForResponse((response) =>
    response.request().method() === 'DELETE' && response.url().endsWith(`/api/todos/${parentId}`));
  await row.getByRole('button', { name: `Delete ${title}`, exact: true }).click();
  expect((await deleted).status()).toBe(200);
  await expect(row).toHaveCount(0);
  const orphanUpdate = await page.request.put(`/api/subtasks/${childId}`, {
    headers: { origin: 'http://localhost:3000' }, data: { completed: false },
  });
  expect(orphanUpdate.status()).toBe(404);
  await page.reload();
  await expect(page.getByText('No todos yet.')).toBeVisible();
});

test('hides progress after deleting the last subtask', async ({ page }) => {
  await addVirtualAuthenticator(page);
  await registerUser(page, `subtask-empty-${Date.now()}`);
  await createTodo(page, 'Single step');
  await addSubtask(page, 'Single step', 'Only child');
  const row = page.getByTestId('todo-row').filter({ hasText: 'Single step' });
  await row.getByRole('button', { name: 'Delete subtask Only child', exact: true }).click();
  await expect(row.getByRole('progressbar')).toHaveCount(0);
  await expect(row.getByRole('button', { name: 'Subtasks' })).toBeVisible();
});

test('optimistically updates progress, prevents overlapping mutations, and rolls back errors', async ({ page }) => {
  await addVirtualAuthenticator(page);
  await registerUser(page, `subtask-rollback-${Date.now()}`);
  await createTodo(page, 'Keep checklist');
  await createTodo(page, 'Independent task');
  await addSubtask(page, 'Keep checklist', 'Keep child');
  const row = page.getByTestId('todo-row').filter({ hasText: 'Keep checklist' });
  const other = page.getByTestId('todo-row').filter({ hasText: 'Independent task' });

  let releaseUpdate: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { releaseUpdate = resolve; });
  await page.route('**/api/subtasks/*', async (route) => {
    if (route.request().method() === 'PUT') await gate;
    await route.fulfill({ status: 500, body: JSON.stringify({ error: 'Subtask change failed.' }) });
  });
  const checkbox = row.getByRole('checkbox', { name: /Mark subtask/ });
  await checkbox.click();
  await expect(row.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  await expect(checkbox).toBeDisabled();
  await expect(row.getByRole('button', { name: 'Delete Keep checklist', exact: true })).toBeDisabled();
  await expect(other.getByRole('checkbox')).toBeEnabled();
  releaseUpdate?.();
  await expect(checkbox).toBeEnabled();
  await expect(checkbox).not.toBeChecked();
  await expect(row.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  await expect(page.locator('.todo-error[role="alert"]')).toHaveText('Subtask change failed.');

  await row.getByRole('button', { name: 'Delete subtask Keep child', exact: true }).click();
  await expect(row.getByRole('checkbox', { name: /Mark subtask/ })).toBeEnabled();
  await expect(row.getByText('0/1 subtasks', { exact: true })).toBeVisible();
  await page.route('**/api/todos/*/subtasks', async (route) => {
    await route.fulfill({ status: 500, body: JSON.stringify({ error: 'Subtask create failed.' }) });
  });
  const input = row.getByRole('textbox', { name: 'New subtask for Keep checklist' });
  await input.fill('Retry this title');
  await row.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.locator('.todo-error[role="alert"]')).toHaveText('Subtask create failed.');
  await expect(input).toHaveValue('Retry this title');
  await expect(row.locator('.subtask-row')).toHaveCount(1);
});

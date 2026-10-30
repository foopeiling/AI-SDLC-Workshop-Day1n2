import { expect, test } from '@playwright/test';
import { addVirtualAuthenticator, registerUser } from '../helpers';

test('creates, edits, completes, and deletes a todo', async ({ page }) => {
  await addVirtualAuthenticator(page);
  const username = `crud-${Date.now()}`;
  await registerUser(page, username);

  const originalTitle = 'Prepare workshop notes';
  await page.getByLabel('Todo title').fill(originalTitle);
  await page.getByRole('button', { name: 'Add todo' }).click();
  const todoRow = page.getByTestId('todo-row').filter({ hasText: originalTitle });
  await expect(todoRow).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pending (1)' })).toBeVisible();

  await todoRow.getByRole('button', { name: `Edit ${originalTitle}` }).click();
  const editDialog = page.getByRole('dialog', { name: 'Edit todo' });
  const closeDialogButton = editDialog.getByRole('button', { name: 'Close edit dialog' });
  const saveChangesButton = editDialog.getByRole('button', { name: 'Save changes' });
  await closeDialogButton.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(saveChangesButton).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(closeDialogButton).toBeFocused();
  await editDialog.getByLabel('Edit title').fill('Discard this edit');
  await editDialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(todoRow.getByRole('button', { name: `Edit ${originalTitle}` })).toBeFocused();
  await expect(page.getByTestId('todo-row').filter({ hasText: originalTitle })).toBeVisible();
  await expect(page.getByText('Discard this edit')).toHaveCount(0);

  await page.getByTestId('todo-row').filter({ hasText: originalTitle })
    .getByRole('button', { name: `Edit ${originalTitle}` }).click();
  await page.getByRole('dialog', { name: 'Edit todo' }).getByLabel('Edit title').fill('Discard Escape edit');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Edit todo' })).toHaveCount(0);
  await expect(page.getByTestId('todo-row').filter({ hasText: originalTitle })).toBeVisible();

  await page.getByTestId('todo-row').filter({ hasText: originalTitle })
    .getByRole('button', { name: `Edit ${originalTitle}` }).click();
  await page.getByRole('dialog', { name: 'Edit todo' }).getByLabel('Edit title').fill('Discard outside edit');
  await page.locator('.todo-dialog-backdrop').click({ position: { x: 2, y: 2 } });
  await expect(page.getByRole('dialog', { name: 'Edit todo' })).toHaveCount(0);
  await expect(page.getByTestId('todo-row').filter({ hasText: originalTitle })).toBeVisible();

  await page.getByTestId('todo-row').filter({ hasText: originalTitle })
    .getByRole('button', { name: `Edit ${originalTitle}` }).click();
  await page.getByRole('dialog', { name: 'Edit todo' }).getByLabel('Edit title').fill('Prepare release notes');
  await page.getByRole('dialog', { name: 'Edit todo' }).getByLabel('Edit priority').selectOption('high');
  await page.getByRole('dialog', { name: 'Edit todo' }).getByLabel('Edit due date and time').fill('2099-12-31T12:00');
  await page.getByRole('dialog', { name: 'Edit todo' }).getByRole('button', { name: 'Save changes' }).click();

  const editedRow = page.getByTestId('todo-row').filter({ hasText: 'Prepare release notes' });
  await expect(editedRow).toBeVisible();
  await expect(editedRow.getByRole('button', { name: 'Edit Prepare release notes' })).toBeFocused();
  await editedRow.getByRole('checkbox', { name: 'Mark "Prepare release notes" as complete' }).click();
  await expect(page.getByRole('heading', { name: 'Completed (1)' })).toBeVisible();
  await page.getByTestId('todo-row').filter({ hasText: 'Prepare release notes' })
    .getByRole('checkbox', { name: 'Mark "Prepare release notes" as incomplete' }).click();
  await expect(page.getByRole('heading', { name: 'Pending (1)' })).toBeVisible();

  const deleteResponsePromise = page.waitForResponse((response) =>
    response.request().method() === 'DELETE' && response.url().includes('/api/todos/'),
  );
  await editedRow.getByRole('button', { name: 'Delete Prepare release notes' }).click();
  const deleteResponse = await deleteResponsePromise;
  expect(deleteResponse.status()).toBe(200);
  await expect(page.getByTestId('todo-row')).toHaveCount(0);
  const listResponsePromise = page.waitForResponse((response) =>
    response.request().method() === 'GET' && response.url().endsWith('/api/todos'),
  );
  await page.reload();
  const listResponse = await listResponsePromise;
  expect(await listResponse.json()).toEqual([]);
  await expect(page.getByText('No todos yet.')).toBeVisible();
});

test('shows overdue and pending todos separately and refuses a blank title', async ({ page }) => {
  await addVirtualAuthenticator(page);
  const username = `sections-${Date.now()}`;
  await registerUser(page, username);

  const addButton = page.getByRole('button', { name: 'Add todo' });
  await expect(addButton).toBeDisabled();
  await page.getByLabel('Todo title').fill('Past due');
  await page.getByLabel('Due date and time').fill('2020-01-01T10:00');
  await addButton.click();
  await expect(page.getByText('Due date must be at least 1 minute in the future.')).toBeVisible();
  await expect(page.getByTestId('todo-row')).toHaveCount(0);

  await page.getByLabel('Due date and time').fill('');
  await addButton.click();
  await expect(page.getByTestId('todo-row')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Pending (1)' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Overdue (1)' })).toHaveCount(0);
});

test('prevents overlapping row mutations and rolls back a failed completion', async ({ page }) => {
  await addVirtualAuthenticator(page);
  const username = `rollback-${Date.now()}`;
  await registerUser(page, username);
  await page.getByLabel('Todo title').fill('Keep this task pending');
  await page.getByRole('button', { name: 'Add todo' }).click();
  await page.getByLabel('Todo title').fill('Independent task');
  await page.getByRole('button', { name: 'Add todo' }).click();

  const todoRow = page.getByTestId('todo-row').filter({ hasText: 'Keep this task pending' });
  const independentRow = page.getByTestId('todo-row').filter({ hasText: 'Independent task' });
  await expect(todoRow).toBeVisible();
  await expect(independentRow).toBeVisible();
  let releaseUpdate: (() => void) | undefined;
  const updateGate = new Promise<void>((resolve) => { releaseUpdate = resolve; });
  await page.route('**/api/todos/*', async (route) => {
    if (route.request().method() === 'PUT') {
      await updateGate;
      await route.fulfill({ status: 500, body: JSON.stringify({ error: 'Update failed.' }) });
      return;
    }
    await route.continue();
  });

  const checkbox = todoRow.getByRole('checkbox');
  await checkbox.click();
  await expect(checkbox).toBeDisabled();
  await expect(independentRow.getByRole('checkbox')).toBeEnabled();
  releaseUpdate?.();
  await expect(checkbox).toBeEnabled();
  await expect(checkbox).not.toBeChecked();
  await expect(page.getByRole('heading', { name: 'Pending (2)' })).toBeVisible();
  await expect(page.getByText('Update failed.')).toBeVisible();
});

test('rolls back failed edits and deletes', async ({ page }) => {
  await addVirtualAuthenticator(page);
  const username = `rollback-fields-${Date.now()}`;
  await registerUser(page, username);
  await page.getByLabel('Todo title').fill('Server-owned task');
  await page.getByRole('button', { name: 'Add todo' }).click();

  await page.route('**/api/todos/*', async (route) => {
    if (route.request().method() === 'PUT') {
      await route.fulfill({ status: 500, body: JSON.stringify({ error: 'Edit failed.' }) });
      return;
    }
    if (route.request().method() === 'DELETE') {
      await route.fulfill({ status: 500, body: JSON.stringify({ error: 'Delete failed.' }) });
      return;
    }
    await route.continue();
  });

  let todoRow = page.getByTestId('todo-row').filter({ hasText: 'Server-owned task' });
  await todoRow.getByRole('button', { name: 'Edit Server-owned task' }).click();
  await page.getByRole('dialog', { name: 'Edit todo' }).getByLabel('Edit title').fill('Optimistic title');
  await page.getByRole('dialog', { name: 'Edit todo' }).getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Edit failed.')).toBeVisible();
  todoRow = page.getByTestId('todo-row').filter({ hasText: 'Server-owned task' });
  await expect(todoRow).toBeVisible();
  await expect(page.getByTestId('todo-row').filter({ hasText: 'Optimistic title' })).toHaveCount(0);

  await todoRow.getByRole('button', { name: 'Delete Server-owned task' }).click();
  await expect(page.getByText('Delete failed.')).toBeVisible();
  await expect(page.getByTestId('todo-row').filter({ hasText: 'Server-owned task' })).toBeVisible();
});
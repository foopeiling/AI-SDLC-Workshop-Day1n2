import { expect, test } from '@playwright/test';
import { addVirtualAuthenticator, registerUser } from '../helpers';

test('manages tags, applies multiple tags, filters todos, and resets after deletion', async ({ page }) => {
  await addVirtualAuthenticator(page);
  await registerUser(page, `tags-${Date.now()}`);

  await page.getByRole('button', { name: 'Manage tags', exact: true }).click();
  const tagDialog = page.getByRole('dialog', { name: 'Manage tags' });
  await tagDialog.getByLabel('Tag name').fill('Work');
  await tagDialog.getByRole('button', { name: 'Create tag' }).click();
  await tagDialog.getByLabel('Tag name').fill('Urgent');
  await tagDialog.getByRole('button', { name: 'Create tag' }).click();
  await expect(tagDialog.getByText('Work')).toBeVisible();
  await expect(tagDialog.getByText('Urgent')).toBeVisible();
  await tagDialog.getByRole('button', { name: 'Close manage tags' }).click();

  await page.getByLabel('Todo title').fill('Prepare release');
  await page.getByRole('button', { name: 'Select tag Work' }).click();
  await page.getByRole('button', { name: 'Select tag Urgent' }).click();
  await page.getByRole('button', { name: 'Add todo' }).click();
  const taggedTodo = page.getByTestId('todo-row').filter({ hasText: 'Prepare release' });
  await expect(taggedTodo.getByText('Work')).toBeVisible();
  await expect(taggedTodo.getByText('Urgent')).toBeVisible();

  await taggedTodo.getByRole('button', { name: 'Edit Prepare release' }).click();
  const editDialog = page.getByRole('dialog', { name: 'Edit todo' });
  await editDialog.getByRole('button', { name: 'Deselect tag Urgent' }).click();
  await editDialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(taggedTodo.getByText('Urgent')).toHaveCount(0);

  await page.getByLabel('Todo title').fill('Unrelated task');
  await page.getByRole('button', { name: 'Add todo' }).click();
  await page.getByRole('button', { name: 'Filter by Work' }).click();
  await expect(page.getByTestId('todo-row')).toHaveCount(1);
  await expect(page.getByTestId('todo-row').filter({ hasText: 'Prepare release' })).toBeVisible();
  await page.getByLabel('Filter by tag').selectOption('');
  await expect(page.getByTestId('todo-row')).toHaveCount(2);

  await page.getByRole('button', { name: 'Manage tags', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Work' }).click();
  await page.getByLabel('Edit tag name').fill('Projects');
  await page.getByLabel('Edit tag color', { exact: true }).fill('#112233');
  await page.getByRole('button', { name: 'Save tag' }).click();
  await expect(page.getByTestId('todo-row').filter({ hasText: 'Prepare release' }).getByText('Projects'))
    .toBeVisible();
  await page.getByRole('button', { name: 'Close manage tags' }).click();

  await page.getByLabel('Filter by tag').selectOption({ label: 'Projects' });
  await expect(page.getByTestId('todo-row')).toHaveCount(1);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Manage tags', exact: true }).click();
  await page.getByRole('button', { name: 'Delete Projects' }).click();
  await expect(page.getByLabel('Filter by tag')).toHaveValue('');
  await expect(page.getByTestId('todo-row')).toHaveCount(2);
  await expect(page.getByTestId('todo-row').filter({ hasText: 'Prepare release' }).getByText('Projects'))
    .toHaveCount(0);
});
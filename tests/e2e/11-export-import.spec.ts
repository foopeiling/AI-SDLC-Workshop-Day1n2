import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { addVirtualAuthenticator, registerUser } from '../helpers';

test('exports and restores todos with subtasks and tags', async ({ page }) => {
  await addVirtualAuthenticator(page);
  await registerUser(page, `export-${Date.now()}`);

  await page.getByRole('button', { name: 'Manage tags' }).click();
  const tagDialog = page.getByRole('dialog', { name: 'Manage tags' });
  await tagDialog.getByLabel('Tag name').fill('Work');
  await tagDialog.getByRole('button', { name: 'Create tag' }).click();
  await tagDialog.getByRole('button', { name: 'Close manage tags' }).click();

  const title = 'Prepare export, with "quotes"';
  await page.getByLabel('Todo title').fill(title);
  await page.getByRole('button', { name: 'Select tag Work' }).click();
  await page.getByRole('button', { name: 'Add todo' }).click();
  const todoRow = page.getByTestId('todo-row').filter({ hasText: title });
  await expect(todoRow).toBeVisible();
  await todoRow.getByRole('button', { name: /Subtasks/ }).click();
  await todoRow.getByLabel(`New subtask for ${title}`).fill('Attach supporting notes');
  await todoRow.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(todoRow.getByText('Attach supporting notes')).toBeVisible();

  const jsonDownloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Export JSON' }).click();
  const jsonDownload = await jsonDownloadPromise;
  expect(jsonDownload.suggestedFilename()).toMatch(/^todos-\d{4}-\d{2}-\d{2}\.json$/);
  const jsonPath = await jsonDownload.path();
  if (!jsonPath) throw new Error('JSON export was not saved');
  const exportedText = await readFile(jsonPath, 'utf8');
  const exported = JSON.parse(exportedText) as {
    version: number;
    todos: Array<{ title: string; tags: Array<{ name: string }>; subtasks: Array<{ title: string }> }>;
  };
  expect(exported.version).toBe(1);
  expect(exported.todos[0]).toMatchObject({
    title,
    tags: [{ name: 'Work' }],
    subtasks: [{ title: 'Attach supporting notes' }],
  });
  expect(exported.todos[0]).not.toHaveProperty('id');

  const csvDownloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Export CSV' }).click();
  const csvDownload = await csvDownloadPromise;
  expect(csvDownload.suggestedFilename()).toMatch(/^todos-\d{4}-\d{2}-\d{2}\.csv$/);

  await todoRow.getByRole('button', { name: `Delete ${title}` }).click();
  await expect(page.getByTestId('todo-row')).toHaveCount(0);

  const importInput = page.getByLabel('Choose JSON file to import');
  await importInput.setInputFiles({
    name: jsonDownload.suggestedFilename(),
    mimeType: 'application/json',
    buffer: Buffer.from(exportedText),
  });
  await expect(page.getByTestId('import-status')).toHaveText('Successfully imported 1 todos');

  const restoredRow = page.getByTestId('todo-row').filter({ hasText: title });
  await expect(restoredRow.getByText('Work')).toBeVisible();
  await restoredRow.getByRole('button', { name: /Subtasks/ }).click();
  await expect(restoredRow.getByText('Attach supporting notes')).toBeVisible();

  await importInput.setInputFiles({
    name: jsonDownload.suggestedFilename(),
    mimeType: 'application/json',
    buffer: Buffer.from(exportedText),
  });
  await expect(page.getByTestId('import-status')).toHaveText('Successfully imported 1 todos');
  await expect(page.getByTestId('todo-row').filter({ hasText: title })).toHaveCount(2);

  await importInput.setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{invalid json'),
  });
  await expect(page.getByRole('alert')).toHaveText('Invalid JSON format');

  await importInput.setInputFiles({
    name: 'wrong-format.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ version: 1, todos: [] })),
  });
  await expect(page.getByRole('alert')).toHaveText('Failed to import todos. Please check the file format.');

  await page.route('**/api/todos', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 503, body: JSON.stringify({ error: 'Unavailable' }) });
      return;
    }
    await route.continue();
  });
  await importInput.setInputFiles({
    name: jsonDownload.suggestedFilename(),
    mimeType: 'application/json',
    buffer: Buffer.from(exportedText),
  });
  await expect(page.getByTestId('import-status'))
    .toHaveText('Successfully imported 1 todos. Reload the page to refresh the list.');
});
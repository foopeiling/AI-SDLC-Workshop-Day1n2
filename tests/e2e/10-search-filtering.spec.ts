import { expect, test } from '@playwright/test';
import { addSubtask, addVirtualAuthenticator, registerUser } from '../helpers';

function singaporeDateOffset(days: number): { input: string; date: string } {
  const date = new Date(Date.now() + days * 86_400_000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const dateValue = `${values.year}-${values.month}-${values.day}`;
  return { input: `${dateValue}T12:00`, date: dateValue };
}

async function createTag(page: import('@playwright/test').Page, name: string) {
  await page.getByRole('button', { name: 'Manage tags' }).click();
  const dialog = page.getByRole('dialog', { name: 'Manage tags' });
  await dialog.getByLabel('Tag name').fill(name);
  await dialog.getByRole('button', { name: 'Create tag' }).click();
  await expect(dialog.getByText(name)).toBeVisible();
  await dialog.getByRole('button', { name: 'Close manage tags' }).click();
}

test('debounces case-insensitive title and subtask search and clears immediately', async ({ page }) => {
  await addVirtualAuthenticator(page);
  await registerUser(page, `filter-search-${Date.now()}`);
  expect(await page.evaluate(() => document.activeElement?.id === 'todo-search')).toBe(false);

  await page.getByLabel('Todo title', { exact: true }).fill('Team planning');
  await page.getByRole('button', { name: 'Add todo', exact: true }).click();
  await addSubtask(page, 'Team planning', 'Review launch checklist');
  await page.getByLabel('Todo title', { exact: true }).fill('Buy groceries');
  await page.getByRole('button', { name: 'Add todo', exact: true }).click();

  const search = page.getByRole('searchbox', { name: 'Search todos and subtasks' });
  await expect(page.getByTestId('todo-row')).toHaveCount(2);
  await search.fill('CHECKLIST');
  await page.waitForTimeout(150);
  expect(await page.getByTestId('todo-row').count()).toBe(2);
  await page.waitForTimeout(200);
  await expect(page.getByTestId('todo-row')).toHaveCount(1);
  await expect(page.getByTestId('todo-row').filter({ hasText: 'Team planning' })).toBeVisible();

  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(page.getByTestId('todo-row')).toHaveCount(2);
  await search.fill('no matching task');
  await page.waitForTimeout(350);
  await expect(page.getByText('No todos match your filters.')).toBeVisible();
});

test('combines filters with AND and saves, reapplies, and deletes a preset', async ({ page }) => {
  await addVirtualAuthenticator(page);
  await registerUser(page, `filter-preset-${Date.now()}`);
  await createTag(page, 'Work');
  await createTag(page, 'Personal');

  const firstDue = singaporeDateOffset(3);
  await page.getByLabel('Todo title', { exact: true }).fill('Quarterly planning');
  await page.locator('.todo-create-form select').first().selectOption('high');
  await page.getByLabel('Due date and time').fill(firstDue.input);
  await page.getByRole('button', { name: 'Select tag Work' }).click();
  await page.getByRole('button', { name: 'Add todo', exact: true }).click();
  await addSubtask(page, 'Quarterly planning', 'Review launch checklist');

  const secondDue = singaporeDateOffset(6);
  await page.getByLabel('Todo title', { exact: true }).fill('Buy supplies');
  await page.locator('.todo-create-form select').first().selectOption('low');
  await page.getByLabel('Due date and time').fill(secondDue.input);
  await page.getByRole('button', { name: 'Select tag Personal' }).click();
  await page.getByRole('button', { name: 'Add todo', exact: true }).click();
  await page.getByTestId('todo-row').filter({ hasText: 'Buy supplies' })
    .getByRole('checkbox', { name: 'Mark "Buy supplies" as complete' }).click();

  const search = page.getByRole('searchbox', { name: 'Search todos and subtasks' });
  await search.fill('checklist');
  await expect(page.getByTestId('todo-row')).toHaveCount(1, { timeout: 2000 });
  await page.getByLabel('Filter by priority').selectOption('high');
  await page.getByLabel('Filter by tag').selectOption({ label: 'Work' });
  await page.getByRole('button', { name: '▶ Advanced' }).click();
  await page.getByLabel('Completion status').selectOption('incomplete');
  await page.getByLabel('Due date from').fill(firstDue.date);
  await page.getByLabel('Due date to').fill(firstDue.date);

  await expect(page.getByTestId('todo-row')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Clear All' })).toBeVisible();
  const saveFilterButton = page.getByRole('button', { name: 'Save Filter' });
  await saveFilterButton.click();
  const saveDialog = page.getByRole('dialog', { name: 'Save filter' });
  const closeSaveDialog = saveDialog.getByRole('button', { name: 'Close save filter dialog' });
  const savePresetButton = saveDialog.getByRole('button', { name: 'Save preset' });
  await saveDialog.getByLabel('Preset name').fill('Keyboard test');
  await closeSaveDialog.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(savePresetButton).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(closeSaveDialog).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(saveDialog).toHaveCount(0);
  await expect(saveFilterButton).toBeFocused();

  await saveFilterButton.click();
  const reopenedSaveDialog = page.getByRole('dialog', { name: 'Save filter' });
  await expect(reopenedSaveDialog.getByTestId('filter-preview')).toContainText('Search: "checklist"');
  await expect(reopenedSaveDialog.getByTestId('filter-preview')).toContainText('Completion: Incomplete');
  await reopenedSaveDialog.getByLabel('Preset name').fill('Launch review');
  await reopenedSaveDialog.getByRole('button', { name: 'Save preset' }).click();
  await expect(page.getByRole('button', { name: 'Launch review', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Clear All' }).click();
  await expect(page.getByTestId('todo-row')).toHaveCount(2);
  await page.reload();
  await page.getByRole('button', { name: '▶ Advanced' }).click();
  await search.fill('supplies');
  await page.waitForTimeout(350);
  await expect(page.getByTestId('todo-row').filter({ hasText: 'Buy supplies' })).toBeVisible();
  const presetButton = page.getByRole('button', { name: 'Launch review', exact: true });
  await expect(presetButton).toBeVisible();
  await presetButton.click();
  expect(await page.getByTestId('todo-row').filter({ hasText: 'Quarterly planning' }).count()).toBe(1);
  await expect(page.getByTestId('todo-row')).toHaveCount(1);
  await expect(page.getByTestId('todo-row').filter({ hasText: 'Quarterly planning' })).toBeVisible();
  await page.getByLabel('Filter by priority').selectOption('all');
  await page.getByLabel('Filter by tag').selectOption('');
  await page.getByLabel('Completion status').selectOption('all');
  await page.getByLabel('Due date from').fill('');
  await page.getByLabel('Due date to').fill('');
  await search.fill('buy');
  await page.waitForTimeout(100);
  expect(await page.getByTestId('todo-row').filter({ hasText: 'Quarterly planning' }).count()).toBe(1);
  await page.waitForTimeout(250);
  await expect(page.getByTestId('todo-row').filter({ hasText: 'Buy supplies' })).toBeVisible();

  await page.getByRole('button', { name: 'Manage tags' }).click();
  const tagDialog = page.getByRole('dialog', { name: 'Manage tags' });
  page.once('dialog', (dialog) => dialog.accept());
  await tagDialog.getByRole('button', { name: 'Delete Work' }).click();
  await expect(tagDialog.getByRole('button', { name: 'Delete Work' })).toHaveCount(0);
  await tagDialog.getByRole('button', { name: 'Close manage tags' }).click();
  await presetButton.click();
  await expect(page.getByTestId('todo-row')).toHaveCount(1);

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete preset Launch review' }).click();
  await expect(page.getByRole('button', { name: 'Launch review', exact: true })).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: '▶ Advanced' }).click();
  await expect(page.getByRole('button', { name: 'Launch review', exact: true })).toHaveCount(0);
});

test('resets a deleted tag filter when returning from another tab', async ({ page }) => {
  await addVirtualAuthenticator(page);
  await registerUser(page, `filter-cross-tab-${Date.now()}`);
  await createTag(page, 'Shared');

  await page.getByLabel('Todo title', { exact: true }).fill('Cross tab task');
  await page.getByRole('button', { name: 'Select tag Shared' }).click();
  await page.getByRole('button', { name: 'Add todo', exact: true }).click();
  await page.getByLabel('Filter by tag').selectOption({ label: 'Shared' });
  await page.getByRole('button', { name: '▶ Advanced' }).click();
  await page.getByRole('button', { name: 'Save Filter' }).click();
  const saveDialog = page.getByRole('dialog', { name: 'Save filter' });
  await saveDialog.getByLabel('Preset name').fill('Shared tag');
  await saveDialog.getByRole('button', { name: 'Save preset' }).click();
  await page.getByRole('button', { name: 'Save Filter' }).click();
  const secondSaveDialog = page.getByRole('dialog', { name: 'Save filter' });

  const otherTab = await page.context().newPage();
  await otherTab.bringToFront();
  await otherTab.goto('/');
  await otherTab.getByRole('button', { name: 'Manage tags' }).click();
  const tagDialog = otherTab.getByRole('dialog', { name: 'Manage tags' });
  otherTab.once('dialog', (dialog) => dialog.accept());
  await tagDialog.getByRole('button', { name: 'Delete Shared' }).click();
  await expect(tagDialog.getByRole('button', { name: 'Delete Shared' })).toHaveCount(0);

  const tagsRefresh = page.waitForResponse((response) =>
    response.request().method() === 'GET' && response.url().endsWith('/api/tags'),
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await tagsRefresh;
  await expect(page.getByLabel('Filter by tag')).toHaveCount(0);
  const taskRow = page.getByTestId('todo-row').filter({ hasText: 'Cross tab task' });
  await expect(taskRow.locator('.todo-tag-pill')).toHaveCount(0);
  await expect(taskRow).toBeVisible();
  await secondSaveDialog.getByRole('button', { name: 'Close save filter dialog' }).click();
  await expect(page.getByRole('searchbox', { name: 'Search todos and subtasks' })).toBeFocused();
  await page.getByRole('button', { name: 'Shared tag', exact: true }).click();
  await expect(page.getByTestId('todo-row')).toHaveCount(1);
  await otherTab.close();
});

test('preserves manual filter edits made while a preset tag check is pending', async ({ page }) => {
  await addVirtualAuthenticator(page);
  await registerUser(page, `filter-preset-race-${Date.now()}`);
  await createTag(page, 'Work');

  await page.getByLabel('Todo title', { exact: true }).fill('Preset race task');
  await page.locator('.todo-create-form select').first().selectOption('low');
  await page.getByRole('button', { name: 'Select tag Work' }).click();
  await page.getByRole('button', { name: 'Add todo', exact: true }).click();
  await page.getByLabel('Filter by priority').selectOption('low');
  await page.getByLabel('Filter by tag').selectOption({ label: 'Work' });
  await page.getByRole('button', { name: 'Save Filter' }).click();
  const saveDialog = page.getByRole('dialog', { name: 'Save filter' });
  await saveDialog.getByLabel('Preset name').fill('Low work');
  await saveDialog.getByRole('button', { name: 'Save preset' }).click();
  await page.getByRole('button', { name: 'Clear All' }).click();
  await page.getByRole('button', { name: '▶ Advanced' }).click();

  let releaseTagResponse = () => {};
  const tagResponseGate = new Promise<void>((resolve) => { releaseTagResponse = resolve; });
  await page.route('**/api/tags', async (route) => {
    if (route.request().method() === 'GET') await tagResponseGate;
    await route.continue();
  });
  const tagRequest = page.waitForRequest((request) =>
    request.method() === 'GET' && request.url().endsWith('/api/tags'),
  );
  const tagResponse = page.waitForResponse((response) =>
    response.request().method() === 'GET' && response.url().endsWith('/api/tags'),
  );
  await page.getByRole('button', { name: 'Low work', exact: true }).click();
  await tagRequest;
  await page.getByLabel('Filter by priority').selectOption('high');
  releaseTagResponse();
  await tagResponse;

  await expect(page.getByLabel('Filter by priority')).toHaveValue('high');
  await page.unroute('**/api/tags');
});
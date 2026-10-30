import { expect, test } from '@playwright/test';
import { addVirtualAuthenticator, createTodo, registerUser } from '../helpers';
import { monthKey, parseMonthParam, shiftMonth } from '../../lib/calendar';

test('protects the calendar from unauthenticated access', async ({ page }) => {
  await page.goto('/calendar?month=2026-08');
  await expect(page).toHaveURL('/login');
});

test('navigates months, persists URL state, and falls back from invalid month values', async ({ page }) => {
  await addVirtualAuthenticator(page);
  await registerUser(page, `calendar-nav-${Date.now()}`);
  const current = parseMonthParam(null);
  await page.getByRole('link', { name: 'Calendar', exact: true }).click();
  await expect(page.locator('.calendar-grid tbody tr')).toHaveCount(6);
  await expect(page.locator('.calendar-cell')).toHaveCount(42);
  await expect(page.getByRole('columnheader')).toHaveText(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  await expect(page.locator('[aria-current="date"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Previous month' }).click();
  await expect(page).toHaveURL(`/calendar?month=${monthKey(shiftMonth(current, -1))}`);
  await page.getByRole('button', { name: 'Next month' }).click();
  await expect(page).toHaveURL(`/calendar?month=${monthKey(current)}`);
  await page.goto('/calendar?month=2028-02');
  await expect(page.getByRole('heading', { name: 'February 2028' })).toBeVisible();
  await expect(page.locator('[data-date="2028-02-29"]')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'February 2028' })).toBeVisible();
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(page).toHaveURL(`/calendar?month=${monthKey(current)}`);
  await page.goto('/calendar?month=2026-13');
  await expect(page.locator('[aria-current="date"]')).toHaveCount(1);
  await expect(page.locator('.calendar-grid tbody tr')).toHaveCount(6);
  await page.getByRole('link', { name: 'List', exact: true }).click();
  await expect(page).toHaveURL('/');
});

test('shows due-dated todos, Singapore boundaries, overflow, completion, and day details', async ({ page }) => {
  await addVirtualAuthenticator(page);
  await registerUser(page, `calendar-todos-${Date.now()}`);
  await createTodo(page, 'Undated item');
  const priorities = ['high', 'medium', 'low', 'high'];
  const ids: number[] = [];
  for (let index = 0; index < 4; index++) {
    const response = await page.request.post('/api/todos', {
      headers: { origin: 'http://localhost:3000' },
      data: {
        title: `Calendar item ${index + 1}`,
        due_date: index === 0 ? '2099-12-24T16:30:00Z' : '2099-12-25T10:00:00+08:00',
        priority: priorities[index],
      },
    });
    expect(response.status()).toBe(201);
    ids.push((await response.json()).id);
  }
  const completed = await page.request.put(`/api/todos/${ids[3]}`, {
    headers: { origin: 'http://localhost:3000' }, data: { completed: true },
  });
  expect(completed.status()).toBe(200);
  await page.goto('/calendar?month=2099-12');
  const cell = page.locator('[data-date="2099-12-25"]');
  await expect(cell.locator('.calendar-pill')).toHaveCount(3);
  await expect(cell.getByText('+1 more', { exact: true })).toBeVisible();
  await expect(page.getByText('Undated item', { exact: true })).toHaveCount(0);
  await expect(cell.locator('.priority-high').first()).toHaveCSS('background-color', 'rgb(254, 226, 226)');
  await expect(cell.locator('.priority-medium')).toHaveCSS('background-color', 'rgb(254, 249, 195)');
  await expect(cell.locator('.priority-low')).toHaveCSS('background-color', 'rgb(219, 234, 254)');
  await expect(cell.locator('.calendar-completed')).toHaveCount(1);
  await cell.click();
  const dialog = page.getByRole('dialog', { name: 'Todos for 2099-12-25' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('li')).toHaveCount(4);
  await expect(dialog.getByText('Calendar item 1', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Completed', { exact: true })).toHaveCount(1);
  await expect(dialog.getByText('Calendar item 4', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(cell).toBeFocused();
  await cell.click();
  await page.getByRole('button', { name: 'Close day details' }).click();
  await expect(dialog).toHaveCount(0);
});

test('shows seeded Singapore holidays, including observed dates and adjacent grid days', async ({ page }) => {
  await addVirtualAuthenticator(page);
  await registerUser(page, `calendar-holiday-${Date.now()}`);
  await page.goto('/calendar?month=2026-08');
  const nationalDay = page.locator('[data-date="2026-08-09"]');
  await expect(nationalDay.getByText('National Day', { exact: true })).toBeVisible();
  await expect(page.locator('[data-date="2026-08-10"]').getByText('National Day (observed)', { exact: true })).toBeVisible();
  await nationalDay.click();
  const dialog = page.getByRole('dialog', { name: 'Todos for 2026-08-09' });
  await expect(dialog.getByText('National Day', { exact: true })).toBeVisible();
  await expect(dialog.getByText('No todos due this day.')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.goto('/calendar?month=2026-06');
  await expect(page.locator('[data-date="2026-05-31"]').getByText('Vesak Day', { exact: true })).toBeVisible();
});

test('reports loading failures and retries without showing stale month data', async ({ page }) => {
  await addVirtualAuthenticator(page);
  await registerUser(page, `calendar-error-${Date.now()}`);
  await page.route('**/api/holidays?*', (route) => route.fulfill({
    status: 500, body: JSON.stringify({ error: 'Holidays unavailable.' }),
  }));
  await page.goto('/calendar?month=2026-08');
  await expect(page.getByRole('alert').filter({ hasText: 'Holidays unavailable.' })).toBeVisible();
  await page.unroute('**/api/holidays?*');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.locator('[data-date="2026-08-09"]').getByText('National Day', { exact: true })).toBeVisible();
  await expect(page.getByText('Holidays unavailable.')).toHaveCount(0);
});

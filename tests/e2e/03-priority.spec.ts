import { expect, test } from '@playwright/test';
import { addVirtualAuthenticator, registerUser } from '../helpers';

test('creates, sorts, and filters todos by priority', async ({ page }) => {
  await addVirtualAuthenticator(page);
  await registerUser(page, `priority-${Date.now()}`);

  const addTodo = async (title: string, priority: 'high' | 'medium' | 'low') => {
    await page.getByLabel('Todo title').fill(title);
    await page.getByRole('combobox', { name: 'Priority', exact: true }).selectOption(priority);
    await page.getByRole('button', { name: 'Add todo' }).click();
    await expect(page.getByTestId('todo-row').filter({ hasText: title })).toBeVisible();
  };

  await addTodo('Low priority task', 'low');
  await addTodo('Medium priority task', 'medium');
  await addTodo('High priority task', 'high');

  const pendingRows = page.locator('.pending-section [data-testid="todo-row"]');
  await expect(pendingRows).toHaveCount(3);
  await expect(page.locator('.pending-section .todo-title')).toHaveText([
    'High priority task',
    'Medium priority task',
    'Low priority task',
  ]);
  await expect(page.locator('.pending-section .priority-label').first()).toHaveCSS(
    'background-color',
    'rgb(254, 226, 226)',
  );

  const priorityFilter = page.getByRole('combobox', { name: 'Filter by priority', exact: true });
  await priorityFilter.selectOption('high');
  await expect(page.locator('.pending-section [data-testid="todo-row"]')).toHaveCount(1);
  await expect(page.getByTestId('todo-row').filter({ hasText: 'High priority task' })).toBeVisible();
  await expect(page.getByTestId('todo-row').filter({ hasText: 'Medium priority task' })).toHaveCount(0);
  await expect(page.getByTestId('todo-row').filter({ hasText: 'Low priority task' })).toHaveCount(0);

  await priorityFilter.selectOption('all');
  await expect(page.locator('.pending-section [data-testid="todo-row"]')).toHaveCount(3);
});

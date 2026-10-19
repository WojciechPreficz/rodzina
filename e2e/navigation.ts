import { expect, type Page } from '@playwright/test';

export async function openNavigation(page: Page) {
  await expect(page.locator('.mantine-AppShell-header')).toBeVisible();
  const button = page.getByRole('button', { name: 'Otwórz menu' });
  if (await button.isVisible()) {
    if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
  }
  return page.getByRole('navigation', { name: 'Nawigacja główna' });
}
